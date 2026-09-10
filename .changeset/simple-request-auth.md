---
"effect-auth": minor
---

Expose configured auth services with request-aware session lookup, renewal, and sign-out, plus cookie middleware and selected HTTP routes.

BEHAVIOR CHANGE: Pass the service identifier as the first argument to `Auth.define` and include `credentials` in manually provided `AuthRequest` values.
