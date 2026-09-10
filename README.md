# Effect Auth

Composable authentication, sessions, and identity workflows for Effect.

Effect Auth owns security-sensitive authentication behavior. Applications provide
identity authority, persistence, protocol verification, and credential delivery.
Optional adapters support Drizzle databases, Cloudflare, OAuth/OIDC, and WebAuthn.

## Password sign-in

Define your session claims and authentication methods, then call them from an Effect:

<!-- #region password-sign-in -->

```ts
import { Effect, Schema } from "effect";
import { Auth, Password } from "effect-auth";

class AppAuth extends Auth.Service<AppAuth>()("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  strategies: { password: Password.make() },
  defaultStrategy: "password",
}) {}

export const signIn = Effect.fn("app.signIn")(function* (email: string, password: string) {
  const auth = yield* AppAuth;

  return yield* auth.signIn({ email, password });
});
```

<!-- #endregion password-sign-in -->

An `Authenticated` result contains a session with typed `claims.displayName`.
Before running, configure sessions and supply your persistence and account Layers
to `AppAuth.layer`. Provide `Auth.AuthRequest` per request to deliver credentials
to cookies or native storage. See the [application composition example](examples/auth/src/getting-started.ts)
and [runnable password example](examples/auth/src/password-methods.ts) for the setup.

Start with the [documentation](https://effect-auth.com) and
[consumer examples](examples/auth). The public library lives in
[`packages/effect-auth`](packages/effect-auth); examples are leaf workspaces.

## Development

Install Bun and Vite+, then run:

```sh
vp install
vp run patch:tsgo
vp run ready
```

The [toolchain guide](docs/TOOLCHAIN.md) covers release setup and contributor rules.
Shared versions live in the root catalog. Formatting, linting, strict TypeScript,
package exports, dependency purity, tests, and builds use Vite+.

## License

[MIT](LICENSE)
