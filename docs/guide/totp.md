---
description: Enroll an authenticator and complete sign-in with a second factor.
---

# Two-factor authentication

Add `Totp` alongside a primary method. It supports authenticator codes and
single-use recovery codes.

## Enable the authenticator

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, Password, Totp } from "effect-auth";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  strategies: {
    password: Password.make(),
    totp: Totp.make({
      issuer: "My app",
      enrollmentLifetimeMillis: 5 * 60_000,
      revealLifetimeMillis: 60_000,
      clockSkewSteps: 1,
      attemptLimit: 5,
      attemptWindowMillis: 5 * 60_000,
      maximumEvidenceAgeMillis: 60_000,
      allowRecoveryCodeForPending: true,
      lostFactorRecovery: "deny",
      requireImmediateInvalidation: true,
    }),
  },
  defaultStrategy: "password",
});
```

Your `AuthenticationAuthority` decides which accounts require two factors.
Provide `TotpPersistence`, `TotpSecretKeys`, `TotpActionEvidence`, and stateful
sessions with pending-authentication support. This definition omits `sessions`
so you can supply the custom completion Layer below to `AppAuth.layer`.

```ts [sessions.ts]
import { Layer } from "effect";

import { AppAuth } from "./auth";
import { sessionPolicy } from "./auth-config";

export const SessionsLive = AppAuth.sessions
  .completionLayer({
    pendingLifetimeMillis: 5 * 60_000,
    attemptLimit: 5,
  })
  .pipe(Layer.provideMerge(AppAuth.sessions.statefulLayer(sessionPolicy)));
```

Supply your stateful session store, `PendingAuthentication` store, authentication
authority, crypto, and hooks to this Layer. A correct password can then produce a
pending proof instead of failing when a second factor is required.

## Begin enrollment

```ts [enroll.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const enroll = Effect.fn("app.enrollTotp")(function* (
  commandId: string,
  accountName: string,
  actionProof: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.beginEnrollment("totp", { commandId, accountName, actionProof });
});
```

This requires an authenticated caller and fresh action evidence. The public result
contains the enrollment ID. The secret and provisioning URI are delivered through
a temporary `totp-enrollment` reveal for your QR-code screen.

## Confirm the first code

```ts [confirm.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const confirm = Effect.fn("app.confirmTotp")(function* (
  commandId: string,
  enrollmentId: string,
  code: string,
  actionProof: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.confirmEnrollment("totp", {
    commandId,
    enrollmentId,
    code,
    actionProof,
  });
});
```

Show the private `recovery-codes` reveal once and let the user save it. Keep both
reveals out of ordinary query caches, logs, and persisted UI state.

## Finish a two-factor sign-in

```ts [verify.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const verify = Effect.fn("app.verifyTotp")(function* (
  pendingCredential: string,
  code: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.verifyPending("totp", { pendingCredential, code });
});
```

```text
password accepted
  → pending proof cookie (not a session)
  → authenticator code
  → verifyPending
  → consume pending proof + issue session
```

Use `auth.recoverPending("totp", { pendingCredential, code })` for a recovery
code. Each code is consumed once. A replay or exhausted attempt budget fails closed.

## Expose private reveals over HTTP

```ts [totp-routes.ts]
import { Schema } from "effect";
import * as Http from "effect-auth/OperationHttp";
import { makeSessionContract } from "effect-auth/SessionContract";
import { makeTotpContract } from "effect-auth/TotpContract";

const sessions = makeSessionContract(
  "app/Auth/sessions",
  Schema.Struct({
    displayName: Schema.String,
  }),
);
const totp = makeTotpContract("app/Auth/totp", sessions);

export const transport = Http.make({
  enroll: Http.route(totp.operations.Begin, {
    path: "/auth/totp/enroll",
    credentials: { actionProof: "session" },
    reveals: ["totp-enrollment"],
  }),
  confirm: Http.route(totp.operations.Confirm, {
    path: "/auth/totp/confirm",
    credentials: { actionProof: "session" },
    reveals: ["recovery-codes"],
  }),
});
```

The client must install a finite private reveal collector. See
[HTTP and client state](./http-and-client) for transport setup and workflow lifetime.
