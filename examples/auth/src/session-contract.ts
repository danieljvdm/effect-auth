import { makeSessionContract, makeSessionHttpContract } from "@yielded/auth/SessionContract";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

// Shared browser/server contracts contain no keys, storage or server implementation.
export const Claims = Schema.Struct({ displayName: Schema.String });
const sessions = makeSessionContract("example/session-auth/sessions", Claims);

export const SessionHttp = makeSessionHttpContract("example/session-auth", sessions.Session, {
  cookieName: "__Host-example-session",
});

export const ProfileApi = HttpApi.make("profile").add(
  HttpApiGroup.make("profile")
    .add(HttpApiEndpoint.get("current", "/me", { success: Claims }))
    .middleware(SessionHttp.RequireSession),
);
