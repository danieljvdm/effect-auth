---
description: Connect OAuth providers to your auth service and handle sign-in callbacks.
---

# OAuth setup

Set up the auth service once, then add [GitHub](./github), [Google](./google), or
[another OAuth/OIDC provider](#other-providers).

## Enable sign-in

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, OAuth, Sessions } from "@yielded/auth";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
  strategies: {
    social: OAuth.make({
      policy: {
        generation: 1,
        lifetimeMillis: 5 * 60_000,
        claimLifetimeMillis: 30_000,
        retentionMillis: 10 * 60_000,
        settlementTimeoutMillis: 5_000,
      },
    }),
  },
  defaultStrategy: "social",
});
```

`OAuth.make` signs in accounts with an existing provider link. To create accounts
during sign-in, use `OAuth.makeRegistration` with your registration schema and
account provisioning service.

## Supply the services

Provide your provider Layer, transaction encryption, and allowed return routes:

```ts [oauth-live.ts]
import { Layer } from "effect";
import { OAuthReturnTargets, OAuthTransactionProtector } from "@yielded/auth/OAuth";

import { AppAuth } from "./auth";
import { transactionKeys } from "./auth-config";
import { GitHubLive } from "./github";

export const OAuthLive = AppAuth.layer.pipe(
  Layer.provide(GitHubLive),
  Layer.provide(OAuthTransactionProtector.xchacha20poly1305(transactionKeys)),
  Layer.provide(OAuthReturnTargets.exactRoutes(["/account"])),
);
```

Use a dedicated encryption keyring. Supply the remaining account lookup, claims,
[OAuth persistence](../reference/adapters#oauth), session, and
`Auth.RequestBindingConfig` Layers from your application.

For browser access, declare `signIn` and `completeSignIn` as shared actions and
mount them with [the HTTP adapter](./http-and-client#expose-another-method).
Map `requestBinding` to `"request-binding"` on completion so the server reads the
private binding from its cookie. The [shared contract](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-contract.ts)
and [server example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts)
show the full wiring.

## Complete the callback

After the provider redirects back, submit its response and the saved flow ID to
`completeSignIn`. This is the local server call; shared actions inject
`requestBinding` automatically.

<!-- prettier-ignore -->
```ts
const auth = yield* AppAuth;
const result = yield* auth.completeSignIn({
  flowId,
  requestBinding,
  provider: "github",
  callbackId: "github",
  response: { _tag: "Code", state, code, issuer },
});
```

Use the provider and callback ID that started the flow. `requestBinding` is the
original private credential, and `issuer` comes from the callback's `iss` parameter.
GitHub requires `https://github.com/login/oauth`; never rewrite the returned issuer.
Handle provider denial with the `Error` response variant.

The callback GET serves a public page. That page completes sign-in through a
same-origin protected POST; the GET itself must not exchange the code. Keep callback
values out of logs and clear them from the page URL after reading them. The
[browser example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-client.ts)
handles parsing and dispatch. After an uncertain exchange, start a fresh sign-in
instead of retrying the code.

## Use the authenticated provider profile

The protocol result separates the stable provider/issuer/subject identity from
`profile`. The profile includes available `displayName`, `handle`, `avatarUrl`,
`profileUrl`, `email`, and `emailVerified`, plus bounded `providerData` with the
provider's original field names and null values. GitHub names take precedence over
usernames, with a username fallback when the name is empty or absent.

`GitHubUserProfile` from `@yielded/auth/GitHub` covers every documented field in
GitHub's authenticated [`/user` response](https://docs.github.com/en/rest/users/users#get-the-authenticated-user),
including account metadata returned with `read:user`. `OidcUserProfile` from
`@yielded/auth/OpenIdClient` covers the [standard OIDC user claims](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims)
present in a verified ID token. These adapters do not add scopes, fetch email lists
or UserInfo, or retain unknown response fields, tokens, nonce, or protocol secrets
as profile data. Missing profile fields remain absent; GitHub nullable fields remain
null in `providerData`. GitHub's `/user` email is not asserted to be verified.

For returning sign-in, `ClaimsForOAuth.resolve(credential, verified)` receives the
fresh verified profile only after the provider identity matches an active local
credential. Existing resolvers that accept only `credential` continue to work.
Select the public session fields deliberately:

```ts [profile-claims.ts]
import { Effect, Layer } from "effect";

import { AppAuth, accounts } from "./auth";

export const OAuthClaimsLive = Layer.succeed(AppAuth.strategies.social.ClaimsForOAuth, {
  resolve: (credential, verified) =>
    accounts.claims(credential.revision.subjectId).pipe(
      Effect.map((local) => ({
        ...local,
        displayName: verified.profile?.displayName ?? local.displayName,
      })),
    ),
});
```

For first registration, the original profile is retained in the server-side
`OAuthRegistrationIntent.profile` snapshot. Registration authority callbacks and
Drizzle's `encodeSubjectInsert({ intent, registration }, ids)` can read it when
provisioning the local account. The browser's `RegistrationRequired` result contains
only the reference, expiry, and return target; it does not receive or resubmit the
profile. Existing intents without a profile remain valid. No account, credential,
session, or database reset is required.

Provider-specific data can be narrowed with the exported Schema:

```ts
import { GitHubUserProfile } from "@yielded/auth/GitHub";
import { Schema } from "effect";

const decodeGitHubProfile = Schema.decodeUnknownEffect(GitHubUserProfile);
// After checking the trusted identity.provider is "github":
// const github = yield* decodeGitHubProfile(verified.profile?.providerData);
// github.name, github.login, github.bio, github.company, github.plan, ...
```

Profiles are metadata, not local identity, roles, MFA assurance, or permission to
link accounts. A provider's email verification flag does not grant automatic linking.
Profile URLs are not trusted redirect or server-fetch targets. Keep full provider
snapshots out of logs and expose only the fields your application needs in session
claims. Connected-grant metadata also carries the captured profile under its existing
account authorization; refresh does not promise to update that snapshot.

## Combine providers

Use one `OpenIdClient.layer` for all hosts. Separate provider Layers would replace
the same service.

```ts [providers.ts]
import * as GitHub from "@yielded/auth/GitHub";
import * as OpenIdClient from "@yielded/auth/OpenIdClient";

import { github, google } from "./auth-config";

export const ProvidersLive = OpenIdClient.layer({
  providers: [GitHub.provider(github), google],
});
```

Here `github` contains the options passed to `GitHub.layer`, and `google` contains
the provider entry passed to `OpenIdClient.layer` on their setup pages.

## Other providers

Use `OpenIdClient.layer` for other OAuth and OpenID Connect hosts. The
[Google example](./google#configure-the-provider) shows an OIDC entry: set your
provider key, issuer, credentials, and callback URL. Discovery verifies the host's
capabilities.

For plain OAuth, set `protocol: "oauth"` and provide `authorizationEndpoint`,
`tokenEndpoint`, `identitySource.url`, and `identitySource.decodeIdentity`.
The decoder receives the authenticated profile response and returns an Effect
containing the provider's stable `subject` and optional display profile.
Set any required `scopes` explicitly.

### Defaults and overrides

| Setting                             | Default                        |
| ----------------------------------- | ------------------------------ |
| `callbackId`                        | Provider key, such as `github` |
| `configurationGeneration`           | `1`                            |
| `issuance`                          | `active`                       |
| `timeoutSeconds`                    | `10` (allowed range: 1–30)     |
| Generic `tokenEndpointAuthMethod`   | `client_secret_basic`          |
| OIDC `scopes` / signature algorithm | `["openid"]` / RS256           |
| Plain OAuth `scopes`                | `[]`                           |

Use `callbacks` instead of `redirectUri` for several named destinations.
Secrets must be redacted; load them with `Config.redacted` or wrap validated server
configuration with `Redacted.make`.

S256 PKCE and response issuer validation are required by default. Set
`responseIssuerMode: "unsupported"` only for hosts without issuer responses;
callback isolation checks still apply. Public clients use explicit
`authentication: { method: "none", publicClient: true }` instead of `clientSecret`.
Invalid settings fail Layer construction with `OpenIdClientConfigurationError`.

## Rotate configuration

When credentials or protocol settings change, assign a new
`configurationGeneration`. Retain the old entry with `issuance: "retired"` until
its outstanding flows expire. Keep exactly one active generation per provider.

Pass the entries in `GitHub.layer({ registrations: [...] })` or the
`OpenIdClient.layer` provider list. The default generation `1` does not track
credential changes automatically.

## Accounts and API access

| Task                                 | API                                           |
| ------------------------------------ | --------------------------------------------- |
| Sign in an existing account          | `OAuth.make`                                  |
| Create an account                    | `OAuth.makeRegistration`                      |
| Link or unlink a login method        | `OAuth.makeAccounts`                          |
| Save a grant for provider API access | `OAuth.makeConnected` / `makeConnectedModule` |

Linking requires an authenticated local account and explicit authorization.
Provider email alone is never permission to merge accounts.

For API access, use `GitHub.layerConnected` or `OpenIdClientConnected.layer` with
explicit permission profiles. Access tokens stay inside
`ConnectedAccess.withAccessToken`; retain retired configurations while grants
reference them. See the [GitHub API example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/github-oauth-app.ts)
for profiles, token storage, refresh, and revocation. Never retry an uncertain refresh.

### Email and social login

The combined [contract](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-contract.ts),
[server](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts), and
[client](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-client.ts)
share sessions across email, GitHub, and optional Google sign-in.

On `RegistrationRequired`, submit signup data to `auth.register` with the original
flow ID, returned reference, and a fresh command ID. Start a new sign-in after
`RegistrationAccepted`; handle `ProvisioningPending` through your application.
Bind accounts to the provider/issuer/subject identity. Protect private routes with
`auth.requireSession()`; HTTP middleware only supplies request context.

<details>
<summary>Upgrading from the previous GitHub issuer</summary>

Older adapters used `https://github.com` instead of `https://github.com/login/oauth`.
Start fresh sign-in attempts after upgrading. Pending flows with the old issuer
cannot complete, and old GitHub login bindings are not reused or linked automatically.
Register or explicitly link the corrected identity.

Revoke old connected grants before upgrading, then reconnect. Do not rewrite stored
issuer values: they are part of identity keys and encrypted transaction context.
Other providers, local subjects, and application data do not need a reset.

</details>
