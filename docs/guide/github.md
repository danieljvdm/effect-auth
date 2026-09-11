---
description: Set up GitHub sign-in with Yielded Auth.
---

# GitHub

Sign in with a GitHub OAuth App. Start with [OAuth setup](./oauth).

## Get your credentials

Create an OAuth App in [GitHub developer settings](https://github.com/settings/developers).
Set its callback URL to `https://app.example.com/auth/github/callback`.

## Configure the provider

```ts [github.ts]
import { Redacted } from "effect";
import * as GitHub from "@yielded/auth/GitHub";
import * as AuthHttp from "@yielded/auth/Http";

import { AppAuth } from "./auth";
import { config } from "./config";

export const http = AuthHttp.make(AppAuth, {
  origin: config.AUTH_ORIGIN,
  oauth: {
    providers: {
      github: GitHub.provider({
        clientId: config.GITHUB_CLIENT_ID,
        clientSecret: Redacted.make(config.GITHUB_CLIENT_SECRET),
      }),
    },
  },
});
```

Install `openid-client` and [mount the auth routes](./oauth#supply-the-services).
The callback URL is derived from `origin` and served by `http.routes()`.
[Customize callbacks →](./oauth#customize-callbacks)

GitHub sign-in requests `read:user`; no email address or repository access is required.

## Sign in

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

Use fresh IDs and redirect to `Redacted.value(started.authorizationUrl)`.
The callback completes sign-in and redirects to `returnTarget`.
See the [browser example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-client.ts)
for the client and Atom workflow.

For GitHub API access, see [connected accounts](./oauth#accounts-and-api-access).
