---
description: Configure session lifetimes, read a session, and sign out.
---

# Sessions

Use `AppAuth.sessions` to configure and inspect the sessions issued by your
[auth service](./getting-started#define-your-auth-service).

## Configure sessions

```ts [sessions.ts]
import { AppAuth } from "./auth";

export const SessionsLive = AppAuth.sessions.layer({
  issuer: "my-app",
  audience: "my-app",
  generation: 1,
  idleLifetimeMillis: 30 * 60 * 1000,
  absoluteLifetimeMillis: 7 * 24 * 60 * 60 * 1000,
  renewalIntervalMillis: 5 * 60 * 1000,
  maximumIssuedAbsoluteLifetimeMillis: 7 * 24 * 60 * 60 * 1000,
  maximumTokenBytes: 4096,
  requireImmediateInvalidation: true,
});
```

This selects stateful sessions and authentication completion. Supply
`AppAuth.sessions.StatefulSessionPersistence` and `AuthenticationAuthority`
from your application adapters, then provide `SessionsLive` to `AppAuth.layer`.

| Strategy                                  | How it verifies                                      | Revocation                                 |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `layer(policy)` / `statefulLayer(policy)` | Checks the stored session.                           | Immediate, through persistence.            |
| `statelessLayer(policy, keys)`            | Verifies a signed token.                             | Existing tokens remain valid until expiry. |
| `stateAssistedLayer(policy, keys)`        | Verifies a signed token and checks current validity. | Uses `SignedSessionValidity`.              |

The lower-level strategy Layers need a separate `completionLayer()` for issuing
sessions. Choose stateless sessions only when your policy accepts delayed invalidation.

## Read the current session

```ts [current-session.ts]
import { Effect, Redacted } from "effect";

import { AppAuth } from "./auth";

export const currentSession = Effect.fn("app.currentSession")(
  function* (cookie: string) {
    const sessions = yield* AppAuth.sessions.SessionStrategy;
    const session = yield* sessions.verify(Redacted.make(cookie));

    return { subjectId: session.subjectId, name: session.claims.displayName };
  },
  Effect.catchTag("SessionInvalid", () => Effect.succeed(null)),
);
```

An invalid or expired credential becomes `null` here. An unavailable session store
still fails, allowing your handler to return a service error.

## Sign out

```ts [sign-out.ts]
import { Effect } from "effect";
import { Auth } from "effect-auth";
import { AuthCredentialCommandCollector, guest } from "effect-auth/Operations";

import { AppAuth } from "./auth";

export const signOut = Effect.fn("app.signOut")(function* (cookie: string) {
  const request = yield* Auth.AuthRequest;

  return yield* AppAuth.sessions.operations.SignOut.invoke(guest, {
    credential: cookie,
  }).pipe(Effect.provideService(AuthCredentialCommandCollector, request.credentialCommandSink));
});
```

Provide session operation handlers from `AppAuth.sessions.handlersLayer(...)`.
The private command sink clears the cookie. For HTTP applications,
[map the sign-out operation](./http-and-client#define-the-routes) and let the
server adapter handle cookie delivery.

## Session lifecycle

```text
verify password / passkey / provider
  → approve current account and credential revision
  → commit session
  → deliver cookie
  → return public session
```

A failed sign-out can clear the local cookie without proving server revocation.
Do not report global sign-out when the persistence operation failed.

<details>
<summary>Additional factors and step-up</summary>

Configure `completionLayer({ pendingLifetimeMillis, attemptLimit })` with
`PendingAuthentication` persistence to support a second factor. A pending proof
is not an authenticated session. [TOTP](./totp) shows completion with an authenticator.

`SessionStrategy.inspect` returns private provenance for authorization decisions;
ordinary `verify` results omit it. Step-up persists a challenge bound to the source
session and credential revision. Completion rechecks both before replacing the
session; a stale session cannot be upgraded.

</details>
