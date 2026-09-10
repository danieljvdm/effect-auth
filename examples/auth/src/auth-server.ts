import { Effect, Layer } from "effect";
import { Auth, Password, Sessions } from "effect-auth";
import * as AuthHttp from "effect-auth/Http";

import { AuthApi } from "./auth-contract";

export const AppAuth = Auth.define(AuthApi, {
  sessions: Sessions.stateful(),
  strategies: { password: Password.make() },
  defaultStrategy: "password",
});

export const http = AuthHttp.make(AppAuth, { origin: "https://app.example.com" });

// Supply the application-owned session store, password store and account authority.
export const Routes = http.routes().pipe(Layer.provide(AppAuth.layer));

// In an application route covered by http.middleware, these local methods use
// AuthRequest from Effect context. Calling them does not make an HTTP request.
export const currentMember = Effect.gen(function* () {
  const auth = yield* AppAuth;
  const session = yield* auth.getSession();

  return session?.claims.displayName ?? null;
});
