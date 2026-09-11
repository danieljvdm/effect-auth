---
description: Configure GitHub OAuth, redirect to sign in, and complete the callback.
---

# OAuth

Configure a provider, start sign-in, and exchange the callback for an application
session. This example uses a GitHub OAuth App. Email OTP can share the same
Auth service and sessions; Google OIDC is an optional second OAuth provider.

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

## Combine GitHub with Google OIDC

Install one protocol Layer containing all OAuth providers. Merging separate GitHub
and OpenIdClient Layers replaces the same `OAuthProtocol` service; it does not
combine their provider tables. `gitHubOAuthAppProvider` retains GitHub's specialized
token receipt and error handling inside the generic provider list:

```ts [providers.ts]
import { gitHubOAuthAppProvider } from "@yielded/auth/GitHub";
import { openIdClientOAuthProtocolLayer } from "@yielded/auth/OpenIdClient";
import {
  OAuthCallbackId,
  OAuthIssuer,
  OAuthProviderKey,
  OAuthRedirectUri,
} from "@yielded/auth/OAuth";

import { githubRegistration, googleClientId, googleClientSecret } from "./auth-config";

export const ProvidersLive = openIdClientOAuthProtocolLayer({
  providers: [
    gitHubOAuthAppProvider(githubRegistration),
    {
      provider: OAuthProviderKey.make("google"),
      protocol: "oidc",
      configurationGeneration: 1,
      issuance: "active",
      issuer: OAuthIssuer.make("https://accounts.google.com"),
      responseIssuerMode: "required",
      clientId: googleClientId,
      authentication: { method: "client_secret_post", secret: googleClientSecret },
      callbacks: [
        {
          callbackId: OAuthCallbackId.make("google"),
          redirectUri: OAuthRedirectUri.make("https://app.example.com/auth/google/callback"),
        },
      ],
      scopes: ["openid"],
      idTokenSignedResponseAlg: "RS256",
    },
  ],
  timeoutSeconds: 10,
});
```

`githubRegistration` has the same fields as one registration above;
`googleClientSecret` is a `Redacted<string>` loaded from server configuration.
Replace the example origin and register each exact callback with its provider.
The [typechecked server example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts)
loads actual client IDs and secrets through `Config`; Google is enabled only with
`google: true`. Keep provider configuration out of browser imports.

GitHub requests only `read:user`, with no repository or private-email permission.
Google requests `openid` for Gmail and Workspace account sign-in, with no mailbox
access. Neither provider's email is required or returned as verified contact evidence.
The local subject binds to the immutable `(provider, issuer, subject)` tuple;
Google's `sub` is the identity key, not email. See the official
[Google OIDC guide](https://developers.google.com/identity/openid-connect/openid-connect),
[discovery metadata](https://accounts.google.com/.well-known/openid-configuration), and
[GitHub scope definitions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

One active generation per provider issues new flows. Retain retired generations
and their credentials through all issued flow horizons; completion never substitutes
new credentials. Duplicate generations and callback reuse across issuers without
issuer responses fail configuration. Both providers use PKCE S256; OIDC also checks
nonce, issuer, audience, signature and token time. Google callbacks must include
`iss`; GitHub's configured response mode rejects it. Malformed responses fail closed,
and transport failures remain unavailable rather than authorizing another exchange.
Generic OIDC entries and custom OAuth `identitySource.decodeIdentity` hooks remain
available; no application dispatcher is required.

## Email OTP and GitHub in one application

Use `Email.makeCode`, `Email.makeRegistration`, and `OAuth.makeRegistration` under
one `Auth.make`, with one `Sessions.stateful()` configuration. Email uses
`EmailProofDelivery` from `@yielded/auth/Proofs`, independently of the OAuth protocol.
It does not need a second OAuth provider or a Google client registration. A single
GitHub installation can continue using `gitHubOAuthAppProtocolLayer`.

The typechecked [shared contract](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-contract.ts),
[server](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts), and
[client/Atom workflows](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-client.ts)
show public signup, both sign-in methods, stateful session cookies, and merging an
existing `HttpRouter` with the auth routes. The host supplies the durable stores,
identity authority, email delivery, and secret keyrings; this is a composition example,
not a configured hosted application.

The contract maps named email actions to the `email` and `emailRegistration`
strategies. OAuth actions select the `social` strategy through the default. All
methods share `client.auth.getSession()`, `client.auth.signOut()`, `auth.session`,
and `auth.signOut`. Multi-step email and redirect workflows live in Effect atoms.
A successful authentication retires the previous account's workflow state; render
the new session rather than chaining component promises after completion.

For OAuth signup, `completeSignIn` returns `RegistrationRequired`. Submit the
reference, original flow ID, a fresh command ID and the application's registration
data through `auth.register`; the server supplies the private registration bearer
and original binder from cookies. The durable registration owner persists and
rechecks the original external tuple with the application data, allocating one
stable local subject and credential or protected pending work. Display name in this
example is an application signup field, not provider-verified evidence. No email or
provider profile is needed. Exact replay uses the stored decision; unknown commit
outcomes never permit re-provisioning or repeating the provider exchange.

Registration accepts the account but does not issue a session. After
`RegistrationAccepted`, start a fresh sign-in flow; handle `ProvisioningPending`
through application-owned recovery authority before signing in. Email registration
likewise uses begin → request → verify → complete before a fresh sign-in. Use the
[existing email proof controls](./codes) for expiry, attempts, delivery and abuse
budgets. One browser cookie slot supports one active authentication flow at a time.

Keep login and callback pages public and inert on GET. Continue protecting private
HTML/assets and application APIs with session checks; `http.middleware` supplies
request context but does not itself require authentication. Public generated-site
hosts can remain separate public routes. Remove a previous access gateway only
when the replacement routes and session checks are ready.

For an explicitly authorized fresh-start adoption, allocate new stable local subjects
with explicit provider or verified-email bindings. The application's reset scope is
its old accounts, auth/session/proof records, per-account trips and conversations,
settings, encrypted saved API keys, and browser caches. Retire generated sites and
build/address-directory artifacts that belong to those discarded trips deliberately.
Do not attach old storage namespaces to new subjects. Users re-register and re-enter
their API keys; matching emails never link accounts. Execute that reset as a separate
application release decision, after preparing the replacement login and protection.

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
  response: { _tag: "Code", state, code },
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
