import { Effect } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import * as Client from "effect-auth/Client";

import { AuthApi } from "./auth-contract";

// Both constructors are inert. A registry or application Layer owns acquisition.
export const AppClient = Client.make(AuthApi, { baseUrl: "https://app.example.com" });
export const auth = AuthAtom.make(AppClient);

export const currentMember = Effect.fn("example.remoteMember")(function* () {
  const client = yield* AppClient;
  const session = yield* client.auth.getSession();

  return session?.claims.displayName ?? null;
});

// Uses the same scoped client and account lifetime as the generated auth atoms.
export const memberName = auth.runtime.atom(currentMember());
