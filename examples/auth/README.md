# Authentication examples

Consumer examples compose public `effect-auth` exports with application-owned
identity, persistence, and delivery. `getting-started.ts` shows application
composition; `session-contract.ts` and `session-http.ts` show the minimal session
service, cookies, selected routes, and protected HttpApi group. The runnable password, email, phone, session, and proof programs
use local example data.

`auth-contract.ts` owns the shared named API; `auth-server.ts` mounts it beside
application routes. `auth-react.ts` shows the optional React provider and ordinary
Atom hooks. `auth-ssr.ts` shows request-owned server rendering and browser hydration;
the host keeps each Scope alive until its render or mounted application finishes.

Run a declared example through `vp run -F @effect-auth/example-auth <task>`.
All consumer files are checked by the root validation command. TOTP adapter
fixtures that exercise private implementation helpers live under the library’s
`test/fixtures`, where they remain typechecked.
