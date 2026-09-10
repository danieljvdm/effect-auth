import { Effect, Layer } from "effect";
import { Auth, Sessions } from "effect-auth";
import * as AuthHttp from "effect-auth/Http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { Claims, ProfileApi, SessionHttp } from "./session-contract";

export const AppAuth = Auth.define("example/session-auth", {
  claims: Claims,
  sessions: Sessions.stateful({ idleTimeout: "7 days", maxAge: "30 days" }),
});

const http = AuthHttp.make(AppAuth, {
  origin: "https://app.example.com",
  cookie: { name: SessionHttp.cookieName },
});

const ProfileHandlers = HttpApiBuilder.group(ProfileApi, "profile", (handlers) =>
  Effect.succeed(
    handlers.handle("current", () =>
      Effect.map(SessionHttp.CurrentSession, (session) => session.claims),
    ),
  ),
);

// Supply the bound StatefulSessionPersistence and SessionRepository through a storage Layer.
// Only the session backend is required; this example installs no authentication methods.
export const Routes = Layer.mergeAll(
  http.routes(),
  HttpApiBuilder.layer(ProfileApi).pipe(
    Layer.provide(ProfileHandlers),
    Layer.provide(http.securityLayer(SessionHttp)),
    http.middleware,
  ),
).pipe(Layer.provide(AppAuth.layer));
