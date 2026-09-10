import { Effect, Layer, Schema } from "effect";
import * as AuthAtom from "effect-auth/Atom";
import * as OperationHttp from "effect-auth/OperationHttp";
import * as OperationHttpClient from "effect-auth/OperationHttpClient";
import * as OperationHttpServer from "effect-auth/OperationHttpServer";
import { guest, makeOperation, requireAuthenticated } from "effect-auth/Operations";
import { SubjectId } from "effect-auth/Schema";
import { Atom } from "effect/unstable/reactivity";

import { staffSessions } from "./session-consumer";

/** An application plugin uses the same operation boundary as built-in methods. */
export const CurrentSubject = makeOperation("example/current-subject", {
  payload: Schema.Void,
  success: Schema.Struct({ subjectId: SubjectId, method: Schema.NonEmptyString }),
  error: Schema.Never,
  access: "authenticated",
  exposure: "public",
  replay: "read-only",
});

export const currentSubjectLayer = CurrentSubject.handlerLayer(
  Effect.fn("Example.CurrentSubject")(function* (_input, invocation) {
    const caller = yield* requireAuthenticated(invocation);

    return { subjectId: caller.subjectId, method: caller.assurance.method };
  }),
);

export const transport = OperationHttp.make({
  currentSubject: OperationHttp.route(CurrentSubject, { path: "/auth/current-subject" }),
  capabilities: OperationHttp.route(staffSessions.operations.Capabilities, {
    path: "/auth/capabilities",
  }),
  verify: OperationHttp.route(staffSessions.operations.Verify, {
    path: "/auth/verify",
    allowInternal: true,
    credentials: { credential: "session" },
  }),
  renew: OperationHttp.route(staffSessions.operations.Renew, {
    path: "/auth/renew",
    allowInternal: true,
    credentials: { credential: "session" },
  }),
  signOut: OperationHttp.route(staffSessions.operations.SignOut, {
    path: "/auth/sign-out",
    allowInternal: true,
    credentials: { credential: "session" },
  }),
});

/** Install the same session handlers with either stateful or stateless strategy.
 * Cookie names, public origins, and caller resolution belong to the consumer. */
export const transportConfiguration = OperationHttpServer.configurationLayer({
  cookies: OperationHttpServer.cookieConfiguration({ prefix: "__Host-example-", secure: true }),
  publicOrigin: "https://account.example",
  trustedOrigins: ["https://account.example"],
  csrfHeader: "x-example-csrf",
  csrfValue: "auth-operation",
  maximumBodyBytes: 65536,
  maximumUrlBytes: 8192,
});

export const transportInvocation = OperationHttpServer.invocationLayer(
  Effect.fn("Example.HttpInvocation")(function* (_request, credentials) {
    if (credentials.session === undefined) return guest;

    const session = yield* (yield* staffSessions.SessionStrategy)
      .verify(credentials.session)
      .pipe(
        Effect.mapError(() => OperationHttp.OperationHttpError.make({ reason: "credentials" })),
      );

    return {
      _tag: "Authenticated" as const,
      subjectId: session.subjectId,
      sessionId: session.sessionId,
      assurance: session.assurance,
    };
  }),
);

export const server = OperationHttpServer.make(transport).pipe(
  Effect.provide(Layer.mergeAll(transportConfiguration, transportInvocation, currentSubjectLayer)),
);

/** The Fetch client works without React; expose its effects through any host runtime. */
export const fetchClient = OperationHttpClient.make({
  baseUrl: "https://account.example",
  csrfHeader: "x-example-csrf",
  csrfValue: "auth-operation",
});

/** Mount current in controlRegistry. Render account atoms in current.registry.
 * UI event handlers only dispatch these atoms, including promise-mode dispatch. */
export const atomClient = Effect.fn("Example.AtomClient")(function* () {
  const client = yield* fetchClient;
  const lifetime = yield* AuthAtom.makeLifetime(client);
  const runtime = Atom.context()(Layer.succeed(AuthAtom.AuthAtomLifetime, lifetime));

  const currentSubject = AuthAtom.query(transport.routes.currentSubject, undefined, {
    runtime,
    reactivityKeys: ["example/current-subject"],
  });

  const signOut = AuthAtom.mutation(transport.routes.signOut, {
    runtime,
    reactivityKeys: ["example/current-subject"],
    subject: { fromSuccess: () => null },
  });

  return { lifetime, currentSubject, signOut };
});
