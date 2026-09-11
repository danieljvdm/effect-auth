import { it } from "@effect/vitest";
import * as Auth from "@yielded/auth/Auth";
import * as AuthContract from "@yielded/auth/AuthContract";
import * as GitHub from "@yielded/auth/GitHub";
import * as AuthHttp from "@yielded/auth/Http";
import { OAuthProtocol, OAuthRejected, OAuthReturnTarget } from "@yielded/auth/OAuth";
import { makeRequestBinding } from "@yielded/auth/Operations";
import { SessionInvalid } from "@yielded/auth/Sessions";
import { Context, DateTime, Effect, Encoding, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { expect, expectTypeOf } from "vite-plus/test";

import { cryptoLayer } from "../../src/auth/defaults";

const contract = AuthContract.make("test/callback", {
  claims: Schema.Struct({}),
  actions: (sessions) => ({
    start: AuthContract.oauthSignIn(),
    finish: AuthContract.oauthCompleteSignIn(sessions),
  }),
});

const Begin = contract.actions.start.route.operation.rpc.payloadSchema;
const Complete = contract.actions.finish.route.operation.rpc.payloadSchema;
const binding = makeRequestBinding("test/callback", "oauth-entry");

const bindingConfig = Auth.RequestBindingConfig.layer({
  generation: 1,
  lifetimeMillis: 60_000,
  keyring: {
    activeKeyId: "test",
    keys: [
      { id: "test", material: Redacted.make(Encoding.encodeBase64Url(new Uint8Array(32).fill(7))) },
    ],
  },
});

class CallbackRenderer extends Context.Service<
  CallbackRenderer,
  { readonly render: Effect.Effect<Response> }
>()("test/callback/Renderer") {}

// The substitute owns only the named application methods at the HTTP seam.
// Protocol exchange/state semantics have their own adapter suites; the real
// signed binding and real provider declaration exercise callback correlation.
const makeApp = (custom: boolean) => {
  const completed: Array<typeof Complete.Type> = [];

  type Api = Auth.SessionApi<typeof contract.sessions.Session.Type> & {
    readonly start: (
      input: unknown,
    ) => Effect.Effect<
      typeof contract.actions.start.route.operation.rpc.successSchema.Type,
      OAuthRejected,
      Auth.AuthRequest
    >;
    readonly finish: (
      input: unknown,
    ) => Effect.Effect<
      typeof contract.actions.finish.route.operation.rpc.successSchema.Type,
      OAuthRejected,
      Auth.AuthRequest
    >;
  };

  class AppAuth extends Context.Service<AppAuth, Api>()("test/callback/Auth") {
    static readonly contract = contract;
    static readonly sessions = contract.sessions;
    static readonly layer = Layer.effect(
      this,
      Effect.gen(function* () {
        const protocol = yield* OAuthProtocol;
        const binder = yield* binding.RequestBinding;

        return AppAuth.of({
          verifySession: () => SessionInvalid.make({}),
          getSession: () => Effect.succeed(null),
          requireSession: () => SessionInvalid.make({}),
          renewSession: () => SessionInvalid.make({}),
          signOut: () => Effect.die("unused session method"),
          start: Effect.fn(
            function* (raw) {
              const input = yield* Schema.decodeUnknownEffect(Begin)(raw);
              const issued = yield* binder.issue(input.flowId);
              const prepared = yield* protocol.prepareAuthorization(input);
              const request = yield* Auth.AuthRequest;

              yield* request.credentialCommandSink(issued.credentialCommands);

              return { ...issued.value, authorizationUrl: prepared.authorizationUrl };
            },
            Effect.mapError(() => OAuthRejected.make({})),
          ),
          finish: Effect.fn(
            function* (raw) {
              const input = yield* Schema.decodeUnknownEffect(Complete)(raw);
              const request = yield* Auth.AuthRequest;
              const credential = request.credentials["request-binding"];

              if (credential === undefined) return yield* OAuthRejected.make({});
              yield* binder.verify(input.flowId, credential);
              completed.push(input);
              yield* request.credentialCommandSink([
                {
                  _tag: "Issue",
                  slot: "session",
                  credential: Redacted.make("private-session"),
                  expiresAtMillis: DateTime.toEpochMillis(yield* DateTime.now) + 60_000,
                },
                { _tag: "Clear", slot: "request-binding" },
              ]);

              return {
                _tag: "Cancelled" as const,
                returnTarget: OAuthReturnTarget.make("/account"),
              };
            },
            Effect.mapError(() => OAuthRejected.make({})),
          ),
        });
      }),
    ).pipe(Layer.provide(binding.layer), Layer.provide(cryptoLayer));
  }

  const http = AuthHttp.make(AppAuth, {
    origin: "https://app.test",
    oauth: {
      providers: {
        github: GitHub.provider({ clientId: "test", clientSecret: Redacted.make("secret") }),
      },
      ...(custom
        ? {
            callbacks: {
              github: {
                path: "/custom/github" as const,
                respond: () => Effect.flatMap(CallbackRenderer, (renderer) => renderer.render),
              },
            },
          }
        : {}),
    },
  });

  const callbackRoutes = http.routes();

  expectTypeOf<
    CallbackRenderer extends Layer.Services<typeof callbackRoutes> ? true : false
  >().toEqualTypeOf<true>();

  const routes = callbackRoutes.pipe(
    Layer.provide(http.layer),
    Layer.provide(bindingConfig),
    Layer.provide(HttpServer.layerServices),
    Layer.provide(
      Layer.succeed(CallbackRenderer, {
        render: Effect.succeed(
          new Response("Continue registration", { headers: { "cache-control": "public" } }),
        ),
      }),
    ),
  );

  return { http, routes, completed };
};

it.effect(
  "mounts the advertised callback and recovers its flow only from the verified private cookie",
  () =>
    Effect.gen(function* () {
      for (const custom of [false, true]) {
        const app = makeApp(custom);

        const web = yield* Effect.acquireRelease(
          Effect.sync(() => HttpRouter.toWebHandler(app.routes, { disableLogger: true })),
          (web) => Effect.promise(() => web.dispose()),
        );

        const send = (request: Request) => Effect.promise(() => web.handler(request));

        const begin = yield* send(
          new Request("https://app.test/auth/start", {
            method: "POST",
            headers: {
              origin: "https://app.test",
              "content-type": "application/json",
              "x-effect-auth-csrf": "1",
            },
            body: JSON.stringify({
              payload: {
                flowId: "flow-from-private-cookie",
                commandId: "command",
                provider: "github",
                callbackId: "github",
                returnTarget: "/account",
              },
            }),
          }),
        );

        expect(begin.status).toBe(200);
        const body = yield* Effect.promise(() => begin.text());

        const started = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              value: contract.actions.start.route.operation.rpc.successSchema,
            }),
          ),
        )(body);

        const authorization = new URL(Redacted.value(started.value.authorizationUrl));

        const callback = custom
          ? "https://app.test/custom/github"
          : "https://app.test/auth/github/callback";

        expect(authorization.searchParams.get("redirect_uri")).toBe(callback);
        expect(app.http.oauth.callbackUrl("github")).toBe(callback);
        const cookies = begin.headers.getSetCookie();

        expect(cookies).toHaveLength(1);
        expect(cookies[0]).toContain("HttpOnly");
        const cookie = cookies[0]!.split(";")[0]!;
        const url = `${callback}?state=${authorization.searchParams.get("state")}&code=private-code&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth`;

        for (const request of [
          new Request(url),
          new Request(`${url}&state=duplicate`, { headers: { cookie } }),
          new Request(`${url}&flowId=attacker`, { headers: { cookie } }),
          new Request(url, { headers: { cookie: `${cookie.slice(0, -2)}xx` } }),
          new Request("https://app.test/auth/finish", { method: "POST", headers: { cookie } }),
        ]) {
          const rejected = yield* send(request);

          expect(rejected.status).toBeGreaterThanOrEqual(400);
        }
        expect(app.completed).toHaveLength(0);

        const response = yield* send(new Request(url, { headers: { cookie } }));

        expect(response.status).toBe(custom ? 200 : 303);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(
          response.headers
            .getSetCookie()
            .some((value) => value.includes("private-session") && value.includes("HttpOnly")),
        ).toBe(true);
        if (custom)
          expect(yield* Effect.promise(() => response.text())).toBe("Continue registration");
        else expect(response.headers.get("location")).toBe("https://app.test/account");
        expect(app.completed).toHaveLength(1);
        expect(app.completed[0]!.flowId).toBe("flow-from-private-cookie");
        expect(app.completed[0]!.provider).toBe("github");
        expect(body).not.toContain(cookie.split("=")[1]);
      }
    }),
);
