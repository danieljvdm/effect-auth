import { Schema } from "effect";
import * as AuthContract from "effect-auth/AuthContract";

// Shared with the browser: schemas and selected actions only.
export const AuthApi = AuthContract.make("example/shared-auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  actions: (sessions) => ({ signIn: AuthContract.passwordSignIn(sessions) }),
});
