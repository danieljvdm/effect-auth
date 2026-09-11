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
import { Auth, OAuth, Sessions } from "effect-auth";

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
import { gitHubOAuthAppProtocolLayer } from "effect-auth/GitHub";
import { OAuthCallbackId, OAuthRedirectUri } from "effect-auth/OAuth";

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
`openid-client`. Other OAuth/OIDC providers use `effect-auth/OpenIdClient`.

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
import { OAuthReturnTargets, OAuthTransactionProtector } from "effect-auth/OAuth";

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
import { OAuthUnavailable, type OAuthGrantId } from "effect-auth/OAuth";
import type { AuthInvocation } from "effect-auth/Operations";
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
[GitHub connection composition](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/github-oauth-app.ts)
shows their setup. Refresh, revocation, and access use share durable grant state;
never return the token from the callback or retry uncertain refreshes.
