import { DateTime, Effect, Layer, Schema } from "effect";
import { coordinateCommit, type CommitJournal, LifecycleHooks } from "effect-auth/Hooks";
import { SubjectId } from "effect-auth/Schema";
import {
  AuthenticationAuthority,
  type AuthenticationEvidence,
  type AuthenticationRequirement,
  make as makeSessionModule,
  SecurityRevision,
  SessionConflict,
  type SessionError,
  SessionId,
  SessionInvalid,
  type SessionPolicy,
  SessionUnavailable,
  StaleAuthentication,
  type StatefulSessionRecord,
} from "effect-auth/Sessions";

export const StaffClaims = Schema.Struct({
  tenant: Schema.NonEmptyString,
  staffNumber: Schema.FiniteFromString,
});

export const staffSessions = makeSessionModule(StaffClaims, { namespace: "example/staff" });

export const policy: SessionPolicy = {
  issuer: "example-auth",
  audience: "example-staff",
  generation: 1,
  idleLifetimeMillis: 60_000,
  absoluteLifetimeMillis: 300_000,
  renewalIntervalMillis: 1_000,
  maximumIssuedAbsoluteLifetimeMillis: 300_000,
  maximumTokenBytes: 4096,
  requireImmediateInvalidation: false,
};

export const subjectId = SubjectId.make("staff:42");
export const initialRevision = SecurityRevision.make("1");

const requirement: AuthenticationRequirement = {
  alternatives: [
    {
      factors: ["possession"],
      userVerified: false,
      phishingResistant: false,
      minimumCredentials: 1,
    },
  ],
  maximumAgeMillis: 60_000,
};

/** A disposable consumer authority for this runnable example; real adapters own durable transactions. */
export const exampleAuthority = Effect.gen(function* () {
  const hooks = yield* LifecycleHooks;
  let revision = initialRevision;
  let sequence = 0;
  const rows = new Map<SessionId, StatefulSessionRecord<typeof StaffClaims.Type>>();
  const flows = new Map<string, number>();

  const current = (evidence: AuthenticationEvidence) =>
    evidence.revision.subjectId === subjectId &&
    evidence.revision.securityRevision === revision &&
    evidence.revision.credentials.every((credential) => credential.revision === revision);

  const checkEvidence = Effect.fn("Example.checkEvidence")(function* (
    evidence: AuthenticationEvidence,
  ) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);

    if (
      !current(evidence) ||
      evidence.proofs.some(
        (proof) => now - DateTime.toEpochMillis(proof.verifiedAt) >= requirement.maximumAgeMillis,
      )
    )
      return yield* StaleAuthentication.make({});
  });

  const atomic = <A, E extends SessionError>(
    body: (journal: CommitJournal) => Effect.Effect<A, E>,
  ) =>
    coordinateCommit(body, { mode: "interactive" }).pipe(
      Effect.map((result) => result.value),
      Effect.mapError((error) =>
        error._tag === "HookConfigurationError" ? SessionUnavailable.make({}) : error,
      ),
      Effect.provideService(LifecycleHooks, hooks),
    );

  const authority = Layer.succeed(AuthenticationAuthority, {
    capture: (id, credentialIds) =>
      id !== subjectId || credentialIds.some((id) => id !== "device-1")
        ? Effect.fail(StaleAuthentication.make({}))
        : Effect.succeed({
            subjectId,
            securityRevision: revision,
            credentials: credentialIds.map((credentialId) => ({ credentialId, revision })),
          }),
    requirements: (evidence) => checkEvidence(evidence).pipe(Effect.as(requirement)),
    approve: (input, prepare) =>
      atomic((journal) =>
        Effect.gen(function* () {
          yield* checkEvidence(input.evidence);
          if (input.pending !== undefined) return yield* StaleAuthentication.make({});
          if (
            DateTime.toEpochMillis(yield* DateTime.now) >= DateTime.toEpochMillis(input.expiresAt)
          )
            return yield* StaleAuthentication.make({});

          return prepare(undefined, journal);
        }),
      ),
  });

  const store = Layer.succeed(staffSessions.StatefulSessionPersistence, {
    establish: (input, prepare) =>
      atomic((journal) =>
        Effect.gen(function* () {
          yield* checkEvidence(input.evidence);
          const now = DateTime.toEpochMillis(yield* DateTime.now);

          if ((flows.get(input.evidence.flowId) ?? 0) > now) return yield* SessionConflict.make({});
          if (input.pending !== undefined || now >= DateTime.toEpochMillis(input.session.expiresAt))
            return yield* StaleAuthentication.make({});

          const row = {
            ...input.session,
            sessionId: SessionId.make(String(++sequence)),
            version: SecurityRevision.make(String(sequence)),
          };

          const receipt = prepare(row, journal);

          rows.set(row.sessionId, row);
          flows.set(input.evidence.flowId, DateTime.toEpochMillis(row.absoluteExpiresAt));

          return receipt;
        }),
      ),
    verify: (input) =>
      Effect.suspend(() => {
        const row = [...rows.values()].find((item) => item.digest === input.digest);

        return row !== undefined &&
          row.securityRevision === revision &&
          DateTime.toEpochMillis(input.now) <
            Math.min(
              DateTime.toEpochMillis(row.expiresAt),
              DateTime.toEpochMillis(row.absoluteExpiresAt),
            )
          ? Effect.succeed(row)
          : Effect.fail(SessionInvalid.make({}));
      }),
    rotate: (input, prepare) =>
      atomic((journal) =>
        Effect.suspend(() => {
          const row = rows.get(input.sessionId);

          if (
            row === undefined ||
            row.digest !== input.expectedDigest ||
            row.version !== input.expectedVersion ||
            row.securityRevision !== revision ||
            row.securityRevision !== input.expectedSecurityRevision ||
            DateTime.toEpochMillis(input.now) >= DateTime.toEpochMillis(row.expiresAt)
          )
            return Effect.fail(SessionConflict.make({}));

          const next = {
            ...row,
            digest: input.nextDigest,
            credentialVersion: input.nextCredentialVersion,
            version: SecurityRevision.make(String(++sequence)),
            issuedAt: input.now,
            expiresAt: input.nextExpiresAt,
          };

          const receipt = prepare(next, journal);

          rows.set(next.sessionId, next);

          return Effect.succeed(receipt);
        }),
      ),
    revokeDigest: (digest, prepare) =>
      atomic((journal) =>
        Effect.sync(() => {
          const row = [...rows.values()].find((item) => item.digest === digest);
          const receipt = prepare(row !== undefined, journal);

          if (row !== undefined) rows.delete(row.sessionId);

          return receipt;
        }),
      ),
    revoke: (input, prepare) =>
      atomic((journal) =>
        Effect.suspend(() => {
          if (input.subjectId !== subjectId || input.expectedSecurityRevision !== revision)
            return Effect.fail(StaleAuthentication.make({}));
          const receipt = prepare(undefined, journal);

          rows.delete(input.sessionId);

          return Effect.succeed(receipt);
        }),
      ),
    revokeAll: (input, prepare) =>
      atomic((journal) =>
        Effect.suspend(() => {
          if (input.subjectId !== subjectId || input.expectedSecurityRevision !== revision)
            return Effect.fail(StaleAuthentication.make({}));
          const receipt = prepare(undefined, journal);

          revision = SecurityRevision.make(String(Number(revision) + 1));
          rows.clear();

          return Effect.succeed(receipt);
        }),
      ),
  });

  const repository = Layer.succeed(staffSessions.SessionRepository, {
    list: (input) =>
      Effect.succeed({
        sessions: [...rows.values()]
          .filter((row) => row.subjectId === input.subjectId && row.securityRevision === revision)
          .slice(0, input.limit),
      }),
  });

  return Layer.mergeAll(authority, store, repository).pipe(Layer.provide(LifecycleHooks.empty));
});
