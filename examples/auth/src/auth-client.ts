import { Effect } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import * as Client from "effect-auth/Client";

import { AuthApi } from "./auth-contract";

// Keep this Scope alive for the browser application.
export const makeClient = Effect.fn("example.authClient")(function* () {
  const client = yield* Client.make(AuthApi, { baseUrl: "https://app.example.com" });
  const auth = yield* AuthAtom.make(client.auth);

  // Read auth.lifetime.current in its controlRegistry. Mount the account UI in
  // current.registry; it is disposed and replaced whenever authentication changes.
  // Components read auth.session and dispatch auth.signIn / auth.signOut.
  return { client, auth };
});

export const currentMember = Effect.fn("example.remoteMember")(function* () {
  const client = yield* Client.make(AuthApi, { baseUrl: "https://app.example.com" });
  const session = yield* client.auth.getSession();

  return session?.claims.displayName ?? null;
});
