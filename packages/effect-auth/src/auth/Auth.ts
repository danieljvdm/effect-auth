import { Context, Effect, Exit, Layer, Option, Result, Schema, Scope, type Types } from "effect";

import { makeSessionModule } from "../sessions/module";
import { AuthConfigurationError } from "./AuthConfigurationError";
import type {
  BoundSelection,
  BoundStrategies,
  BuiltStrategy as Strategy,
  ClaimsCodec,
  StrategySelection,
} from "./definition";

type Strategies = Readonly<Record<string, Strategy>>;
type Api<S extends Strategy> = Effect.Success<S["make"]>;
type StrategyMethod<S extends Strategy> = S extends Strategy ? Api<S>[keyof Api<S>] : never;
type MethodNames<S extends Strategies> = S[keyof S] extends infer Strategy
  ? Strategy extends { readonly make: Effect.Effect<infer Api, unknown, unknown> }
    ? keyof Api
    : never
  : never;
type Selected<S extends Strategies, M extends PropertyKey> = {
  [K in keyof S]: M extends keyof Api<S[K]>
    ? (strategy: K, input: Parameters<Api<S[K]>[M]>[0]) => ReturnType<Api<S[K]>[M]>
    : never;
}[keyof S];

export type AuthApi<S extends Strategies, Default extends keyof S | undefined> = {
  readonly [M in MethodNames<S>]: Types.UnionToIntersection<Selected<S, M>> &
    (Default extends keyof S
      ? M extends keyof Api<S[Default]>
        ? Api<S[Default]>[M]
        : unknown
      : unknown);
};

type DefaultedName<Key extends string, Value extends string, Default extends string> = [
  Value,
  Default,
] extends [Default, Value]
  ? { readonly [K in Key]?: Value }
  : { readonly [K in Key]: Value };

type Names<Id extends string, SessionId extends string, Default extends string> = DefaultedName<
  "namespace",
  Id,
  Default
> &
  DefaultedName<"sessionNamespace", SessionId, `${Id}/sessions`>;

export type Options<
  Claims extends ClaimsCodec,
  S extends StrategySelection,
  Default extends keyof S | undefined = undefined,
  Id extends string = "effect-auth",
  SessionId extends string = `${Id}/sessions`,
  DefaultId extends string = "effect-auth",
> = {
  readonly claims: Claims;
  readonly strategies: S & Record<Exclude<keyof S, string>, never>;
  readonly defaultStrategy?: Default;
} & Names<Id, SessionId, DefaultId>;

const build = Effect.fn("Auth.make")(function* <
  S extends Strategies,
  Default extends keyof S | undefined,
>(strategies: S, defaultStrategy: Default | undefined) {
  type Build = S[keyof S]["make"];

  const entries = Object.entries(strategies) as Array<
    [
      string,
      {
        readonly make: Effect.Effect<
          Effect.Success<Build>,
          Effect.Error<Build>,
          Effect.Services<Build>
        >;
      },
    ]
  >;

  const current = yield* Effect.serviceOption(Layer.CurrentMemoMap);
  const memoMap = Option.isSome(current) ? current.value : yield* Layer.makeMemoMap;
  const scope = yield* Scope.fork(yield* Effect.scope);

  return yield* Effect.gen(function* () {
    type Result = ReturnType<StrategyMethod<S[keyof S]>>;
    type Callable = (
      input: never,
    ) => Effect.Effect<Effect.Success<Result>, Effect.Error<Result>, Effect.Services<Result>>;

    const built = yield* Effect.forEach(entries, ([name, strategy]) =>
      Effect.map(strategy.make, (api) => [name, api] as const),
    );

    const methodsByStrategy = new Map(
      built as ReadonlyArray<readonly [string, Readonly<Record<string, Callable>>]>,
    );

    const names = new Set([...methodsByStrategy.values()].flatMap((api) => Object.keys(api)));

    if (names.has("then")) return yield* AuthConfigurationError.make({ reason: "method" });

    const api = Object.fromEntries(
      [...names].map((name) => [
        name,
        (...args: readonly unknown[]) =>
          Effect.suspend(() => {
            const selected = args.length === 2 ? args[0] : defaultStrategy;
            const input = args.length === 2 ? args[1] : args[0];

            const methods =
              typeof selected === "string" ? methodsByStrategy.get(selected) : undefined;

            if (args.length > 2 || methods === undefined || !Object.hasOwn(methods, name))
              return Effect.die(AuthConfigurationError.make({ reason: "method" }));

            return methods[name](input as never);
          }),
      ]),
    );

    // The dispatch table is assembled from these exact strategy/method pairs.
    return Object.freeze(api) as AuthApi<S, Default>;
  }).pipe(
    Effect.provideService(Layer.CurrentMemoMap, memoMap),
    Scope.provide(scope),
    Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
  );
});

const namespaceSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9._:/-]+$/),
);

const strategyNameSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9._-]+$/),
);

const configurationError = (
  strategies: StrategySelection,
  defaultStrategy: PropertyKey | undefined,
  namespace: string,
  sessionNamespace: string,
) => {
  if (!Schema.is(namespaceSchema)(namespace) || !Schema.is(namespaceSchema)(sessionNamespace))
    return AuthConfigurationError.make({ reason: "namespace" });
  const entries = Object.entries(strategies);

  if (entries.length === 0 || entries.some(([key]) => !Schema.is(strategyNameSchema)(key)))
    return AuthConfigurationError.make({ reason: "strategies" });
  if (defaultStrategy !== undefined && !Object.hasOwn(strategies, defaultStrategy))
    return AuthConfigurationError.make({ reason: "default-strategy" });

  const namespaces = entries.flatMap(([key, strategy]) =>
    "bind" in strategy ? [strategy.namespace ?? `${namespace}/${key}`] : [],
  );

  if (namespaces.some((id) => !Schema.is(namespaceSchema)(id)))
    return AuthConfigurationError.make({ reason: "namespace" });

  return undefined;
};

/** Bind schemas and service keys once, before choosing the application's adapter Layers. */
export const define = <
  Claims extends ClaimsCodec,
  const S extends StrategySelection,
  const Default extends keyof S | undefined = undefined,
  const Id extends string = "effect-auth",
  const SessionId extends string = `${Id}/sessions`,
>(
  options: Options<Claims, S, Default, Id, SessionId>,
) => {
  const strategies = { ...options.strategies };
  const defaultStrategy = options.defaultStrategy;
  // Defaults are fixed credential namespaces, never process-local random identities.
  const namespace = (options.namespace ?? "effect-auth") as Id;
  const sessionNamespace = (options.sessionNamespace ?? `${namespace}/sessions`) as SessionId;
  const invalid = configurationError(strategies, defaultStrategy, namespace, sessionNamespace);

  if (invalid !== undefined) throw invalid;
  const sessions = makeSessionModule(sessionNamespace, options.claims);

  const modules = Object.fromEntries(
    Object.entries(strategies).map(([key, strategy]) => [
      key,
      "bind" in strategy
        ? strategy.bind({
            claims: options.claims,
            namespace: strategy.namespace ?? `${namespace}/${key}`,
            sessionNamespace,
            sessions,
          })
        : { strategy },
    ]),
    // Each descriptor is bound to these exact claims, namespace and selection key.
  ) as BoundStrategies<S, Claims, Id, SessionId>;

  const selected = Object.fromEntries(
    Object.entries(modules).map(([key, module]) => [key, module.strategy]),
  ) as BoundSelection<typeof modules>;

  return Object.freeze({
    claims: options.claims,
    namespace,
    sessions,
    strategies: Object.freeze(modules),
    make: build(selected, defaultStrategy),
  });
};

/** Construct typed auth methods whose resources live in the caller's Scope. */
export const make = <
  Claims extends ClaimsCodec,
  const S extends StrategySelection,
  const Default extends keyof S | undefined = undefined,
  const Id extends string = "effect-auth",
  const SessionId extends string = `${Id}/sessions`,
>(
  options: Options<Claims, S, Default, Id, SessionId>,
) => {
  const captured = { ...options, strategies: { ...options.strategies } };
  // Binding only constructs contracts and Layers. Their resources are acquired by the Effect.
  const definition = Result.try(() => define<Claims, S, Default, Id, SessionId>(captured));

  return Effect.gen(function* () {
    if (Result.isFailure(definition)) {
      if (Schema.is(AuthConfigurationError)(definition.failure)) return yield* definition.failure;

      return yield* Effect.die(definition.failure);
    }

    return yield* definition.success.make;
  });
};

/** Optionally expose the same constructor through a named Context service and static Layer. */
export const Service =
  <Self>() =>
  <
    const Id extends string,
    Claims extends ClaimsCodec,
    const S extends StrategySelection,
    const Default extends keyof S | undefined = undefined,
    const Namespace extends string = Id,
    const SessionId extends string = `${Namespace}/sessions`,
  >(
    id: Id,
    options: Options<Claims, S, Default, Namespace, SessionId, Id>,
  ) => {
    if (!Schema.is(Schema.NonEmptyString)(id)) throw AuthConfigurationError.make({ reason: "id" });

    const definition = define<Claims, S, Default, Namespace, SessionId>({
      ...options,
      namespace: (options.namespace ?? id) as Namespace,
    } as Options<Claims, S, Default, Namespace, SessionId>);

    const create = definition.make;
    const Auth = Context.Service<Self, Effect.Success<typeof create>>()(id);

    const layer = Layer.fromBuildMemo((memoMap, scope) =>
      Effect.map(create, (api) => Context.make(Auth, api)).pipe(
        Effect.provideService(Layer.CurrentMemoMap, memoMap),
        Scope.provide(scope),
      ),
    );

    return Object.assign(Auth, definition, { layer } as const);
  };
