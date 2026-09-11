import * as AuthAtom from "@yielded/auth/Atom";
import * as Client from "@yielded/auth/Client";
import type { ProofReference } from "@yielded/auth/Proofs";
import { Effect, Redacted, Schema } from "effect";

import { LoginApi } from "./login-contract";

export const AppClient = Client.make(LoginApi, { baseUrl: "https://app.example.com" });
export const auth = AuthAtom.make(AppClient);
const Provider = Schema.Literals(["github", "google"]);
const Pending = Schema.Struct({ provider: Provider, flowId: Schema.NonEmptyString });
const pendingJson = Schema.fromJsonString(Pending);

export class BrowserFlowUnavailable extends Schema.TaggedError<BrowserFlowUnavailable>()(
  "BrowserFlowUnavailable",
  {},
) {}

// The generated authorization URL has already crossed the HTTP schema boundary.
// Only public correlation data survives navigation. The binder stays HttpOnly.
export const login = auth.runtime.fn<typeof Provider.Type>()(
  Effect.fn("example.oauthLogin")(function* (provider) {
    const client = yield* AppClient;

    const ids = yield* Effect.try({
      try: () => ({ flowId: crypto.randomUUID(), commandId: crypto.randomUUID() }),
      catch: () => BrowserFlowUnavailable.make({}),
    });

    const pending = yield* Schema.encodeEffect(pendingJson)({ provider, flowId: ids.flowId });

    yield* Effect.try({
      try: () => sessionStorage.setItem("oauth-flow", pending),
      catch: () => BrowserFlowUnavailable.make({}),
    });

    const started = yield* client.auth.signIn({
      ...ids,
      provider,
      callbackId: provider,
      returnTarget: "/account",
    });

    yield* Effect.try({
      try: () => location.assign(Redacted.value(started.authorizationUrl)),
      catch: () => BrowserFlowUnavailable.make({}),
    });
  }),
);

// The public callback page captures and clears the query, then dispatches
// auth.completeSignIn with this input. Client supplies the same-origin POST/CSRF;
// the server injects the private request binder from its HttpOnly cookie. Render its result:
// RegistrationRequired -> terms form/auth.register; completion -> session atom.
// Callback GET itself must never exchange a code or mutate auth state.
export const callbackInput = Effect.fn("example.oauthCallbackInput")(function* (
  provider: typeof Provider.Type,
) {
  const saved = yield* Effect.try({
    try: () => {
      const query = new URL(location.href).searchParams;
      const pending = sessionStorage.getItem("oauth-flow");

      history.replaceState(null, "", location.pathname);

      return { query, pending };
    },
    catch: () => BrowserFlowUnavailable.make({}),
  });

  if (saved.pending === null) return yield* BrowserFlowUnavailable.make({});
  const pending = yield* Schema.decodeEffect(pendingJson)(saved.pending);

  if (pending.provider !== provider) return yield* BrowserFlowUnavailable.make({});
  for (const key of ["state", "code", "error", "iss"]) {
    if (saved.query.getAll(key).length > 1) return yield* BrowserFlowUnavailable.make({});
  }
  const state = saved.query.get("state");
  const code = saved.query.get("code");
  const error = saved.query.get("error");
  const issuer = saved.query.get("iss");

  if (state === null || (code === null) === (error === null))
    return yield* BrowserFlowUnavailable.make({});

  return {
    ...pending,
    callbackId: provider,
    response:
      code === null
        ? {
            _tag: "Error" as const,
            state,
            error: error === "access_denied" ? ("access-denied" as const) : ("rejected" as const),
            ...(issuer === null ? {} : { issuer }),
          }
        : { _tag: "Code" as const, state, code, ...(issuer === null ? {} : { issuer }) },
  };
});

// Direct Effect-first calls are also available. auth.session and auth.signOut
// expose the same methods through the application's ordinary Atom registry.
export const currentSession = Effect.gen(function* () {
  const client = yield* AppClient;

  return yield* client.auth.getSession();
});

export const logout = Effect.gen(function* () {
  const client = yield* AppClient;

  yield* client.auth.signOut();
});

// Workflow atoms own sequencing; components only dispatch and render results.
export const completeLogin = auth.runtime.fn<typeof Provider.Type>()(
  Effect.fn("example.completeOAuthLogin")(function* (provider) {
    const client = yield* AppClient;

    return yield* client.auth.completeSignIn(yield* callbackInput(provider));
  }),
);

export const sendEmailCode = auth.runtime.fn<string>()(
  Effect.fn("example.sendEmailCode")(function* (email) {
    const client = yield* AppClient;

    const ids = yield* Effect.try({
      try: () => ({ flowId: crypto.randomUUID(), requestId: crypto.randomUUID() }),
      catch: () => BrowserFlowUnavailable.make({}),
    });

    yield* client.auth.beginEmailSignIn({ flowId: ids.flowId });

    const result = yield* client.auth.requestEmailCode({
      ...ids,
      email,
      returnTarget: "/account",
      locale: "en",
    });

    return { flowId: ids.flowId, email, reference: result.reference };
  }),
);

export const confirmEmailCode = auth.runtime.fn<{
  readonly flowId: string;
  readonly email: string;
  readonly reference: typeof ProofReference.Encoded;
  readonly code: string;
}>()(
  Effect.fn("example.confirmEmailCode")(function* (input) {
    const client = yield* AppClient;
    const base = { flowId: input.flowId, email: input.email, returnTarget: "/account" };

    const verified = yield* client.auth.verifyEmailCode({
      ...base,
      reference: input.reference,
      secret: input.code,
    });

    return yield* client.auth.completeEmailSignIn({
      ...base,
      continuationId: verified.continuation.continuationId,
    });
  }),
);
