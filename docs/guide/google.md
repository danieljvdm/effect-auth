---
description: Set up Google sign-in with Yielded Auth.
---

# Google

Sign in with Google's OpenID Connect provider. For the shared auth service and
HTTP wiring, start with [OAuth setup](./oauth).

## Get your credentials

Create an OAuth client in the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
and copy its client ID and client secret. Add your callback page as an authorized
redirect URI, for example `https://app.example.com/auth/google/callback`.

## Configure the provider

Read the credentials and your app's origin from server configuration:

```ts [google.ts]
import { Redacted } from "effect";
import * as OpenIdClient from "@yielded/auth/OpenIdClient";

import { config } from "./config";

export const GoogleLive = OpenIdClient.layer({
  providers: [
    {
      provider: "google",
      protocol: "oidc",
      issuer: "https://accounts.google.com",
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: Redacted.make(config.GOOGLE_CLIENT_SECRET),
      tokenEndpointAuthMethod: "client_secret_post",
      redirectUri: `${config.AUTH_ORIGIN}/auth/google/callback`,
    },
  ],
});
```

Install `openid-client` and [provide `GoogleLive` to your auth service](./oauth#supply-the-services).
The redirect URL must match the URL registered with Google. Your app serves that
callback page. The default `openid` scope is enough for sign-in.

## Sign in

Inside a server Effect with your configured `AppAuth`:

<!-- prettier-ignore -->
```ts
const auth = yield* AppAuth;
const started = yield* auth.signIn({
  flowId,
  commandId,
  provider: "google",
  callbackId: "google",
  returnTarget: "/account",
});
```

Use fresh IDs for the flow and command. Redirect to
`Redacted.value(started.authorizationUrl)` and retain the flow ID across navigation.
Your callback page then [completes sign-in](./oauth#complete-the-callback).

See the [server example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-server.ts)
for Google and GitHub together, or [combine providers](./oauth#combine-providers)
with your own configuration.
