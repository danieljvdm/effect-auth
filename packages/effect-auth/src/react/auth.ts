"use client";

import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Layer, type Scope } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as React from "react";

import { make as makeAtoms, type AuthAtomOptions, type AuthAtoms } from "../atom/client";
import {
  make as makeClient,
  type ActionDecodeServices,
  type ClientOptions,
} from "../http-operation/auth-client";
import type { AnyAuthAction, AuthActions } from "../operations/actions";

type ActionsWithSession = AuthActions & { readonly getSession: AnyAuthAction };

export interface AuthProviderProps<Actions extends ActionsWithSession> {
  readonly children?: React.ReactNode;
  readonly fallback?: React.ReactNode;
  /** Borrow a handle acquired in the host's Scope, including a per-request SSR handle. */
  readonly value?: AuthAtoms<Actions>;
}

export interface AuthReact<Actions extends ActionsWithSession> {
  readonly Provider: React.FC<AuthProviderProps<Actions>>;
  readonly useAuth: () => AuthAtoms<Actions>;
}

/** Optional codec services are required when the shared contract needs them. */
export type AuthReactOptions<Actions extends ActionsWithSession, E = never> = ClientOptions &
  AuthAtomOptions<Actions> & {
    readonly services?: Layer.Layer<ActionDecodeServices<Actions[keyof Actions]>, E>;
  } & ([ActionDecodeServices<Actions[keyof Actions]>] extends [never]
    ? {}
    : { readonly services: Layer.Layer<ActionDecodeServices<Actions[keyof Actions]>, E> });

/** Define a React boundary without acquiring resources. Each owned Provider
 * acquires independently after hydration. A supplied value remains host-owned.
 * The acquisition atom lives outside the replaceable account registry; ordinary
 * Atom hooks inside the provider use the current account registry automatically.
 */
export const fromEffect = <Actions extends ActionsWithSession, E>(
  acquire: Effect.Effect<AuthAtoms<Actions>, E, Scope.Scope>,
): AuthReact<Actions> => {
  const AuthContext = React.createContext<AuthAtoms<Actions> | undefined>(undefined);

  const useAuth = () => {
    const auth = React.useContext(AuthContext);

    if (auth === undefined) throw new Error("Auth.useAuth must be used inside Auth.Provider");

    return auth;
  };

  const Account = (props: {
    readonly value: AuthAtoms<Actions>;
    readonly children?: React.ReactNode;
  }) => {
    const current = useAtomValue(props.value.lifetime.current);

    return React.createElement(
      RegistryContext.Provider,
      { value: current.registry, key: current.generation },
      React.createElement(AuthContext.Provider, { value: props.value }, props.children),
    );
  };

  const Bound = (props: {
    readonly value: AuthAtoms<Actions>;
    readonly children?: React.ReactNode;
  }) =>
    React.createElement(
      RegistryContext.Provider,
      { value: props.value.lifetime.controlRegistry },
      React.createElement(Account, props),
    );

  const Acquire = (props: {
    readonly atom: Atom.Atom<AsyncResult.AsyncResult<AuthAtoms<Actions>, E>>;
    readonly children?: React.ReactNode;
    readonly fallback?: React.ReactNode;
  }) => {
    const result = useAtomValue(props.atom);

    if (AsyncResult.isFailure(result)) throw Cause.squash(result.cause);
    if (!AsyncResult.isSuccess(result)) return props.fallback ?? null;

    return React.createElement(Bound, { value: result.value }, props.children);
  };

  const Owned = (props: AuthProviderProps<Actions>) => {
    // Constructing an atom is inert. RegistryProvider owns its Scope, including
    // delayed disposal for React Strict Mode's effect replay.
    const [atom] = React.useState(() => Atom.make(acquire).pipe(Atom.withServerValueInitial));

    return React.createElement(
      RegistryProvider,
      null,
      React.createElement(Acquire, { ...props, atom }),
    );
  };

  const Provider: React.FC<AuthProviderProps<Actions>> = (props) =>
    props.value === undefined
      ? React.createElement(Owned, props)
      : React.createElement(Bound, { value: props.value }, props.children);

  return { Provider, useAuth };
};

/** The usual browser setup. React owns the fresh client and all its resources.
 * Default server rendering is an inert fallback; use a request-scoped value for
 * session-aware SSR. Keep options stable and remount with a key to reconfigure.
 */
export const make = <Actions extends ActionsWithSession, E = never>(
  contract: { readonly actions: Actions },
  options: AuthReactOptions<Actions, E>,
): AuthReact<Actions> => {
  // The options type requires this Layer whenever codec services are nonempty.
  const services = (options.services ?? Layer.empty) as Layer.Layer<
    ActionDecodeServices<Actions[keyof Actions]>,
    E
  >;

  const acquire = Effect.gen(function* () {
    const client = yield* makeClient(contract, options);

    return yield* makeAtoms(client.auth, options);
  });

  return fromEffect(acquire.pipe(Effect.provide(services)));
};
