---
"effect-auth": minor
---

Define shared auth contracts for request-aware local services, named HTTP clients, and automatically synchronized Effect Atom state. Compose auth routes with existing HttpApi groups and use an optional React provider with scoped session hydration and shared Atom invalidation.

BEHAVIOR CHANGE: Create service definitions with `Auth.make(contractOrId, options)`; construct instances with `yield* AppAuth.make`. Include `credentials` in manually provided `AuthRequest` values. Mount shared actions with `http.routes()`; session lookup and required-session lookup use GET; sign-out and renewal use POST at their named `/auth` paths. Apply `http.protect` to custom credential-producing HTTP workflows. Set `basePath` in `AuthContract.make` to change their shared prefix.
