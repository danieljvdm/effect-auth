---
description: Application compositions for authentication, persistence, and HTTP clients.
---

# Examples

Use these source references to connect Effect Auth to your application's accounts,
database, and request handlers. Each composition uses the package's public API.

## Authentication methods

| Source                                                                                                        | Integration                                   |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [Passwords](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/password-methods.ts)        | Registration, sign-in, and account changes.   |
| [Email](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/email-methods.ts)               | Codes, magic links, and address workflows.    |
| [Phone OTP](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/phone-sqlite-bun.ts)        | Phone authentication backed by SQLite on Bun. |
| [Password hashing](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/password-hashing.ts) | Hashing policy and verification.              |

The [GitHub OAuth composition](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/github-oauth-app.ts)
shows provider and application wiring.

## Sessions and identity

| Source                                                                                                 | Integration                                                    |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Sessions](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/sessions.ts)          | Session lifecycle and strategy selection.                      |
| [Identity](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/identity-boundary.ts) | Application-owned subject identifiers and identity resolution. |
| [Proofs](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/proofs.ts)              | Bound proofs and private delivery.                             |
| [Hooks](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/lifecycle-hooks.ts)      | Lifecycle hook composition.                                    |

## Database adapters

| Source                                                                                                       | Integration                |
| ------------------------------------------------------------------------------------------------------------ | -------------------------- |
| [SQLite on Bun](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/drizzle-sqlite-bun.ts) | Drizzle and SQLite on Bun. |
| [SQLite WASM](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/drizzle-sqlite-wasm.ts)  | Drizzle and SQLite WASM.   |

The [Node SQLite](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/drizzle-sqlite-node.ts)
and [libSQL](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/drizzle-libsql.ts)
files provide additional composition references. See [adapters and persistence](../reference/adapters)
for transaction and retry requirements.

## HTTP and browser clients

The Studio example separates
[auth composition](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-auth.ts),
[HTTP server](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-http-server.ts),
and [browser client](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-browser.ts).
These are integration references rather than a packaged application. The
[HTTP and client state guide](./http-and-client) explains their shared contract.

Example stores, keys, delivery services, and policies are disposable development
fixtures. Replace them with your application's authority and durable adapters before
using the same composition in a deployed service.
