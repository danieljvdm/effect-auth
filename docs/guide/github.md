---
description: Set up GitHub sign-in with Yielded Auth.
---

# GitHub

Sign in with a GitHub OAuth App. For the shared auth service and HTTP wiring,
start with [OAuth setup](./oauth).

## Get your credentials

Create an OAuth App in [GitHub developer settings](https://github.com/settings/developers)
and copy its client ID and client secret. Set its callback URL to your app's
callback page, for example `https://app.example.com/auth/github/callback`.

## Configure the provider

Read the credentials and your app's origin from server configuration:

```ts [github.ts]
import { Redacted } from "effect";
import * as GitHub from "@yielded/auth/GitHub";

import { config } from "./config";

export const GitHubLive = GitHub.layer({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: Redacted.make(config.GITHUB_CLIENT_SECRET),
  redirectUri: `${config.AUTH_ORIGIN}/auth/github/callback`,
});
```

Install `openid-client` and [provide `GitHubLive` to your auth service](./oauth#supply-the-services).
The redirect URL must match the URL registered with GitHub. Your app serves that
callback page; `GitHub.layer` configures the provider.

GitHub sign-in requests `read:user`. It does not require an email address or
repository access.

## Sign in

Inside a server Effect with your configured `AppAuth`:

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

Use fresh IDs for the flow and command. Redirect to
`Redacted.value(started.authorizationUrl)` and retain the flow ID across navigation.
The [browser example](https://github.com/yielded-dev/auth/blob/main/examples/auth/src/login-client.ts)
shows the equivalent client and Atom workflow.

Your callback page then [completes sign-in](./oauth#complete-the-callback).
Pass GitHub's `iss` parameter through as `response.issuer`.

For additional hosts, [combine providers](./oauth#combine-providers) with `GitHub.provider`.
For GitHub API access, see [connected accounts](./oauth#accounts-and-api-access).
