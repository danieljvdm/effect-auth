---
description: Share HTTP contracts, configure cookies, and build client workflows.
---

# HTTP and client state

Define routes once, then use them on the server and in the browser.

```text
shared contracts → HTTP server → cookies + public response
       └─────────→ typed client → Effect Atom → UI
```

## Define the routes

This transport matches the auth service in the [passkey guide](./passkeys).
Contract modules keep server implementation code out of the browser bundle.

```ts [auth-transport.ts]
import { Schema } from "effect";
import * as Http from "effect-auth/OperationHttp";
import { makePasskeyContract } from "effect-auth/PasskeyContract";
import { makeSessionContract } from "effect-auth/SessionContract";

const sessions = makeSessionContract(
  "app/Auth/sessions",
  Schema.Struct({
    displayName: Schema.String,
  }),
);
const passkey = makePasskeyContract("app/Auth/passkey", sessions);

export const transport = Http.make({
  signIn: Http.route(passkey.operations.Begin, { path: "/auth/sign-in" }),
  completeSignIn: Http.route(passkey.operations.Complete, {
    path: "/auth/sign-in/complete",
    credentials: { bindingCredential: "request-binding" },
  }),
  session: Http.route(sessions.operations.Verify, {
    path: "/auth/session",
    allowInternal: true,
    credentials: { credential: "session" },
  }),
  signOut: Http.route(sessions.operations.SignOut, {
    path: "/auth/sign-out",
    allowInternal: true,
    credentials: { credential: "session" },
  }),
});
```

`credentials` tells the server to read those fields from protected cookies.
The browser client supplies only the public input fields.

## Configure the server

```ts [auth-http.ts]
import { Effect, Layer } from "effect";
import * as Http from "effect-auth/OperationHttp";
import * as HttpServer from "effect-auth/OperationHttpServer";
import { guest } from "effect-auth/Operations";

import { AppAuth } from "./auth";
import { transport } from "./auth-transport";

const configuration = HttpServer.configurationLayer({
  cookies: HttpServer.cookieConfiguration({ prefix: "__Host-app-", secure: true }),
  publicOrigin: "https://app.example.com",
  trustedOrigins: ["https://app.example.com"],
  csrfHeader: "x-app-csrf",
  csrfValue: "auth-operation",
  maximumBodyBytes: 300_000,
  maximumUrlBytes: 8192,
});

const invocation = HttpServer.invocationLayer(
  Effect.fn(function* (_request, credentials) {
    if (credentials.session === undefined) return guest;
    const sessions = yield* AppAuth.sessions.SessionStrategy;
    const session = yield* sessions
      .verify(credentials.session)
      .pipe(Effect.mapError(() => Http.OperationHttpError.make({ reason: "credentials" })));

    return {
      _tag: "Authenticated" as const,
      subjectId: session.subjectId,
      sessionId: session.sessionId,
      assurance: session.assurance,
    };
  }),
);

export const server = HttpServer.make(transport).pipe(
  Effect.provide(Layer.merge(configuration, invocation)),
);
```

Provide the passkey and session operation handler Layers before mounting the
server in your HTTP host. Use your real HTTPS origin; never derive trusted origins
from an untrusted request header.

## Connect client state

```ts [auth-client.ts]
import { Effect, Layer } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import * as HttpClient from "effect-auth/OperationHttpClient";
import { Atom } from "effect/unstable/reactivity";

import { transport } from "./auth-transport";

export const makeAuthClient = Effect.gen(function* () {
  const client = yield* HttpClient.make({
    baseUrl: "https://app.example.com",
    csrfHeader: "x-app-csrf",
    csrfValue: "auth-operation",
  });
  const lifetime = yield* AuthAtom.makeLifetime(client);
  const runtime = Atom.context()(Layer.succeed(AuthAtom.AuthAtomLifetime, lifetime));

  const session = AuthAtom.query(
    transport.routes.session,
    {},
    {
      runtime,
      reactivityKeys: ["session"],
    },
  );
  const signOut = AuthAtom.mutation(transport.routes.signOut, {
    runtime,
    reactivityKeys: ["session"],
    subject: { fromSuccess: () => null },
  });

  return { lifetime, runtime, session, signOut };
});
```

Keep this Effect's Scope open for the application. The sign-out mutation invalidates
the session query through its reactivity key and disposes the previous subject state.
Your React handler only dispatches the mutation.

## Compose a passkey workflow

```ts [passkey-workflow.ts]
import { Effect, Redacted } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import { makeSimpleWebAuthnPasskeyBrowser } from "effect-auth/PasskeyBrowser";

import { makeAuthClient } from "./auth-client";
import { transport } from "./auth-transport";

export const makePasskeyClient = Effect.gen(function* () {
  const client = yield* makeAuthClient;
  const browser = yield* makeSimpleWebAuthnPasskeyBrowser();

  const signIn = AuthAtom.workflow<{ flowId: string; commandId: string }>()(
    client.runtime,
    (input) =>
      Effect.gen(function* () {
        const workflow = yield* AuthAtom.AuthAtomWorkflow;
        const started = yield* workflow.call(transport.routes.signIn, {
          ...input,
          profileId: "default",
        });
        const response = yield* browser.authenticate({ started, mediation: "required" });

        yield* workflow.current;
        return yield* workflow.completeAuthentication(
          transport.routes.completeSignIn,
          { flowId: input.flowId, response: Redacted.value(response.response) },
          (result) => (result._tag === "Authenticated" ? result.session.subjectId : undefined),
        );
      }),
    { reactivityKeys: ["session"] },
  );

  return { ...client, signIn };
});
```

The atom owns the whole flow and cross-query invalidation. Keep it out of component
`.then` chains. An interrupted ceremony cancels; an admitted credential response
settles before a subject change is published. HTTP mutations make one attempt—an
unknown write outcome requires authoritative lookup or a fresh flow.
