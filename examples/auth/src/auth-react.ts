import { useAtom, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as AuthReact from "effect-auth/React";
import { createElement } from "react";

import { AuthApi } from "./auth-contract";

// This definition is safe to share. Each mounted Provider acquires its own client
// and owns the registries that are replaced when authentication changes.
export const BrowserAuth = AuthReact.make(AuthApi, { baseUrl: "https://app.example.com" });

export function MemberPanel() {
  const auth = BrowserAuth.useAuth();
  const session = useAtomValue(auth.session);
  const [signOutResult, signOut] = useAtom(auth.signOut);

  if (session._tag === "Initial") return createElement("p", null, "Loading session…");
  if (session._tag === "Failure")
    return createElement("p", { role: "alert" }, "Session unavailable.");
  if (session.value === null) return createElement("p", null, "Signed out.");

  return createElement(
    "section",
    null,
    createElement("p", null, `Hello, ${session.value.claims.displayName}.`),
    createElement(
      "button",
      { type: "button", disabled: signOutResult.waiting, onClick: () => signOut(undefined) },
      "Sign out",
    ),
  );
}

// The application can wrap this in its usual error boundary for setup failures.
// Server rendering uses the fallback until a request-owned value is supplied.
export function BrowserApp() {
  return createElement(
    BrowserAuth.Provider,
    { fallback: createElement("p", null, "Loading session…") },
    createElement(MemberPanel),
  );
}

// Services and workflow atoms can use the same client. A direct call still
// updates the provider's authentication lifetime and invalidates its queries.
export const signOutFromEffect = Effect.fn("example.signOutFromEffect")(function* (
  auth: ReturnType<typeof BrowserAuth.useAuth>,
) {
  return yield* auth.client.auth.signOut();
});
