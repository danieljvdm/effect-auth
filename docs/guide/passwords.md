---
description: Register accounts, sign in, and change passwords.
---

# Passwords

Use `Password.make()` for existing-account sign-in. Configure registration and
recovery to enable full password management.

## Enable passwords

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, Password, Sessions } from "effect-auth";

import { proofPolicy } from "./auth-config";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
  strategies: {
    password: Password.make({
      registration: Schema.Struct({ displayName: Schema.NonEmptyString }),
      policy: Password.defaultPasswordMethodPolicy,
      reset: {
        template: "password-reset",
        secret: { _tag: "Token" },
        policy: proofPolicy,
      },
    }),
  },
  defaultStrategy: "password",
});
```

The [email guide](./codes) shows the proof-policy fields. Your application
controls account creation and recovery delivery. For sign-in only, use
`password: Password.make()` as in [getting started](./getting-started).

## Register an account

```ts [register.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const register = Effect.fn("app.register")(function* (
  requestId: string,
  email: string,
  newPassword: string,
  displayName: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.register({
    requestId,
    email,
    newPassword,
    registration: { displayName },
  });
});
```

Generate `requestId` once per submission and retain it for an exact retry.
`RegistrationAccepted` does not reveal whether the account already existed.

## Handle a rejected sign-in

```ts [sign-in.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const signIn = Effect.fn("app.signIn")(
  function* (email: string, password: string) {
    const auth = yield* AppAuth;

    return yield* auth.signIn({ email, password });
  },
  Effect.catchTag("PasswordRejected", () =>
    Effect.succeed({ _tag: "InvalidCredentials" as const }),
  ),
);
```

Use the same message for a missing account and a wrong password. Storage and
hashing failures remain errors; do not turn them into successful sign-ins.
An `Authenticated` result carries the session; an additional-factor result
must be completed before granting access.

## Change a password

```ts [change-password.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const changePassword = Effect.fn("app.changePassword")(function* (
  commandId: string,
  currentPassword: string,
  newPassword: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.changePassword({ commandId, currentPassword, newPassword });
});
```

This call requires an authenticated `Auth.AuthRequest`. Applications requiring
another factor also supply `actionProof`. The result reports the session
invalidation behavior of your selected strategy.

## Supply the services

| Service                                             | Your implementation                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `PasswordPersistence`                               | Credential storage and atomic mutations; [Drizzle mappings](../reference/adapters#passwords). |
| `AppAuth.strategies.password.ClaimsForPassword`     | Build session claims from your account.                                                       |
| `AppAuth.strategies.password.RegistrationAuthority` | Provision accounts under your registration policy.                                            |
| `CompromisedPasswords`                              | Screen new passwords against your maintained checker.                                         |
| `PasswordActionEvidence`                            | Authorize password changes and additional-factor requirements.                                |

Hashing uses the package's bounded KDF service. Keep normalization stable for
stored credentials, and let the password method apply its verification policy.

<details>
<summary>Reset and retry boundaries</summary>

Password recovery uses `requestReset` → `verifyReset` → `completeReset`. Enable
`reset` with an email template and proof policy, and supply email delivery and
proof persistence. A reset requires an independently verified address.

Keep continuation credentials in private delivery. A consumed proof or an unknown
commit outcome is not permission to repeat a password mutation. Prepared-password
intents bind the original action, credential revision, and replacement verifier.

See the [complete password composition](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/password-methods.ts)
for recovery and factor authorization.

</details>
