---
description: Define your authentication service and call it from your application.
---

# Getting started

Define a service, choose your methods, and call them from your application.

## Define your auth service

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, Password } from "effect-auth";

export class AppAuth extends Auth.Service<AppAuth>()("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  strategies: { password: Password.make() },
  defaultStrategy: "password",
}) {}
```

`claims` defines the data your application puts in each session. The password
method verifies credentials; your account service supplies `displayName`.

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
  ├─ Auth.AuthRequest        caller + cookie delivery, per request
  └─ AppAuth.layer
       ├─ session Layer     storage + expiry policy
       ├─ account Layer     credential lookup + claims
       └─ persistence Layer transactions + durable records
```

`AppAuth.layer` tells TypeScript which services remain to be provided. Use
[session configuration](./sessions#configure-sessions) and
[persistence adapters](../reference/adapters) to supply them. For HTTP,
[the server adapter](./http-and-client#configure-the-server) supplies the request
boundary and writes credential cookies.

## Add another method

Each strategy gets a name. Pass that name when calling a non-default strategy:

```ts [auth-with-passkeys.ts]
import { Schema } from "effect";
import { Auth, Passkey, Password } from "effect-auth";

export class AppAuth extends Auth.Service<AppAuth>()("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
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
}) {}
```

Call `auth.signIn({ email, password })` for passwords or
`auth.signIn("passkey", { flowId, commandId, profileId: "default" })` for passkeys.
The [passkey guide](./passkeys) shows the browser ceremony and completion.

## Package status

This repository targets Effect v4 and is not published yet. The npm package
currently named `effect-auth` is a different project; an install command will be
added when this library has a published package name.
