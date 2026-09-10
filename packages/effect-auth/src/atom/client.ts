import { Context, Effect, Layer, Schema, Scope, SubscriptionRef } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import { Atom, AtomRegistry, Reactivity } from "effect/unstable/reactivity";

import {
  type ActionDecodeServices,
  type AuthClient,
  AuthClientTypeId,
} from "../http-operation/auth-client";
import type { RouteFailure, RouteInput, RouteSuccess } from "../http-operation/contract";
import { OperationHttpError } from "../http-operation/errors";
import type { AnyAuthAction, AuthActions } from "../operations/actions";
import { AuthAtomLifetime, type AuthSubjectLifetime } from "./AuthAtomLifetime";

type QueryAtom<Action extends AnyAuthAction> = Atom.Atom<
  AsyncResult.AsyncResult<
    RouteSuccess<Action["route"]>,
    RouteFailure<Action["route"]> | OperationHttpError
  >
>;

export type AuthActionAtom<Action extends AnyAuthAction> = Action["mode"] extends "query"
  ? undefined extends RouteInput<Action["route"]>
    ? QueryAtom<Action>
    : (input: RouteInput<Action["route"]>) => QueryAtom<Action>
  : Atom.AtomResultFn<
      RouteInput<Action["route"]>,
      RouteSuccess<Action["route"]>,
      RouteFailure<Action["route"]> | OperationHttpError
    >;

export type AuthAtoms<Actions extends AuthActions & { readonly getSession: AnyAuthAction }> = {
  readonly [Name in keyof Actions]: AuthActionAtom<Actions[Name]>;
} & {
  readonly session: QueryAtom<Actions["getSession"]>;
  readonly lifetime: AuthAtomLifetime["Service"];
  readonly runtime: Atom.AtomRuntime<AuthAtomLifetime>;
};

/** Acquire once in the application scope. Observe lifetime.current in its
 * controlRegistry and mount all returned action atoms in current.registry.
 * Direct client calls and atom dispatches share the same subject transitions;
 * replacement disposes all prior account state before publishing the next one. */
export const make = Effect.fn("AuthAtom.make")(function* <
  Actions extends AuthActions & { readonly getSession: AnyAuthAction },
>(
  auth: AuthClient<Actions>,
): Effect.fn.Return<
  AuthAtoms<Actions>,
  OperationHttpError,
  Scope.Scope | ActionDecodeServices<Actions[keyof Actions]>
> {
  const controller = auth[AuthClientTypeId];
  const scope = yield* Effect.scope;
  const services = yield* Effect.context<ActionDecodeServices<Actions[keyof Actions]>>();

  if (
    controller.actions.getSession.mode !== "query" ||
    ["session", "lifetime", "runtime"].some((name) => Object.hasOwn(controller.actions, name)) ||
    Object.values(controller.actions).some(
      ({ mode, route }) =>
        mode === "query" &&
        (route.operation.credentials ||
          route.operation.reveals.length > 0 ||
          route.operation.replay !== "read-only"),
    )
  )
    return yield* OperationHttpError.make({ reason: "request" });

  const initial = yield* controller.state;
  const controlRegistry = AtomRegistry.make();

  const state = yield* SubscriptionRef.make<AuthSubjectLifetime>({
    ...initial,
    registry: AtomRegistry.make(),
  });

  const memoMap = yield* Layer.makeMemoMap;

  const reactivity = Context.get(
    yield* Layer.buildWithMemoMap(Reactivity.layer, memoMap, scope),
    Reactivity.Reactivity,
  );

  // A private key shared by every generated query/mutation, on the same
  // Reactivity instance used by the public runtime and direct-call listener.
  const queryKeys = [Symbol("effect-auth/client/queries")];
  let closed = false;

  yield* controller.subscribe((event) =>
    Effect.gen(function* () {
      if (closed) return;
      if (event._tag === "Mutation") {
        yield* reactivity.invalidate(queryKeys);

        return;
      }

      const previous = yield* SubscriptionRef.get(state);

      if (previous.generation === event.state.generation) return;
      previous.registry.dispose();
      yield* SubscriptionRef.set(state, {
        ...event.state,
        registry: AtomRegistry.make(),
      });
    }),
  );

  yield* Scope.addFinalizer(
    scope,
    Effect.gen(function* () {
      closed = true;
      // Wait for any admitted credential response, then fence outstanding work
      // and clear the private reveal lifetime before releasing the registries.
      yield* controller.replaceSubject((yield* controller.state).subject);
      (yield* SubscriptionRef.get(state)).registry.dispose();
      controlRegistry.dispose();
    }),
  );

  const lifetime: AuthAtomLifetime["Service"] = {
    client: controller.transport,
    current: Atom.subscriptionRef(state) as Atom.Atom<AuthSubjectLifetime>,
    get: SubscriptionRef.get(state),
    controlRegistry,
    replaceSubject: controller.replaceSubject,
    completeAuthentication: controller.completeAuthentication,
  };

  const runtime = Atom.context({ memoMap })(Layer.succeed(AuthAtomLifetime, lifetime));

  const call = Effect.fn("AuthAtom.call")(function* <Name extends keyof Actions>(
    name: Name,
    input: RouteInput<Actions[Name]["route"]>,
  ) {
    const registry = yield* AtomRegistry.AtomRegistry;

    if (registry !== (yield* lifetime.get).registry)
      return yield* OperationHttpError.make({ reason: "stale-response" });

    const operation: Effect.Effect<
      RouteSuccess<Actions[Name]["route"]>,
      RouteFailure<Actions[Name]["route"]> | OperationHttpError,
      ActionDecodeServices<Actions[keyof Actions]>
    > = controller.call(name, input, { notifyMutation: false });

    return yield* operation.pipe(Effect.provide(services));
  });

  const atoms = Object.fromEntries(
    Object.entries(controller.actions).map(([name, action]) => {
      if (action.mode === "mutation")
        return [
          name,
          runtime.fn<RouteInput<Actions[string]["route"]>>()((input) => call(name, input), {
            reactivityKeys: queryKeys,
          }),
        ];

      const query = Atom.family((input: RouteInput<Actions[string]["route"]>) =>
        runtime.atom(call(name, input)).pipe(runtime.factory.withReactivity(queryKeys)),
      );

      // Action payload schemas describe the public encoded input. Preserve that
      // relationship while inspecting a heterogeneous table's optional input.
      const payloadSchema = action.route.operation.rpc.payloadSchema as Schema.Top & {
        readonly Type: RouteInput<Actions[string]["route"]>;
      };

      const input: unknown = undefined;

      return [name, Schema.is(payloadSchema)(input) ? query(input) : query];
    }),
  );

  // The mode and payload schema of each named action select its exact atom form.
  return Object.freeze({
    ...atoms,
    session: atoms.getSession,
    lifetime,
    runtime,
  }) as AuthAtoms<Actions>;
});
