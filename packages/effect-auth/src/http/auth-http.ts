import {
  type Schema,
  Context,
  type Types,
  type Unify,
  DateTime,
  Duration,
  Effect,
  Layer,
  Redacted,
  Scope,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthRequest } from "../auth/AuthRequest";
import type { SessionApi, SessionApiError } from "../auth/session";
import { OperationHttpConfigurationError, OperationHttpError } from "../http-operation/errors";
import type { HttpCredentials, OperationHttpConfiguration } from "../http-operation/models";
import {
  invocationLayer,
  OperationHttpInvocation,
} from "../http-operation/OperationHttpInvocation";
import {
  configurationLayer,
  cookieConfiguration,
  OperationHttpServerConfig,
} from "../http-operation/OperationHttpServerConfig";
import { requestSecurity } from "../http-operation/security";
import { make as makeOperationServer } from "../http-operation/server";
import type { ActionSuccess, AuthActions } from "../operations/actions";
import { guest } from "../operations/context";
import {
  type AuthCredentialCommand,
  AuthCredentialCommandCollector,
  AuthRevealCommandCollectorService,
} from "../operations/credentials";
import type { SessionMetadata } from "../sessions/models";
import type { makeSessionHttpContract } from "./session-contract";

/** Browser transport policy. Insecure cookies require an explicit development override. */
export interface AuthHttpOptions {
  readonly origin: string;
  readonly maximumBodyBytes?: number;
  readonly maximumUrlBytes?: number;
  readonly cookie?: {
    readonly prefix?: string;
    readonly name?: string;
    readonly secure?: boolean;
    readonly sameSite?: "lax" | "strict";
  };
  readonly csrf?: { readonly header: string; readonly value: string };
}

/** Bind an Auth definition to its shared browser actions and request middleware.
 * Actions resolve credentials lazily and require Origin, JSON and a CSRF header.
 * The application still owns session policy, persistence and profile lookup.
 */
export const make = <
  I,
  S extends SessionMetadata,
  RE,
  Api extends SessionApi<S, unknown>,
  Actions extends AuthActions,
>(
  auth: Omit<Context.Key<I, Api>, typeof Unify.unifySymbol> & {
    readonly sessions: { readonly Session: Schema.Codec<S, unknown, unknown, RE> };
    readonly contract: { readonly actions: Actions };
  },
  options: AuthHttpOptions,
) => {
  const secure = options.cookie?.secure ?? true;

  const cookies = cookieConfiguration({
    prefix: options.cookie?.prefix ?? (secure ? "__Host-effect-auth-" : "effect-auth-"),
    secure,
    sameSite: options.cookie?.sameSite ?? "lax",
  });

  const sessionCookieName = options.cookie?.name ?? cookies.session.name;

  const configuration = configurationLayer({
    publicOrigin: options.origin,
    trustedOrigins: [options.origin],
    cookies: {
      ...cookies,
      session: { ...cookies.session, name: sessionCookieName },
    },
    csrfHeader: options.csrf?.header ?? "x-effect-auth-csrf",
    csrfValue: options.csrf?.value ?? "1",
    maximumBodyBytes: options.maximumBodyBytes ?? 65536,
    maximumUrlBytes: options.maximumUrlBytes ?? 8192,
  });

  const resolve = (
    api: Pick<SessionApi<S>, "verifySession">,
    credential: Redacted.Redacted<string> | undefined,
  ) =>
    credential === undefined
      ? Effect.succeed(guest)
      : api.verifySession(credential).pipe(
          Effect.map((session) => ({
            _tag: "Authenticated" as const,
            subjectId: session.subjectId,
            sessionId: session.sessionId,
            assurance: session.assurance,
          })),
          Effect.catchTag("SessionInvalid", () => Effect.succeed(guest)),
        );

  /** Existing operation contracts retain private predecode injection and their wire format. */
  const operationLayer = Layer.merge(
    configuration,
    invocationLayer(
      Effect.fn("AuthHttp.invocation")(function* (_request, credentials) {
        const api = yield* auth;

        return yield* resolve(api, credentials.session).pipe(
          Effect.mapError(() => OperationHttpError.make({ reason: "unavailable" })),
        );
      }),
    ),
  );

  /** Implement shared HttpApi session security using the validated outer request context. */
  const securityLayer = <
    const Id extends string,
    ContractSchema extends Schema.Codec<S, unknown, unknown, RE>,
  >(
    contract: ReturnType<typeof makeSessionHttpContract<Id, ContractSchema>>,
  ) =>
    Layer.effect(
      contract.RequireSession,
      Effect.gen(function* () {
        if (contract.cookieName !== sessionCookieName) {
          return yield* OperationHttpConfigurationError.make({ reason: "cookies" });
        }
        const api = yield* auth;

        const services = (yield* Effect.context<
          Exclude<Effect.Services<ReturnType<Api["requireSession"]>>, AuthRequest>
        >()).pipe(
          Context.omit(
            AuthRequest,
            Scope.Scope,
            AuthCredentialCommandCollector,
            AuthRevealCommandCollectorService,
          ),
        );

        return contract.RequireSession.of({
          session: Effect.fn("AuthHttp.requireSession")(function* (httpEffect) {
            // HttpApiBuilder treats middleware.requires as a construction dependency.
            // This exact Effect runs only inside the request security handler, so
            // expose its AuthRequest requirement through the router request marker.
            const required = api
              .requireSession()
              .pipe(Effect.provide(services)) as unknown as Effect.Effect<
              S,
              SessionApiError,
              HttpRouter.Request.From<"Requires", AuthRequest>
            >;

            const session = yield* required;

            return yield* Effect.provideService(httpEffect, contract.CurrentSession, session);
          }),
        });
      }),
    );

  const wrap = (api: Api, config: OperationHttpConfiguration) =>
    Effect.fn("AuthHttp.request")(function* <E, R>(
      effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
    ) {
      const incoming = yield* HttpServerRequest.HttpServerRequest;

      const request = yield* HttpServerRequest.toWeb(incoming).pipe(
        Effect.mapError(() => OperationHttpError.make({ reason: "request" })),
      );

      if (new TextEncoder().encode(request.url).byteLength > config.maximumUrlBytes) {
        return yield* OperationHttpError.make({ reason: "too-large" });
      }

      const read = request.method === "GET" || request.method === "HEAD";

      const security = yield* requestSecurity(request, read ? "read" : "operation").pipe(
        Effect.provideService(OperationHttpServerConfig, config),
      );

      const commands: AuthCredentialCommand[] = [];

      const sink = (values: ReadonlyArray<AuthCredentialCommand>) =>
        Effect.sync(() => {
          commands.push(...values);
        });

      const resolveInvocation = resolve(api, security.credentials.session);

      let response = yield* effect.pipe(
        Effect.provideService(auth, api),
        Effect.provideService(AuthRequest, {
          invocation: guest,
          credentials: security.credentials,
          resolveInvocation,
          credentialCommandSink: sink,
        }),
        Effect.provideService(AuthCredentialCommandCollector, sink),
        Effect.provideService(AuthRevealCommandCollectorService, {
          supportedKinds: [],
          accept: () =>
            Effect.die(new Error("Private reveals require an explicit operation route")),
        }),
      );

      const now = DateTime.toEpochMillis(yield* DateTime.now);

      for (const command of commands) {
        const cookie = config.cookies[command.slot];

        response = yield* HttpServerResponse.setCookie(
          response,
          cookie.name,
          command._tag === "Issue" ? Redacted.value(command.credential) : "",
          {
            ...cookie,
            httpOnly: true,
            maxAge: Duration.millis(
              command._tag === "Issue" ? Math.max(0, command.expiresAtMillis - now) : 0,
            ),
          },
        ).pipe(Effect.mapError(() => OperationHttpError.make({ reason: "response" })));
      }

      return HttpServerResponse.setHeader(response, "cache-control", "no-store");
    });

  const requestLayer = HttpRouter.middleware<{
    provides: I | AuthRequest | AuthCredentialCommandCollector | AuthRevealCommandCollectorService;
  }>()(
    Effect.gen(function* () {
      const api = yield* auth;
      const config = yield* OperationHttpServerConfig;

      return (
        effect,
      ): Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        Types.unhandled,
        HttpServerRequest.HttpServerRequest
      > =>
        wrap(
          api,
          config,
        )(effect).pipe(
          Effect.catchTag("OperationHttpError", (error) =>
            HttpServerResponse.schemaJson(OperationHttpError)(error, {
              status:
                error.reason === "origin" || error.reason === "csrf"
                  ? 403
                  : error.reason === "too-large"
                    ? 413
                    : 400,
              headers: { "cache-control": "no-store" },
            }).pipe(Effect.orDie),
          ),
        );
    }),
  ).layer.pipe(Layer.provide(configuration));

  /** Apply to raw HttpRouter or HttpApi route Layers. Authentication is explicit in handlers. */
  const middleware = Layer.provide(requestLayer);

  /** Wrap a custom response workflow, keeping all credential delivery request-local. */
  const withRequest = <E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* () {
      const api = yield* auth;
      const config = yield* OperationHttpServerConfig;

      return yield* wrap(api, config)(effect);
    }).pipe(Effect.provide(configuration));

  /** Mount the shared contract. Each route calls the same local method, and
   * request credentials are installed before that method executes. Paths belong
   * to the contract so server and client cannot configure them independently. */
  const routes = () => {
    type Call = Extract<
      Api[Extract<keyof Actions, keyof Api>],
      (...args: never[]) => Effect.Effect<unknown, unknown, unknown>
    >;
    type Result = ReturnType<Call>;
    type Mounted = {
      readonly [Name in keyof Actions]: Omit<Actions[Name]["route"], "operation"> & {
        readonly operation: Omit<Actions[Name]["route"]["operation"], "invokeUnknown"> & {
          readonly invokeUnknown: (
            invocation: unknown,
            input: unknown,
          ) => Effect.Effect<
            ActionSuccess<Actions[Name]>,
            Effect.Error<Result>,
            I | Effect.Services<Result>
          >;
        };
      };
    };

    const table = Object.fromEntries(
      Object.entries(auth.contract.actions).map(([name, action]) => [
        name,
        {
          ...action.route,
          operation: {
            ...action.route.operation,
            invokeUnknown: (_invocation: unknown, input: unknown) =>
              Effect.gen(function* () {
                const api = yield* auth;

                // This table contains the exact methods bound from auth.contract.
                const invoke = api[name as keyof Api] as (
                  input: unknown,
                ) => Effect.Effect<
                  Effect.Success<Result>,
                  Effect.Error<Result>,
                  Effect.Services<Result>
                >;

                return yield* invoke(input);
              }),
          },
        },
      ]),
    ) as Mounted;

    const requestInvocation = Layer.effect(
      OperationHttpInvocation,
      Effect.gen(function* () {
        const api = yield* auth;

        return {
          resolve: () => Effect.succeed(guest),
          request: (_request: Request, credentials: HttpCredentials) =>
            resolve(api, credentials.session),
        };
      }),
    );

    return Layer.unwrap(
      Effect.gen(function* () {
        const server = yield* makeOperationServer({ routes: table }).pipe(
          Effect.provide([configuration, requestInvocation]),
        );

        return Layer.mergeAll(
          Layer.empty,
          ...Object.values(table).map((route) =>
            HttpRouter.add(
              "POST",
              route.path,
              Effect.gen(function* () {
                const request = yield* HttpServerRequest.toWeb(
                  yield* HttpServerRequest.HttpServerRequest,
                ).pipe(Effect.mapError(() => OperationHttpError.make({ reason: "request" })));

                return HttpServerResponse.fromWeb(yield* server.handle(request));
              }),
            ),
          ),
        );
      }),
    );
  };

  return { routes, middleware, withRequest, operationLayer, securityLayer };
};
