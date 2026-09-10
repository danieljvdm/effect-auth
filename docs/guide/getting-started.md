---
description: Define authentication methods and connect your application's services.
---

# Getting started

Effect Auth composes authentication methods, sessions, and identity workflows with
Effect. Your application supplies account authority, persistence, and credential
delivery. Operations keep expected failures and service requirements in their types.

The package is pre-production and uses Effect v4. Start with the version-matched
examples in this repository.

## Run an example

Install [Bun](https://bun.sh) and [Vite+](https://viteplus.dev/guide/), then run:

```sh
git clone https://github.com/danieljvdm/effect-auth.git
cd effect-auth
vp install
vp run patch:tsgo
vp run -F @effect-auth/example-auth example:password-methods
```

The password example uses real cryptography with disposable storage and demonstration
screening, delivery, and factor services. See [examples](./examples) for other methods
and database integrations.

## Define authentication

Declare the claims carried by your sessions and the methods your application accepts:

<!--@include: ../../README.md#password-sign-in-->

The default strategy lets you call `auth.signIn(input)`. With named strategies,
call `auth.signIn("strategy", input)`. An `Authenticated` result contains a session
with typed `claims.displayName`; a method can also require an additional factor.

## Supply application services

Before running `signIn`, provide the services required by `AppAuth.layer`:

| Boundary            | Application responsibility                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Session policy      | Configure `AppAuth.sessions` with stateful or signed sessions.                                      |
| Accounts and claims | Resolve your subject identifier, account eligibility, and session claims.                           |
| Persistence         | Implement the method's storage ports or select a database adapter.                                  |
| Request binding     | Supply `Auth.RequestBindingConfig` with a dedicated keyring.                                        |
| Credential delivery | Provide `Auth.AuthRequest` for each invocation to deliver credentials to cookies or native storage. |

Credentials travel through private delivery commands. They do not appear in public
operation results. The [composition example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/getting-started.ts)
shows the service wiring; the [password consumer](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/password-method-consumer.ts)
shows the method boundary in detail.

## Add only what you need

Use `effect-auth/Auth` and `effect-auth/Password` for direct module imports, or root
namespaces as shown above. Import optional database and protocol adapters through
their own subpaths and install their required peers. The [module reference](../reference/modules)
explains the import graph and browser-safe contracts.

Continue with [how it fits together](./authentication), then choose your
[session strategy](./sessions) and authentication methods from the sidebar.
