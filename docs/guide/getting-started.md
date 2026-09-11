---
description: Define your authentication service and call it from your application.
---

# Getting started

Define a shared contract, choose your server methods, and call them from your
application. The contract also supplies your HTTP endpoints and browser client.

## Define the shared contract

```ts [auth-contract.ts]
import { Schema } from "effect";
import * as AuthContract from "effect-auth/AuthContract";

export const AuthApi = AuthContract.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  actions: (sessions) => ({ signIn: AuthContract.passwordSignIn(sessions) }),
});
```

The contract includes `getSession`, `requireSession`, `signOut`, and
`renewSession`. The `actions` callback explicitly adds password sign-in.
Keep this module free of server configuration, keys, and persistence.

## Define your auth service

```ts [auth.ts]
import { Auth, Password, Sessions } from "effect-auth";

import { AuthApi } from "./auth-contract";

export const AppAuth = Auth.make(AuthApi, {
  sessions: Sessions.stateful(),
  strategies: { password: Password.make() },
  defaultStrategy: "password",
});
```

`claims` defines the data your application puts in each session. The password
method verifies credentials; your account service supplies `displayName`.
`Auth.make` declares a yieldable service. `AppAuth.layer` acquires its scoped
resources; constructing the definition performs no I/O.

## Sign in

```ts [sign-in.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const signIn = Effect.fn("app.signIn")(function* (email: string, password: string) {
  const auth = yield* AppAuth;
  const result = yield* auth.signIn({ email, password });

  if (result._tag === "Authenticated") {
    return { status: "signed-in" as const, name: result.session.claims.displayName };
  }

  return { status: "additional-factor-required" as const };
});
```

Run this Effect from your request handler. Errors stay in the Effect error channel;
see [passwords](./passwords#handle-a-rejected-sign-in) for a rejected-login response.

## Connect your application

```text
request handler
  ├─ Auth.AuthRequest        credentials + caller + delivery, per request
  └─ AppAuth.layer
       ├─ session storage   selected by Sessions.stateful(...)
       ├─ account Layer     credential lookup + claims
       └─ persistence Layer transactions + durable records
```

`AppAuth.layer` tells TypeScript which services remain to be provided. Use
[session configuration](./sessions#configure-sessions) and
[persistence adapters](../reference/adapters) to supply them. For HTTP,
[the server adapter](./http-and-client#configure-the-server) supplies the request
boundary and writes credential cookies.

## Add another method

For local composition, you can pass an identifier and claims directly to
`Auth.make`. Each strategy gets a name. Pass that name when calling a non-default
strategy:

```ts [auth-with-passkeys.ts]
import { Schema } from "effect";
import { Auth, Passkey, Password, Sessions } from "effect-auth";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
  strategies: {
    password: Password.make(),
    passkey: Passkey.make({
      relyingParty: {
        id: "app.example.com",
        name: "My app",
        origins: ["https://app.example.com"],
      },
    }),
  },
  defaultStrategy: "password",
});
```

Call `auth.signIn({ email, password })` for passwords or
`auth.signIn("passkey", { flowId, commandId, profileId: "default" })` for passkeys.
The [passkey guide](./passkeys) shows the browser ceremony and completion.
To expose it remotely, add the selected actions to a shared contract as shown in
[HTTP and client state](./http-and-client#compose-a-passkey-workflow).

## Package status

This repository targets Effect v4 and is not published yet. The npm package
currently named `effect-auth` is a different project; an install command will be
added when this library has a published package name.
