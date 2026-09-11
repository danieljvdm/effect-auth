---
description: See how methods, sessions, and application services connect.
---

# How it fits together

Your app owns users and storage. Effect Auth verifies authentication methods and
issues sessions through those services.

```text
your request handler
  → AppAuth
      → password / passkey / email / OAuth
          → verify evidence
          → your account authority
          → session persistence
      → public result
  → private cookie delivery
```

## One service, named methods

```ts [auth.ts]
import { Effect, Schema } from "effect";
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

export const signIn = Effect.fn("app.signIn")(function* (email: string, password: string) {
  const auth = yield* AppAuth;

  return yield* auth.signIn({ email, password });
});

export const beginPasskey = Effect.fn("app.beginPasskey")(function* (
  flowId: string,
  commandId: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.signIn("passkey", { flowId, commandId, profileId: "default" });
});
```

Method inputs and results come from the selected strategy. Adding a method adds
its required services to the Layer's type.

`Auth.make` declares the service synchronously. Provide `AppAuth.layer` at the
application boundary, or yield `AppAuth.make` to acquire an instance directly in
your Scope. `Auth.Service<Self>()` is available when you prefer a class declaration.

## Share an API with the browser

Define claims and exposed actions with `AuthContract.make`, then bind that
contract with `Auth.make(AuthApi, options)`. The same actions become local methods,
HTTP endpoints, `client.auth` methods, and importable Effect atoms. Installing a
strategy makes its methods available locally; only declared actions are exposed
remotely. [Getting started](./getting-started) shows the shared contract.

Both local and remote calls validate the declared schemas. Local calls resolve
`Auth.AuthRequest` from Effect context when they run; a shared service never
captures the current request. `auth.getSession()` reads its credential and returns
a typed session or `null`. `auth.requireSession()` protects a handler, while
`auth.signOut()` and `auth.renewSession()` deliver credential changes through the
same boundary. See [sessions](./sessions) for outcomes and failure behavior.

## What goes where

```text
src/
├─ auth-contract.ts    # shared claims and exposed actions
├─ auth.ts             # server methods and session selection
├─ auth-config.ts      # session policy, keys, allowed origins
├─ auth-persistence.ts # database mappings and transaction authority
├─ auth-accounts.ts    # account lookup, claims, provisioning
├─ auth-http.ts        # selected routes and cookie policy
└─ auth-client.ts      # queries, mutations, and UI workflows
```

Keep `Auth.AuthRequest` local to each request. Keep reusable services in Layers
whose resources belong to the application's Scope.

## Results and credentials

| Value                                                    | Where it goes                       |
| -------------------------------------------------------- | ----------------------------------- |
| Session claims, public status, challenge reference       | Operation result.                   |
| Session cookie, request binding, continuation credential | Private credential command sink.    |
| TOTP enrollment secret, recovery codes                   | Explicit, temporary private reveal. |

The [HTTP adapter](./http-and-client) implements these transport boundaries.
[Effect Atom](./http-and-client#connect-client-state) composes the browser workflow.

## Commit order matters

```text
prepare mutation → commit your transaction → read receipt → deliver credentials
```

`LifecycleHooks` run around these boundaries. A durable notification needs an
outbox in the same transaction. If the commit outcome is unknown, look it up
through the owning adapter; never assume repeating credential issuance is safe.

Continue with [sessions](./sessions) or [database adapters](../reference/adapters).
