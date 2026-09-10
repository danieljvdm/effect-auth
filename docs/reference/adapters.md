---
description: Connect Drizzle storage to your authentication service.
---

# Adapters and persistence

Choose the adapter for your database and runtime. You own the tables and migrations;
the adapter maps them to Effect Auth's storage services.

## Connect password storage

For SQLite on Bun, create the Drizzle client and provide the resulting service:

```ts [auth-persistence.ts]
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Drizzle from "drizzle-orm/effect-sqlite-bun";
import { Effect, Layer } from "effect";
import { makePasswordPersistenceServices } from "effect-auth/DrizzleSqliteBun";
import { PasswordPersistence } from "effect-auth/Password";

import { passwordMapping } from "./schema";

export const PasswordPersistenceLive = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* Drizzle.makeWithDefaults({});
    const services = yield* makePasswordPersistenceServices(db, passwordMapping);

    return Layer.succeed(PasswordPersistence, services.passwordPersistence);
  }),
).pipe(Layer.provide(SqliteClient.layer({ filename: "auth.sqlite" })));
```

`passwordMapping` maps your account, identifier, credential, revision, attempt,
and receipt tables. It is a `PasswordPersistenceMapping` from `effect-auth/Drizzle`.
Supply `LifecycleHooks` and your other account/session Layers at the composition root.

## Compose the application Layer

```ts [auth-live.ts]
import { Layer } from "effect";
import { Auth } from "effect-auth";

import { AppAuth } from "./auth";
import { AccountsLive } from "./auth-accounts";
import { requestBinding } from "./auth-config";
import { PasswordPersistenceLive } from "./auth-persistence";
import { SessionPersistenceLive } from "./session-persistence";
import { SessionsLive } from "./sessions";

export const AuthLive = AppAuth.layer.pipe(
  Layer.provide(SessionsLive),
  Layer.provide(Auth.RequestBindingConfig.layer(requestBinding)),
  Layer.provide(Layer.mergeAll(PasswordPersistenceLive, SessionPersistenceLive, AccountsLive)),
);
```

The `auth-*` imports are your application modules. TypeScript reports any remaining
service requirements. Keep `Auth.AuthRequest` out of this shared Layer; supply it
for each request or use [the HTTP adapter](../guide/http-and-client).

## Choose a driver

| Database / runtime    | Direct import                   |
| --------------------- | ------------------------------- |
| PostgreSQL            | `effect-auth/DrizzlePostgres`   |
| PGlite                | `effect-auth/DrizzlePglite`     |
| MySQL                 | `effect-auth/DrizzleMysql2`     |
| libSQL                | `effect-auth/DrizzleLibsql`     |
| SQLite on Bun         | `effect-auth/DrizzleSqliteBun`  |
| SQLite on Node        | `effect-auth/DrizzleSqliteNode` |
| SQLite WASM           | `effect-auth/DrizzleSqliteWasm` |
| Cloudflare D1         | `effect-auth/DrizzleD1`         |
| Durable Object SQLite | `effect-auth/DrizzleSqliteDo`   |

Install the selected driver's Effect SQL and Drizzle peers. Import it directly to
avoid loading unrelated adapters. Shared mapping types live in `effect-auth/Drizzle`.

## Passwords

Use `makePasswordPersistenceServices` for verification and mutation storage;
`makePasswordRegistrationServices` supplies registration authority. Reset support
also needs a proof mapping.

```text
password mutation transaction
  ├─ charge/check attempt budget
  ├─ check account + credential revisions
  ├─ update password and security revision
  └─ commit receipt
```

Use the adapter's coordinator when combining authentication with application writes.
Do not put standalone services inside an untracked raw Drizzle transaction.
Prepared intents retain admission charges even after sensitive material is erased.

## Email

`makeEmailSignInServices` performs lookup. `makeEmailRegistrationServices` and
`makeEmailAddressServices` own account creation and address changes. Address changes
consume their proof and advance security revisions in the same transaction.
Notifications run after commit; durable delivery needs an outbox.

## OAuth

Use `makeOAuthSignInServices` for durable flow and identity state. Registration
and linking have separate factories and authorities. An external provider exchange
cannot be rolled back with your database; retain the original decision and require
a fresh flow after an uncertain exchange.

## Passkeys

`makePasskeyPersistenceServices` stores ceremonies; credential, enrollment,
registration, and management services have separate factories. Completion rechecks
the challenge, relying party, account revision, and credential revision before
committing its result.

## Connected OAuth grants

`makeOAuthConnectedServices` and `makeOAuthConnectedRevocationServices` coordinate
provider grants, refresh attempts, and revocation. Keep the durable grant identity
and refresh claim so another worker cannot repeat an uncertain refresh.

<details>
<summary>D1 and Durable Object transaction boundaries</summary>

D1 uses a preplanned conditional batch, not an interactive transaction. Allocate
registration IDs before the batch. Do not replay a caller-owned mutation after an
ambiguous response.

Durable Object SQLite callbacks inside `transactionSync` must remain synchronous.
Do verification and asynchronous work outside that callback, then recheck the
captured authority before committing.

</details>

See [integration references](../guide/examples#database-adapters) for concrete
table definitions and mappings.
