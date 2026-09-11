# Authentication examples

Consumer examples compose public `@yielded/auth` exports with application-owned
identity, persistence, and delivery. `getting-started.ts` shows application
composition; `session-contract.ts` and `session-http.ts` show the minimal session
service, cookies, selected routes, and protected HttpApi group. The runnable password, email, phone, session, and proof programs
use local example data.

`auth-contract.ts` owns the shared named API; `auth-server.ts` mounts it beside
application routes. `auth-client.ts` declares the client and its atoms;
`auth-react.ts` uses the application's standard Atom registry and React hooks.
`auth-ssr.ts` shows request-owned server rendering and browser hydration;
the host keeps each Scope alive until its render or mounted application finishes.

Run a declared example through `vp run -F @yielded/example-auth <task>`.
All consumer files are checked by the root validation command. TOTP adapter
fixtures that exercise private implementation helpers live under the library’s
`test/fixtures`, where they remain typechecked.

`login-contract.ts`, `login-server.ts`, and `login-client.ts` compose email OTP
and GitHub signup/sign-in through one Auth service, stateful sessions, HTTP cookies,
and Effect Atom workflows. Google OIDC is optional. The host supplies durable
registration/session/proof adapters and `EmailProofDelivery`, real provider
credentials, and keyrings. These files are typechecked composition examples;
`example:email-methods` is the existing runnable email journey. See the
[OAuth guide](../../docs/guide/oauth.md) for callback and provider setup.
