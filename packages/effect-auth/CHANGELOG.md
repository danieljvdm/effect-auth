# @yielded/auth

## 0.1.0-beta.1

### Minor Changes

- [#5](https://github.com/yielded-dev/auth/pull/5) [`32be91d`](https://github.com/yielded-dev/auth/commit/32be91d23f8b17e8eff479a4ed2456b1d8fdc373) Thanks [@danieljvdm](https://github.com/danieljvdm)! - Define shared auth contracts for request-aware local services, named HTTP clients, and automatically synchronized Effect Atom state. Compose auth routes with existing HttpApi groups and use importable Effect Atom queries and mutations with scoped session hydration and shared invalidation.

  BEHAVIOR CHANGE: Create service definitions with `Auth.make(contractOrId, options)` and `Client.make(contract, options)`; construct instances with their `.make` Effects. Include `credentials` in manually provided `AuthRequest` values. Mount shared actions with `http.routes()`; session lookup and required-session lookup use GET; sign-out and renewal use POST at their named `/auth` paths. Apply `http.protect` to custom credential-producing HTTP workflows. Set `basePath` in `AuthContract.make` to change their shared prefix.

- [`f8916bd`](https://github.com/yielded-dev/auth/commit/f8916bdb4e13264f332ddb036f3cd9d8ba0bb95c) Thanks [@danieljvdm](https://github.com/danieljvdm)! - Publish Yielded Auth as `@yielded/auth` with the same root namespaces and direct module exports. Use `@yielded/auth` and `@yielded/auth/<Module>` in application imports.

### Patch Changes

- [#2](https://github.com/yielded-dev/auth/pull/2) [`d85cc73`](https://github.com/yielded-dev/auth/commit/d85cc73b18c5c4939cf7466a76277df203192551) Thanks [@danieljvdm](https://github.com/danieljvdm)! - Preserve module boundaries and native root namespaces so consumers can tree-shake unused implementations. Expose SessionContract from the package root alongside the other shared contracts.
