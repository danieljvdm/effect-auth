# Effect Auth

Composable authentication, sessions, and identity workflows for Effect.

Effect Auth owns security-sensitive authentication behavior. Applications provide
identity authority, persistence, protocol verification, and credential delivery.
Optional adapters support Drizzle databases, Cloudflare, OAuth/OIDC, and WebAuthn.

Start with the [authentication guide](docs/guide/authentication.md) and
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
