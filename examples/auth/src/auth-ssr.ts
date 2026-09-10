import { Effect, Layer, Schema } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import * as Client from "effect-auth/Client";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { AuthApi } from "./auth-contract";
import { BrowserAuth, MemberPanel } from "./auth-react";

const Session = AuthApi.actions.getSession.route.operation.rpc.successSchema;

// Call once inside the request Scope or browser application Scope. A host Atom
// runtime can use Atom.context({ memoMap }) to share this memo map as well.
const acquireAuth = Effect.fn("example.acquireAuth")(function* (initialSession: unknown) {
  const memoMap = yield* Layer.makeMemoMap;
  const client = yield* Client.make(AuthApi, { baseUrl: "https://app.example.com" });

  return yield* AuthAtom.make(client.auth, { memoMap, initialSession });
});

const page = (auth: ReturnType<typeof BrowserAuth.useAuth>) =>
  createElement(BrowserAuth.Provider, { value: auth }, createElement(MemberPanel));

// The request handler passes the result of its local `yield* auth.getSession()`.
// Close that request's Scope after rendering. Only the encoded public session
// travels through the framework's data serializer; no client or registry does.
export const renderAuthPage = Effect.fn("example.renderAuthPage")(function* (
  session: typeof Session.Type,
) {
  const initialSession = yield* Schema.encodeEffect(Session)(session);
  const auth = yield* acquireAuth(initialSession);
  const html = yield* Effect.sync(() => renderToString(page(auth)));

  return { html, initialSession };
});

// Keep the caller's Scope open until the browser application unmounts. The
// finalizer unmounts React before closing auth resources. Do not return these
// live bindings from Effect.scoped: that would close them before React uses them.
export const hydrateAuthPage = Effect.fn("example.hydrateAuthPage")(function* (
  container: Element,
  initialSession: unknown,
) {
  const auth = yield* acquireAuth(initialSession);

  yield* Effect.acquireRelease(
    Effect.sync(() => hydrateRoot(container, page(auth))),
    (root) => Effect.sync(() => root.unmount()),
  );

  // The seed matches the server's first render; the live session query verifies
  // browser credentials. A sign-out or account change permanently drops the seed.
  return auth;
});
