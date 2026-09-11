---
description: Configure GitHub OAuth, redirect to sign in, and complete the callback.
---

# OAuth

Configure a provider, start sign-in, and exchange the callback for an application
session. This example uses a GitHub OAuth App.

The calls below use the local service inside existing Effects. A browser client
needs explicitly declared [shared actions](./http-and-client#expose-another-method),
including a request-field mapping for the private request binder.

## Enable OAuth sign-in

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, OAuth, Sessions } from "@yielded/auth";

export const AppAuth = Auth.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
  strategies: {
    github: OAuth.make({
      policy: {
        generation: 1,
        lifetimeMillis: 5 * 60_000,
        claimLifetimeMillis: 30_000,
        retentionMillis: 10 * 60_000,
        settlementTimeoutMillis: 5_000,
      },
    }),
  },
  defaultStrategy: "github",
});
```

`OAuth.make` signs in an existing linked identity. For account creation, use
`OAuth.makeRegistration` with your registration schema and provisioning authority.

## Configure the GitHub provider

```ts [github-provider.ts]
import { Config, Effect, Layer } from "effect";
import { gitHubOAuthAppProtocolLayer } from "@yielded/auth/GitHub";
import { OAuthCallbackId, OAuthRedirectUri } from "@yielded/auth/OAuth";

export const GitHubProtocolLive = Layer.unwrap(
  Effect.gen(function* () {
    const clientId = yield* Config.string("GITHUB_CLIENT_ID");
    const clientSecret = yield* Config.redacted("GITHUB_CLIENT_SECRET");

    return gitHubOAuthAppProtocolLayer({
      registrations: [
        {
          configurationGeneration: 1,
          issuance: "active",
          clientId,
          clientSecret,
          callbacks: [
            {
              callbackId: OAuthCallbackId.make("github"),
              redirectUri: OAuthRedirectUri.make("https://app.example.com/auth/github/callback"),
            },
          ],
        },
      ],
      timeoutSeconds: 10,
    });
  }),
);
```

Register that exact callback URL in your GitHub OAuth App. The adapter requires
`openid-client`. Other OAuth/OIDC providers use `@yielded/auth/OpenIdClient`.

GitHub's callback includes an `iss` parameter identifying
`https://github.com/login/oauth`. Preserve it as `response.issuer`: the adapter
requires an exact match before exchanging the code. Do not remove or replace a
callback issuer to bypass validation. This is GitHub's
[OAuth issuer](https://docs.github.com/en/apps/github-authentication-discovery-endpoints),
not the issuer for GitHub Actions tokens.

The previous adapter used `https://github.com` and rejected issuer-bearing
callbacks. After upgrading, start fresh sign-in attempts; pending flows captured
with the old issuer cannot complete. Existing GitHub login bindings and connected
grants using the old issuer are not reused or linked automatically. Revoke old
connected grants before upgrading, then register or explicitly link the corrected
GitHub identity and reconnect any required grants. Do not rewrite stored issuer
values: they participate in identity keys and protected transaction context.
Other providers, local subjects, and application data do not need to reset.

## Combine OAuth providers

Use one provider list: separate protocol Layers replace the same `OAuthProtocol`
service. `gitHubOAuthAppProvider` preserves GitHub's response handling within it.

```ts [providers.ts]
import { gitHubOAuthAppProvider } from "@yielded/auth/GitHub";
import { openIdClientOAuthProtocolLayer } from "@yielded/auth/OpenIdClient";

import { githubRegistration, googleOidcRegistration } from "./auth-config";

export const ProvidersLive = openIdClientOAuthProtocolLayer({
  providers: [gitHubOAuthAppProvider(githubRegistration), googleOidcRegistration],
  timeoutSeconds: 10,
});
```

The [server example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts)
shows both registration shapes; `google: true` enables optional Google OIDC.
Replace its example origin and configure server-only credentials and exact callbacks.
GitHub uses [`read:user`](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
without repository access; Google uses [`openid`](https://developers.google.com/identity/openid-connect/openid-connect)
without mailbox access. Retain retired configurations until their outstanding flows expire.

## Email OTP and GitHub in one application

Compose `Email.makeCode`, `Email.makeRegistration`, and `OAuth.makeRegistration`
under one `Auth.make` with `Sessions.stateful()`. The
[contract](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-contract.ts),
[server](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts), and
[client](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-client.ts)
share sessions, HTTP cookies, and Atom workflows. Supply durable stores, provisioning,
keyrings, and [email delivery](./codes#supply-the-services). Google is optional.

`RegistrationRequired` leads to `auth.register` with the original flow ID, returned
reference, fresh command ID, and signup data. After `RegistrationAccepted`, start a
new sign-in; resolve `ProvisioningPending` through your application. Provision stable
local subjects bound to the provider/issuer/subject tuple, not provider email.

Keep login and callback GETs public and inert. Private routes must call
`auth.requireSession()`; `http.middleware` only supplies request context.

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

export const OAuthClaimsLive = Layer.succeed(AppAuth.strategies.github.ClaimsForOAuth, {
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

## Redirect to GitHub

<!-- prettier-ignore -->
```ts
const auth = yield* AppAuth;
const started = yield* auth.signIn({
  flowId,
  commandId,
  provider: "github",
  callbackId: "github",
  returnTarget: "/account",
});
```

Use `Redacted.value(started.authorizationUrl)` at the redirect boundary, with
`Redacted` imported from `effect`. The URL is redacted because it contains OAuth
state. Retain the public flow ID across navigation; deliver the private request
binder through the HTTP cookie boundary.

## Complete the callback

Here `requestBinding` is the original private server credential. A shared action
uses `requestFields: { requestBinding: "request-binding" }` so callers supply only
the public callback fields.

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

```text
signIn → retain flow ID → redirect
  → GitHub callback + original binder
  → verify state / PKCE / provider identity
  → resolve your local account → issue session
```

Handle provider denial through the `Error` callback variant. Do not retry an
exchange after an unknown outcome. Start a new authorization flow instead.

The provider redirect is a GET navigation, but completion is an auth mutation.
With the standard HTTP adapter, the callback page submits the returned values
through a same-origin protected POST from the initiating browser. A raw callback
GET cannot call `completeSignIn` under `http.middleware` and bypass its Origin/CSRF
checks. Keep callback values out of logs and clear them from the page URL after
capturing them. Custom callback hosts must own an equivalent request boundary.

## Provide encryption and return routes

```ts [oauth-security.ts]
import { Layer } from "effect";
import { OAuthReturnTargets, OAuthTransactionProtector } from "@yielded/auth/OAuth";

import { transactionKeys } from "./auth-config";

export const OAuthSecurityLive = Layer.mergeAll(
  OAuthTransactionProtector.xchacha20poly1305(transactionKeys),
  OAuthReturnTargets.exactRoutes(["/account"]),
);
```

Use a dedicated secret keyring for transaction encryption. Provide this Layer,
`GitHubProtocolLive`, OAuth persistence/identity lookup, claims, sessions, and
`Auth.RequestBindingConfig` to your application.

## Login accounts and API connections

| Task                                          | API                                           |
| --------------------------------------------- | --------------------------------------------- |
| Sign in through an existing provider identity | `OAuth.make`                                  |
| Create a new local account                    | `OAuth.makeRegistration`                      |
| Link or unlink a login method                 | `OAuth.makeAccounts`                          |
| Store a grant for calling a provider API      | `OAuth.makeConnected` / `makeConnectedModule` |

Linking requires an authenticated local account and explicit authorization.
A matching provider email is not permission to merge accounts.

For a connected account, use `ConnectedAccess.withAccessToken` to keep the token
inside the provider request:

```ts [read-profile.ts]
import { Effect, Schema } from "effect";
import { OAuthUnavailable, type OAuthGrantId } from "@yielded/auth/OAuth";
import type { AuthInvocation } from "@yielded/auth/Operations";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { connected, profile } from "./connected-account";

const Profile = Schema.Struct({ login: Schema.String });

export const readProfile = Effect.fn("app.readGitHubProfile")(
  function* (caller: AuthInvocation, grantId: typeof OAuthGrantId.Type) {
    const access = yield* connected.ConnectedAccess;
    const http = yield* HttpClient.HttpClient;

    return yield* access.withAccessToken(caller, { grantId, profileKey: profile.key }, (token) =>
      http
        .execute(
          HttpClientRequest.get("https://api.github.com/user", {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "my-app" },
          }).pipe(HttpClientRequest.bearerToken(token)),
        )
        .pipe(
          Effect.flatMap((response) =>
            response.status === 200
              ? response.json.pipe(Effect.mapError(() => OAuthUnavailable.make({})))
              : Effect.fail(OAuthUnavailable.make({})),
          ),
          Effect.flatMap(Schema.decodeUnknownEffect(Profile)),
          Effect.timeout("10 seconds"),
        ),
    );
  },
  Effect.provide(FetchHttpClient.layer),
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual", credentials: "omit" }),
);
```

`connected` and its permission `profile` are application configuration. The
[GitHub connection composition](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/github-oauth-app.ts)
shows their setup. Refresh, revocation, and access use share durable grant state;
never return the token from the callback or retry uncertain refreshes.
