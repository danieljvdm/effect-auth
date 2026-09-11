---
description: Request an SMS code and sign in with a phone number.
---

# Phone codes

Use `PhoneOtp` to sign in existing accounts with an SMS code.

## Enable phone sign-in

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, PhoneOtp, Sessions } from "effect-auth";

import { proofKeys } from "./auth-config";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
  strategies: {
    phone: PhoneOtp.make({
      template: "sign-in-sms",
      keys: proofKeys,
    }),
  },
  defaultStrategy: "phone",
});
```

Load `proofKeys` from your secret configuration. The default code has six digits
and expires after five minutes. You can override `digits` and `policy`.

## Send a code

```ts [request-code.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const sendCode = Effect.fn("app.sendCode")(function* (phoneNumber: string) {
  const auth = yield* AppAuth;

  return yield* auth.signIn({ phoneNumber, locale: "en" });
});
```

Use an international number such as `+14155550123`. The result contains a `flowId`
and proof `reference`. The request binder goes through private credential delivery;
your SMS service receives the code.

## Complete sign-in

```ts [complete-phone.ts]
import { Effect } from "effect";
import type { ProofReference } from "effect-auth/Proofs";

import { AppAuth } from "./auth";

export const completePhone = Effect.fn("app.completePhone")(function* (
  flowId: string,
  phoneNumber: string,
  requestBinding: string,
  reference: typeof ProofReference.Encoded,
  code: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.completeSignIn({
    flowId,
    phoneNumber,
    requestBinding,
    reference,
    code,
  });
});
```

```text
sendCode(number)
  → SMS + private request binder
  → user enters code
  → completePhone(original flow, binder, reference, code)
  → session or additional-factor result
```

A consumed code cannot be reused if session issuance subsequently fails. Request
a new code. SMS proves possession; it does not provide phishing resistance.

## Supply the services

| Service                                   | Responsibility                                |
| ----------------------------------------- | --------------------------------------------- |
| `PhoneSignInTargets`                      | Look up your existing phone credential.       |
| `PhoneDeliveryEligibility`                | Apply country and delivery policy.            |
| `SmsProofDelivery`                        | Send the code.                                |
| `ProofPersistence`                        | Enforce expiry, consumption, and rate limits. |
| `AppAuth.strategies.phone.ClaimsForPhone` | Build session claims.                         |

Phone registration and number changes use separate lifecycle operations.
Do not link accounts because their supplied phone strings match. See the
[phone application composition](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/phone-application.ts).
