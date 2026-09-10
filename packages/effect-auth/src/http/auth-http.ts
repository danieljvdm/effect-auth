import {
  type Context,
  type Types,
  type Unify,
  DateTime,
  Duration,
  Effect,
  Layer,
  Redacted,
  Schema,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthRequest } from "../auth/AuthRequest";
import type { SessionApi, SessionApiError } from "../auth/session";
import { HookDenied } from "../hooks/models";
import { OperationHttpConfigurationError, OperationHttpError } from "../http-operation/errors";
import type { OperationHttpConfiguration } from "../http-operation/models";
import { invocationLayer } from "../http-operation/OperationHttpInvocation";
import {
  configurationLayer,
  cookieConfiguration,
  OperationHttpServerConfig,
} from "../http-operation/OperationHttpServerConfig";
import { requestSecurity } from "../http-operation/security";
import { guest } from "../operations/context";
import {
  type AuthCredentialCommand,
  AuthCredentialCommandCollector,
  AuthRevealCommandCollectorService,
} from "../operations/credentials";
import { OperationBoundaryError } from "../operations/errors";
import { SessionError, SessionSignOutUnavailable } from "../sessions/errors";
import { type SessionMetadata, SessionSignOut } from "../sessions/models";
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

const failureSchema = Schema.Union([SessionError, HookDenied, OperationBoundaryError]);
const signOutSchema = Schema.Union([SessionSignOut, SessionSignOutUnavailable]);

/** Bind an Auth definition to explicitly selected browser routes and request middleware.
 * Read requests resolve credentials lazily; writes require Origin, JSON and a CSRF header.
 * The application still owns session policy, persistence and profile lookup.
 */
export const make = <I, S extends SessionMetadata, RE>(
  auth: Omit<Context.Key<I, SessionApi<S>>, typeof Unify.unifySymbol> & {
    readonly sessions: { readonly Session: Schema.Codec<S, unknown, unknown, RE> };
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

  const resolve = (api: SessionApi<S>, credential: Redacted.Redacted<string> | undefined) =>
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

        return contract.RequireSession.of({
          session: Effect.fn("AuthHttp.requireSession")(function* (httpEffect) {
            // HttpApiBuilder treats middleware.requires as a construction dependency.
            // This exact Effect runs only inside the request security handler, so
            // expose its AuthRequest requirement through the router request marker.
            const required = api.requireSession() as unknown as Effect.Effect<
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

  const wrap = (api: SessionApi<S>, config: OperationHttpConfiguration) =>
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

  const sessionJson = HttpServerResponse.schemaJson(Schema.NullOr(auth.sessions.Session));
  const signOutJson = HttpServerResponse.schemaJson(signOutSchema);
  const failureJson = HttpServerResponse.schemaJson(failureSchema);
  const session = Effect.flatMap(auth, (api) => api.getSession()).pipe(Effect.flatMap(sessionJson));
  // Never resolve/verify the session before sign-out: the raw credential is sufficient.
  const signOut = Effect.flatMap(auth, (api) => api.signOut()).pipe(Effect.flatMap(signOutJson));
  const renew = Effect.flatMap(auth, (api) => api.renewSession()).pipe(Effect.flatMap(sessionJson));

  const respond = <R>(
    effect: Effect.Effect<HttpServerResponse.HttpServerResponse, typeof failureSchema.Type, R>,
  ) =>
    effect.pipe(
      Effect.catch((error) =>
        failureJson(error, {
          status:
            error._tag === "AuthenticationRequired" || error._tag === "SessionInvalid"
              ? 401
              : error._tag === "SessionUnavailable" || error._tag === "SessionSignOutUnavailable"
                ? 503
                : 400,
        }),
      ),
    );

  /** No endpoint is mounted unless selected; renewal is always an explicit POST.
   * Merge with application routes, then apply middleware once to the combined Layer. */
  const routes = (paths: {
    readonly session?: `/${string}`;
    readonly signOut?: `/${string}`;
    readonly renew?: `/${string}`;
  }) =>
    Layer.mergeAll(
      Layer.empty,
      ...(paths.session === undefined
        ? []
        : [
            HttpRouter.add(
              "GET",
              paths.session,
              respond(session.pipe(Effect.catchTag("HttpBodyError", Effect.die))),
            ),
          ]),
      ...(paths.signOut === undefined
        ? []
        : [
            HttpRouter.add(
              "POST",
              paths.signOut,
              respond(signOut.pipe(Effect.catchTag("HttpBodyError", Effect.die))),
            ),
          ]),
      ...(paths.renew === undefined
        ? []
        : [
            HttpRouter.add(
              "POST",
              paths.renew,
              respond(renew.pipe(Effect.catchTag("HttpBodyError", Effect.die))),
            ),
          ]),
    );

  return { routes, middleware, withRequest, operationLayer, securityLayer };
};
