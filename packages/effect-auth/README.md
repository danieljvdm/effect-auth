# @yielded/auth

Composable authentication workflows for Effect applications: sign-in, sessions,
OAuth, passwords, passkeys, email and phone proofs, and TOTP.

```sh
vp add @yielded/auth@beta effect@4.0.0-rc.112
```

The package owns security-sensitive workflow contracts. Applications own identity,
persistence, protocol verification, and delivery adapters. Resources live in the
caller’s Scope; credentials stay outside public results and telemetry.

Optional database, platform, browser, and OAuth adapters have separate exports.
The root import does not load their peer dependencies. Effect is supplied by the host.

See the [authentication guide](https://github.com/danieljvdm/effect-auth/blob/main/docs/guide/authentication.md)
and [consumer examples](https://github.com/danieljvdm/effect-auth/tree/main/examples/auth).
