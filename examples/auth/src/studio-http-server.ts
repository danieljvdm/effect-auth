import { type AnyRelations, eq } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import * as Http from "effect-auth/OperationHttp";
import * as HttpServer from "effect-auth/OperationHttpServer";
import { guest, requireAuthenticated } from "effect-auth/Operations";

import { sessions } from "./studio-auth";
import { subject } from "./studio-passkey-schema";
import { MemberProfile, transport } from "./studio-transport";

export const memberLayer = (db: EffectPgDatabase<AnyRelations>) =>
  MemberProfile.handlerLayer(
    Effect.fn(function* (_input, invocation) {
      const caller = yield* requireAuthenticated(invocation);

      const [member] = yield* db
        .select()
        .from(subject)
        .where(eq(subject.id, caller.subjectId))
        .pipe(Effect.orDie);

      if (member === undefined) return yield* Effect.die(new Error("Missing current member"));

      return { memberId: caller.subjectId, organization: member.organization, name: member.name };
    }),
  );

export const invocation = HttpServer.invocationLayer(
  Effect.fn(function* (_request, credentials) {
    if (credentials.session === undefined) return guest;

    const session = yield* (yield* sessions.SessionStrategy).verify(credentials.session).pipe(
      Effect.catchTag("SessionInvalid", () => Effect.succeed(undefined)),
      Effect.mapError(() => Http.OperationHttpError.make({ reason: "credentials" })),
    );

    return session === undefined
      ? guest
      : {
          _tag: "Authenticated" as const,
          subjectId: session.subjectId,
          sessionId: session.sessionId,
          assurance: session.assurance,
        };
  }),
);

/** Exact origin and cookie policy are explicit; localhost is the example's
 * development RP. Production supplies HTTPS origins and secure cookie names. */
export const serverConfiguration = HttpServer.configurationLayer({
  cookies: HttpServer.cookieConfiguration({ prefix: "studio-", secure: false }),
  publicOrigin: "http://localhost:4179",
  trustedOrigins: ["http://localhost:4179"],
  csrfHeader: "x-studio-csrf",
  csrfValue: "operation",
  maximumBodyBytes: 300000,
  maximumUrlBytes: 8192,
});

export const makeStudioHttp = (db: EffectPgDatabase<AnyRelations>) =>
  HttpServer.make(transport).pipe(
    Effect.provide(Layer.mergeAll(serverConfiguration, invocation, memberLayer(db))),
  );
