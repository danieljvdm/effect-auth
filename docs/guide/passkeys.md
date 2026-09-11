---
description: Begin a passkey ceremony, call the browser, and verify the response.
---

# Passkeys

Passkey sign-in has three steps: create the challenge on your server, ask the
browser to authenticate, and verify the response on your server.

## Enable passkeys

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, Passkey, Sessions } from "effect-auth";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
  strategies: {
    passkey: Passkey.make({
      relyingParty: {
        id: "app.example.com",
        name: "My app",
        origins: ["https://app.example.com"],
      },
    }),
  },
  defaultStrategy: "passkey",
});
```

Use your actual relying-party ID and exact allowed origins. Changing these can
make existing passkeys unusable.

## Begin sign-in on the server

```ts [begin-passkey.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const beginPasskey = Effect.fn("app.beginPasskey")(function* (
  flowId: string,
  commandId: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.signIn({ flowId, commandId, profileId: "default" });
});
```

Return the challenge to the browser. The request-binding credential is delivered
privately; keep it associated with this flow.

## Ask the browser to authenticate

```ts [passkey-browser.ts]
import { Effect } from "effect";
import type { PasskeyAuthenticationStarted } from "effect-auth/Passkey";
import { makeSimpleWebAuthnPasskeyBrowser } from "effect-auth/PasskeyBrowser";

export const authenticate = Effect.fn("app.authenticatePasskey")(function* (
  started: PasskeyAuthenticationStarted,
) {
  const browser = yield* makeSimpleWebAuthnPasskeyBrowser();

  return yield* browser.authenticate({ started, mediation: "required" });
});
```

Keep the Effect's Scope open for the ceremony. Interrupting it cancels that
ceremony. Import `PasskeyBrowser` only in the browser; it requires
`@simplewebauthn/browser`.

## Complete sign-in on the server

```ts [complete-passkey.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const completePasskey = Effect.fn("app.completePasskey")(function* (
  flowId: string,
  bindingCredential: string,
  response: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.completeSignIn({ flowId, bindingCredential, response });
});
```

Send the browser's serialized response through the protected transport. A session
is issued only after server verification and the current account checks succeed.
The [Atom workflow](./http-and-client#compose-a-passkey-workflow) connects these steps.

## Install the server verifier

```ts [passkey-protocol.ts]
import { layerSimpleWebAuthnPasskeyProtocol } from "effect-auth/PasskeySimpleWebAuthn";

export const PasskeyProtocolLive = layerSimpleWebAuthnPasskeyProtocol({
  profiles: [
    {
      profileId: "default",
      generation: 1,
      rpId: "app.example.com",
      rpName: "My app",
      origins: ["https://app.example.com"],
      developmentLocalhost: false,
      residentKey: "required",
      userVerification: "required",
      primarySignIn: true,
      attestation: "none",
      algorithms: [-7, -257],
    },
  ],
});
```

Provide this Layer with your passkey persistence, account/claims services, and
session configuration. Install its `@simplewebauthn/server` and `tldts` peers.
Keep the verifier profile consistent with the method's relying-party configuration.

## Registration and management

| Task                                   | Strategy and methods                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Create an account with a passkey       | `Passkey.makeRegistration` → `register`, `completeRegistration`.                 |
| Add, list, rename, or remove a passkey | `Passkey.makeManagement` and its authenticated operations.                       |
| Confirm a protected password change    | `effect-auth/PasskeyPassword` binds the assertion to a prepared password intent. |

These require explicit application authority. A registration ceremony must not
silently become a login ceremony or link an existing account. See
[passkey persistence](../reference/adapters#passkeys) for transaction ownership.
