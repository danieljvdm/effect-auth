---
description: Public imports, browser-safe contracts, and optional adapters.
---

# Public modules

Start with `Auth.Service` to compose authentication for an application. Choose
individual modules for your methods, session strategy, and integration boundaries.

## Imports and tree shaking

Core modules support both root namespaces and direct subpaths:

```ts
import { Identity, SessionContract } from "effect-auth";
// The same modules, selected directly:
import * as IdentityModule from "effect-auth/Identity";
import * as SessionContractModule from "effect-auth/SessionContract";
```

Prefer a direct subpath when bundle size or module-loading cost matters. Named
imports such as `import { stringSubjectId } from "effect-auth/Identity"` let a
bundler discard unrelated identity operations. Root namespaces are convenient,
but retaining a namespace as a value can retain its other exports. Native ESM
loads the root's entire static dependency graph; tree shaking requires a bundler.

Optional adapters are direct imports, for example `effect-auth/DrizzlePostgres`,
`effect-auth/OpenIdClient`, or `effect-auth/PasskeyBrowser`. Install only the peers
required by the selected adapters. `effect-auth/Testing` remains test-only.

## Application composition

Import these as `effect-auth/<Module>` or as namespaces from `effect-auth`:

| Modules                       | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `Auth`                        | Application service, strategies, and request boundaries.               |
| `Identity`, `Schema`          | Subject identifiers, claims, and shared schemas.                       |
| `Operations`, `Hooks`         | Operation contracts and lifecycle hooks.                               |
| `Sessions`                    | Session strategies, persistence ports, and lifecycle operations.       |
| `Password`                    | Password registration, sign-in, and account changes.                   |
| `Email`, `PhoneOtp`, `Proofs` | Email and phone methods, bound proofs, and private delivery.           |
| `Totp`, `Passkey`             | Additional factors and passkey workflows.                              |
| `OAuth`                       | Provider sign-in, registration, linked accounts, and connected grants. |

## Browser and transport boundaries

Keep shared browser/server definitions in the contract modules. Import browser
helpers separately from server verifiers and persistence adapters.

| Modules                                              | Purpose                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `SessionContract`, `PasskeyContract`, `TotpContract` | Shared public schemas without server orchestration.          |
| `OperationHttp`                                      | Shared operation HTTP descriptors.                           |
| `OperationHttpClient`, `OperationHttpServer`         | Client execution and server routing.                         |
| `Atom`                                               | Effect Atom queries, mutations, and client workflows.        |
| `Http`, `HttpServer`, `Rpc`                          | Lower-level HTTP and RPC integrations; direct subpaths only. |

See [HTTP and client state](../guide/http-and-client) for contract sharing and
client workflow composition.

## Optional adapters

These are available through direct subpaths only:

| Modules                                                                         | Integration                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `OpenIdClient`, `OpenIdClientConnected`                                         | OAuth/OIDC verification and connected grant management. |
| `GitHub`                                                                        | GitHub provider configuration and operations.           |
| `PasskeySimpleWebAuthn`, `PasskeyBrowser`                                       | Server verification and browser WebAuthn ceremonies.    |
| `PasskeyPassword`                                                               | Password-backed authority for passkey workflows.        |
| `Drizzle`                                                                       | Shared Drizzle adapter contracts.                       |
| `DrizzlePostgres`, `DrizzlePglite`, `DrizzleMysql2`                             | PostgreSQL, PGlite, and MySQL drivers.                  |
| `DrizzleLibsql`, `DrizzleD1`                                                    | libSQL and Cloudflare D1 drivers.                       |
| `DrizzleSqliteBun`, `DrizzleSqliteNode`, `DrizzleSqliteWasm`, `DrizzleSqliteDo` | SQLite drivers by runtime.                              |
| `Cloudflare`                                                                    | Cloudflare platform integration.                        |

The [adapter guide](./adapters) covers transaction authority, durable receipts,
and runtime constraints.

## Focused service modules

These direct subpaths expose individual services and contracts for lower-level
composition. Start with `Auth.Service` for application authentication.

| Modules                                                     | Responsibility                                      |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `AuthSession`, `AuthStore`, `AuthTokenCodec`                | Session values, storage, and token codecs.          |
| `PasswordAuth`, `PasswordCredentialStore`, `PasswordHasher` | Password services, storage, and hashing.            |
| `EmailOtp`, `EmailOtpSender`                                | Email OTP service and delivery.                     |
| `IdentityResolver`, `Policy`                                | Identity resolution and authentication policy.      |
| `Errors`, `Workflows`, `WebCrypto`                          | Errors, workflow composition, and cryptography.     |
| `Testing`                                                   | Test-only helpers; exclude from production imports. |

API comments and signatures live beside the
[public source modules](https://github.com/danieljvdm/effect-auth/tree/main/packages/effect-auth/src).
