---
"effect-auth": minor
---

Define shared auth contracts for request-aware local services, named HTTP clients, and automatically synchronized Effect Atom state. Expose configured sessions through cookie middleware and typed HttpApi protection.

BEHAVIOR CHANGE: Pass a shared contract or service identifier as the first argument to `Auth.define`, and include `credentials` in manually provided `AuthRequest` values. Mount shared actions with `http.routes()`; session lookup, required-session lookup, sign-out, and renewal now use POST at `/auth/getSession`, `/auth/requireSession`, `/auth/signOut`, and `/auth/renewSession`. Set `basePath` in `AuthContract.make` to change their shared prefix.
