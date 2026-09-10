# Authentication examples

Consumer examples compose public `effect-auth` exports with application-owned
identity, persistence, and delivery. `getting-started.ts` shows application
composition; `session-contract.ts` and `session-http.ts` show the minimal session
service, cookies, selected routes, and protected HttpApi group. The runnable password, email, phone, session, and proof programs
use local example data.

Run a declared example through `vp run -F @effect-auth/example-auth <task>`.
All consumer files are checked by the root validation command. TOTP adapter
fixtures that exercise private implementation helpers live under the library’s
`test/fixtures`, where they remain typechecked.
