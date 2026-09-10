---
description: Runnable consumers and application composition examples.
---

# Examples

Examples live in the leaf workspace
[`examples/auth`](https://github.com/danieljvdm/effect-auth/tree/main/examples/auth).
They consume the package through its public exports. Follow the
[getting started setup](./getting-started#run-an-example), then run an example:

```sh
vp run -F @effect-auth/example-auth example:password-methods
```

## Authentication methods

| Task                       | Demonstrates                                         |
| -------------------------- | ---------------------------------------------------- |
| `example:password-methods` | Password registration, sign-in, and account changes. |
| `example:email-methods`    | Email codes, magic links, and address workflows.     |
| `example:phone`            | Phone OTP backed by SQLite on Bun.                   |
| `example:password-hashing` | Password hashing policy and verification.            |

The [GitHub OAuth composition](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/github-oauth-app.ts)
shows provider and application wiring. It is a composition reference, not a standalone server.

## Sessions and identity

| Task               | Demonstrates                                                   |
| ------------------ | -------------------------------------------------------------- |
| `example:sessions` | Session lifecycle and strategy selection.                      |
| `example:identity` | Application-owned subject identifiers and identity resolution. |
| `example:proofs`   | Bound proofs and private delivery.                             |
| `example:hooks`    | Lifecycle hook composition.                                    |

## Database adapters

| Task                          | Demonstrates               |
| ----------------------------- | -------------------------- |
| `example:drizzle-sqlite-bun`  | Drizzle and SQLite on Bun. |
| `example:drizzle-sqlite-wasm` | Drizzle and SQLite WASM.   |

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
