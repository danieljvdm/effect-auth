---
description: Configure GitHub OAuth, redirect to sign in, and complete the callback.
---

# OAuth

Configure a provider, start sign-in, and exchange the callback for an application
session. This example uses a GitHub OAuth App.

## Enable OAuth sign-in

```ts [auth.ts]
import { Schema } from "effect";
import { Auth, OAuth } from "effect-auth";

export class AppAuth extends Auth.Service<AppAuth>()("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
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
}) {}
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

```ts [begin-oauth.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const beginOAuth = Effect.fn("app.beginOAuth")(function* (
  flowId: string,
  commandId: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.signIn({
    flowId,
    commandId,
    provider: "github",
    callbackId: "github",
    returnTarget: "/account",
  });
});
```

Use the returned `authorizationUrl` for the redirect. It is redacted because it
contains OAuth state. Persist the private request binder in the initiating client.

## Complete the callback

```ts [complete-oauth.ts]
import { Effect } from "effect";

import { AppAuth } from "./auth";

export const completeOAuth = Effect.fn("app.completeOAuth")(function* (
  flowId: string,
  requestBinding: string,
  state: string,
  code: string,
) {
  const auth = yield* AppAuth;

  return yield* auth.completeSignIn({
    flowId,
    requestBinding,
    provider: "github",
    callbackId: "github",
    response: { _tag: "Code", state, code },
  });
});
```

```text
beginOAuth → persist flow → redirect
  → GitHub callback + original binder
  → verify state / PKCE / provider identity
  → resolve your local account → issue session
```

Handle provider denial through the `Error` callback variant. Do not retry an
exchange after an unknown outcome. Start a new authorization flow instead.

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
