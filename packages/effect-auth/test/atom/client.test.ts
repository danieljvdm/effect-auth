import { Effect, Layer, Schema, SchemaGetter, Stream } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import * as AuthContract from "effect-auth/AuthContract";
import * as Client from "effect-auth/Client";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, test } from "vite-plus/test";

test("account replacement still invalidates application queries when it disposes the mutation atom", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const contract = AuthContract.make("test/invalidation", { claims: Schema.Struct({}) });
        const memoMap = yield* Layer.makeMemoMap;
        const factory = Atom.context({ memoMap });
        const runtime = factory(Layer.empty);

        const registry = yield* Effect.acquireRelease(
          Effect.sync(() => AtomRegistry.make()),
          (value) => Effect.sync(() => value.dispose()),
        );

        let reads = 0;

        const projects = runtime
          .atom(Effect.sync(() => ++reads))
          .pipe(factory.withReactivity(["projects"]));

        yield* AtomRegistry.mount(registry, projects);

        const observed = (count: number) =>
          AtomRegistry.toStreamResult(registry, projects).pipe(
            Stream.filter((value) => value === count),
            Stream.take(1),
            Stream.runDrain,
            Effect.timeout("1 second"),
          );

        yield* observed(1);

        const client = yield* Client.make(contract, {
          baseUrl: "https://example.test",
          fetch: async () =>
            Response.json({
              _tag: "Success",
              value: { clearCredential: true, invalidation: "client-only" },
            }),
        });

        const auth = yield* AuthAtom.make(client.auth, {
          memoMap,
          reactivityKeys: { signOut: ["projects"] },
        });

        yield* client.auth.signOut();
        yield* observed(2);

        const previous = yield* auth.lifetime.get;

        yield* AtomRegistry.mount(previous.registry, auth.signOut);
        previous.registry.set(auth.signOut, undefined);
        // The account registry interrupts the mutation that caused its replacement.
        // Invalidation must settle inside admission, before that interruption escapes.
        yield* observed(3);
        expect((yield* auth.lifetime.get).registry).not.toBe(previous.registry);
        expect(previous.registry.getNodes().size).toBe(0);

        const mutation = AuthAtom.mutation(contract.actions.signOut.route, {
          runtime: auth.runtime,
          reactivityKeys: ["projects"],
          subject: { fromSuccess: () => null },
        });

        const next = yield* auth.lifetime.get;

        yield* AtomRegistry.mount(next.registry, mutation);
        next.registry.set(mutation, undefined);
        yield* observed(4);

        const workflow = AuthAtom.workflow<void>()(
          auth.runtime,
          () =>
            Effect.gen(function* () {
              const flow = yield* AuthAtom.AuthAtomWorkflow;

              return yield* flow.completeAuthentication(
                contract.actions.signOut.route,
                undefined,
                () => null,
              );
            }),
          { reactivityKeys: ["projects"] },
        );

        const last = yield* auth.lifetime.get;

        yield* AtomRegistry.mount(last.registry, workflow);
        last.registry.set(workflow, undefined);
        yield* observed(5);
      }),
    ),
  ));

test("a query with an undefined encoded input remains a no-argument atom after decoding", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const contract = AuthContract.make("test/query-input", {
          claims: Schema.Struct({}),
          actions: () => ({
            status: AuthContract.action({
              payload: Schema.Undefined.pipe(
                Schema.decodeTo(Schema.Literal("default"), {
                  decode: SchemaGetter.succeed("default"),
                  encode: SchemaGetter.succeed(undefined),
                }),
              ),
              success: Schema.String,
              error: Schema.Never,
              mode: "query",
            }),
          }),
        });

        let calls = 0;

        const client = yield* Client.make(contract, {
          baseUrl: "https://example.test",
          fetch: async () => {
            calls++;

            return Response.json({ _tag: "Success", value: "available" });
          },
        });

        const auth = yield* AuthAtom.make(client.auth);
        const current = yield* auth.lifetime.get;

        expect(yield* AtomRegistry.getResult(current.registry, auth.status)).toBe("available");
        expect(calls).toBe(1);
      }),
    ),
  ));
