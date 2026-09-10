---
description: Expose selected operations and compose client workflows with Effect Atom.
---

# HTTP and client state

Define contracts once, then select which operations your server exposes. Keep private credentials at the transport boundary and client workflows in Effect Atom.

| Module                | Responsibility                                             |
| --------------------- | ---------------------------------------------------------- |
| `OperationHttp`       | Shared transport configuration and errors                  |
| `OperationHttpServer` | Request security, operation dispatch, and private delivery |
| `OperationHttpClient` | One HTTP attempt per operation call                        |
| `Atom`                | Queries, mutations, workflows, and subject state lifetimes |

## Server and client boundaries

`OperationHttpServer` owns transport security and private credential translation;
applications explicitly configure cookies, origins, CSRF, callbacks and native
exposure. `OperationHttpClient` performs one attempt per call. Ambiguous writes
require a fresh authoritative lookup or a new flow, never an automatic mutation
retry. Pure `SessionContract`, `PasskeyContract` and `TotpContract` imports keep
server implementations out of browser bundles.

## Shared browser contracts

Import `SessionContract`, `PasskeyContract`, and `TotpContract` directly when defining operations shared by a browser and server. They do not install strategy, persistence, or verifier Layers.

```ts
import * as SessionContract from "effect-auth/SessionContract";
import * as PasskeyContract from "effect-auth/PasskeyContract";
import * as TotpContract from "effect-auth/TotpContract";
```

## Effect Atom

`Atom` owns authentication workflows and their state lifetimes. Mount account
atoms in the current subject registry. Authentication completion and subject
replacement settle together, disposing the previous registry before publishing
the next. Device acquisition remains cancellable; admitted credential responses
settle before cancellation can publish a different subject. React only renders
and dispatches these atoms.

Keep cross-query invalidation on mutation reactivity keys. React renders and dispatches; multi-step authentication workflows belong in atoms.

The [Studio browser and server examples](./examples.md#http-and-browser-clients) show the shared contracts, HTTP transport, and client state together.
