/* oxlint-disable no-explicit-any -- private bridge; concrete public makers preserve table, ID and environment types. */
import { Effect, Schema } from "effect";
import type { Statement } from "effect/unstable/sql/Statement";

import type { PreparedCommit } from "../hooks/commit";
import { LifecycleHooks } from "../hooks/LifecycleHooks";
import { PasskeyConfigurationError, type PasskeyUnavailable } from "../passkey/errors";
import {
  PasskeyAccess,
  PasskeyAssertionVerified,
  PasskeyCeremony,
  PasskeyClaim,
  PasskeyClaimDecision,
  PasskeyCleanupResult,
  PasskeyCredential,
  PasskeyEnrollmentSnapshot,
  PasskeyEvidence,
  PasskeyInstant,
  PasskeyIssueDecision,
  PasskeyModuleId,
  PasskeyProfile,
  PasskeyProtocolCredentialId,
  PasskeySettlement,
} from "../passkey/models";
import type { PasskeyCredentials } from "../passkey/PasskeyCredentials";
import type { PasskeyEnrollmentContext } from "../passkey/PasskeyEnrollmentContext";
import type { PasskeyPersistence, PreparePasskeyCommit } from "../passkey/PasskeyPersistence";
import { PasskeyMethodPolicy } from "../passkey/policy";
import { snapshotPasskeySync } from "../passkey/snapshot";
import { SubjectId } from "../Schema";
import type { DrizzleMappingError } from "./model";
import { captureEnrollmentContext, lookupCredential } from "./passkey-credentials";
import {
  assertionPurposes,
  claimAssertion,
  cleanupCeremonies,
  contextAssertion,
  issueAssertion,
  settleAssertion,
} from "./passkey-flow";
import type {
  PasskeyCredentialServices,
  PasskeyEnrollmentContextServices,
  PasskeyMappingSource,
  PasskeyPersistenceServices,
} from "./passkey-model";
import {
  claimRegistration,
  contextRegistration,
  settleRegistration,
} from "./passkey-registration-ceremony";
import type { PasskeyRegistrationCeremonyServices } from "./passkey-registration-ceremony-model";
import {
  captureMapping,
  invariant,
  nonce,
  unavailable,
  validateMapping,
  CurrentPasskeyTransaction,
} from "./passkey-state";
import {
  coordinateTransactionOwner,
  makeTransactionExecution,
  sqlClientTransactionStandaloneGuard,
  type TransactionCoordinatorError,
  type TransactionExecution,
  type TransactionTargetConfiguration,
} from "./transaction-execution";

export type PasskeyTargetConfiguration = TransactionTargetConfiguration<PasskeyUnavailable>;

export type PasskeyCoordinatorError<E> =
  | TransactionCoordinatorError<E, PasskeyUnavailable>
  | PasskeyConfigurationError
  | DrizzleMappingError;

export const sqlClientPasskeyStandaloneGuard = (
  database: Parameters<typeof sqlClientTransactionStandaloneGuard>[1],
) => sqlClientTransactionStandaloneGuard(unavailable, database);

const emptyHooks: LifecycleHooks["Service"] = {
  before: () => Effect.void,
  after: () => Effect.succeed([]),
};

export type PasskeyExecution = TransactionExecution<
  PasskeyUnavailable,
  CurrentPasskeyTransaction,
  never
>;

export const makePasskeyExecution = (
  database: Parameters<typeof makeTransactionExecution>[1],
  hooks: LifecycleHooks["Service"],
  configuration: PasskeyTargetConfiguration,
): PasskeyExecution => {
  const execution = makeTransactionExecution(
    CurrentPasskeyTransaction,
    database,
    configuration,
    unavailable,
    nonce,
  );

  return {
    ...execution,
    run: (operation, mutation) =>
      execution.run(operation, mutation).pipe(Effect.provideService(LifecycleHooks, hooks)),
  };
};

const issueInput = Schema.Struct({ ceremony: PasskeyCeremony, policy: PasskeyMethodPolicy });

const claimInput = Schema.Struct({
  access: PasskeyAccess,
  policy: PasskeyMethodPolicy,
  ceremony: PasskeyCeremony,
  claimId: PasskeyClaim.fields.claimId,
  credential: Schema.optionalKey(PasskeyCredential),
});

const settleInput = Schema.Struct({
  claim: PasskeyClaim,
  nowMillis: PasskeyInstant,
  outcome: Schema.Union([
    Schema.TaggedStruct("Rejected", {}),
    Schema.TaggedStruct("Ambiguous", {}),
    Schema.TaggedStruct("Assertion", {
      credential: PasskeyCredential,
      assertion: PasskeyAssertionVerified,
      evidence: PasskeyEvidence,
    }),
  ]),
});

const cleanupInput = Schema.Struct({
  moduleId: PasskeyModuleId,
  nowMillis: PasskeyInstant,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
});

const lookupInput = Schema.Struct({
  rpId: PasskeyProfile.fields.rpId,
  protocolCredentialId: PasskeyProtocolCredentialId,
});

const contextInput = Schema.Struct({
  moduleId: PasskeyModuleId,
  rpId: PasskeyProfile.fields.rpId,
  subjectId: SubjectId,
});

const inputs = {
  issue: issueInput,
  context: PasskeyAccess,
  claim: claimInput,
  settle: settleInput,
  cleanup: cleanupInput,
};

export const capturedService = <S>(
  service: S,
  schemas: Record<string, Schema.Codec<any, any, never, never>>,
  execute: PasskeyExecution,
): S =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(
        service as Record<string, (...args: any[]) => Effect.Effect<any, PasskeyUnavailable>>,
      ).map(([name, method]) => [
        name,
        (original: any, prepare?: any) =>
          Effect.suspend(() => {
            invariant(execute.active());
            const input = snapshotPasskeySync(schemas[name]!, original);

            return method(input, prepare);
          }).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (exit._tag === "Failure") execute.poison();
              }),
            ),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          ),
      ]),
    ),
  ) as S;

export const prepareValue = <Value, A>(
  value: Value,
  prepare: PreparePasskeyCommit<Value, A>,
): Effect.Effect<PreparedCommit<A>, never, CurrentPasskeyTransaction> =>
  Effect.flatMap(CurrentPasskeyTransaction, (owner) =>
    Effect.sync(() => {
      owner.guards.push(owner.journal.prepare(undefined));
      const receipt = prepare(value, owner.journal);

      invariant(
        receipt !== null &&
          typeof receipt === "object" &&
          receipt._tag === "PreparedCommit" &&
          typeof receipt.read === "object" &&
          Effect.isEffect(receipt.read),
      );
      owner.guards.push(receipt);

      return receipt;
    }),
  );

const requirePurpose = (purpose: string, registration: boolean, enrollment = false) =>
  invariant(
    enrollment
      ? purpose === "enrollment"
      : registration
        ? purpose === "registration"
        : assertionPurposes.some((supported) => supported === purpose),
  );

/** Context is advisory. Retain observations and final predicates without taking
 * later-ranked locks before a subsequent mutation acquires its full lock set. */
export const observationalContext = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
  Effect.flatMap(CurrentPasskeyTransaction, (owner) =>
    operation.pipe(
      Effect.provideService(CurrentPasskeyTransaction, {
        ...owner,
        read: (table, where, options) => owner.read(table, where, { ...options, lock: false }),
      }),
    ),
  );

export const makePasskeyPersistence = (
  mapping: any,
  execute: PasskeyExecution,
  configuration: PasskeyTargetConfiguration,
  registration = false,
  enrollment = false,
): PasskeyPersistence["Service"] =>
  capturedService<PasskeyPersistence["Service"]>(
    {
      issue: (input, prepare) =>
        Effect.suspend(() => {
          invariant(!registration && !enrollment);
          requirePurpose(input.ceremony.purpose, false);

          return execute.run(
            Effect.gen(function* () {
              const value = yield* issueAssertion(mapping, input.ceremony, input.policy);

              return yield* prepareValue(snapshotPasskeySync(PasskeyIssueDecision, value), prepare);
            }),
          );
        }),
      context: (access) =>
        Effect.suspend(() => {
          requirePurpose(access.purpose, registration, enrollment);

          return execute.run(
            observationalContext(
              registration
                ? contextRegistration(mapping, access)
                : contextAssertion(mapping, access),
            ),
            false,
          );
        }),
      claim: (input, prepare) =>
        Effect.suspend(() => {
          requirePurpose(input.access.purpose, registration, enrollment);
          requirePurpose(input.ceremony.purpose, registration, enrollment);
          invariant((!registration && !enrollment) || input.credential === undefined);

          return execute.run(
            Effect.gen(function* () {
              const value = yield* registration
                ? claimRegistration(mapping, input)
                : claimAssertion(mapping, input);

              return yield* prepareValue(snapshotPasskeySync(PasskeyClaimDecision, value), prepare);
            }),
          );
        }),
      settle: (input, prepare) =>
        Effect.suspend(() => {
          requirePurpose(input.claim.ceremony.purpose, registration, enrollment);
          invariant((!registration && !enrollment) || input.outcome._tag !== "Assertion");

          return execute.run(
            Effect.gen(function* () {
              const value = yield* registration
                ? settleRegistration(
                    mapping,
                    input.claim,
                    input.outcome._tag as "Rejected" | "Ambiguous",
                  )
                : settleAssertion(mapping, input.claim, input.outcome, configuration.dialect);

              return yield* prepareValue(snapshotPasskeySync(PasskeySettlement, value), prepare);
            }),
          );
        }),
      cleanup: (input, prepare) =>
        execute.run(
          Effect.gen(function* () {
            const value = yield* cleanupCeremonies(
              mapping,
              input,
              registration ? ["registration"] : enrollment ? ["enrollment"] : assertionPurposes,
            );

            return yield* prepareValue(snapshotPasskeySync(PasskeyCleanupResult, value), prepare);
          }),
        ),
    },
    inputs,
    execute,
  );

const credentialService = (
  mapping: any,
  execute: PasskeyExecution,
): PasskeyCredentials["Service"] =>
  capturedService<PasskeyCredentials["Service"]>(
    {
      lookup: (input) =>
        execute.run(lookupCredential(mapping, input.rpId, input.protocolCredentialId), false),
    },
    { lookup: lookupInput },
    execute,
  );

const enrollmentService = (
  mapping: any,
  execute: PasskeyExecution,
): PasskeyEnrollmentContext["Service"] =>
  capturedService<PasskeyEnrollmentContext["Service"]>(
    {
      capture: (input) =>
        execute.run(
          Effect.map(captureEnrollmentContext(mapping, input), (value) =>
            value === undefined ? undefined : snapshotPasskeySync(PasskeyEnrollmentSnapshot, value),
          ),
          false,
        ),
    },
    { capture: contextInput },
    execute,
  );

const registrationServices = (
  mapping: any,
  execute: PasskeyExecution,
  configuration: PasskeyTargetConfiguration,
): PasskeyRegistrationCeremonyServices => ({
  capabilities: Object.freeze({
    purposes: Object.freeze(["registration"] as const),
    issue: "registration-authority",
    assertionSettlement: false,
  }),
  passkeyPersistence: makePasskeyPersistence(mapping, execute, configuration, true),
});

export const capturedMapping = <M, RSetup>(
  source: PasskeyMappingSource<M, RSetup>,
  kind: "read" | "context" | "assertion" | "registration",
  configuration: PasskeyTargetConfiguration,
): Effect.Effect<M, PasskeyConfigurationError | DrizzleMappingError, RSetup> =>
  Effect.flatMap(Effect.isEffect(source) ? source : Effect.succeed(source), (mapping) =>
    Effect.try({
      try: () => {
        const captured = captureMapping(mapping);

        validateMapping(captured, kind);
        if (configuration.mode === "batch") invariant((captured as any).d1?.primary === true);

        return captured;
      },
      catch: () => PasskeyConfigurationError.make({}),
    }),
  );

export const makeTargetPasskeyCredentials = <M, RSetup>(
  database: any,
  source: PasskeyMappingSource<M, RSetup>,
  configuration: PasskeyTargetConfiguration,
): Effect.Effect<
  PasskeyCredentialServices,
  PasskeyConfigurationError | DrizzleMappingError,
  RSetup
> =>
  Effect.map(capturedMapping(source, "read", configuration), (mapping) => ({
    passkeyCredentials: credentialService(
      mapping,
      makePasskeyExecution(database, emptyHooks, configuration),
    ),
  }));

export const makeTargetPasskeyEnrollmentContext = <M, RSetup>(
  database: any,
  source: PasskeyMappingSource<M, RSetup>,
  configuration: PasskeyTargetConfiguration,
): Effect.Effect<
  PasskeyEnrollmentContextServices,
  PasskeyConfigurationError | DrizzleMappingError,
  RSetup
> =>
  Effect.map(capturedMapping(source, "context", configuration), (mapping) => ({
    passkeyEnrollmentContext: enrollmentService(
      mapping,
      makePasskeyExecution(database, emptyHooks, configuration),
    ),
  }));

export const makeTargetPasskeyPersistence = <M, RSetup>(
  database: any,
  source: PasskeyMappingSource<M, RSetup>,
  configuration: PasskeyTargetConfiguration,
): Effect.Effect<
  PasskeyPersistenceServices,
  PasskeyConfigurationError | DrizzleMappingError,
  RSetup | LifecycleHooks
> =>
  Effect.gen(function* () {
    const mapping = yield* capturedMapping(source, "assertion", configuration);
    const hooks = yield* LifecycleHooks;

    return {
      passkeyPersistence: makePasskeyPersistence(
        mapping,
        makePasskeyExecution(database, hooks, configuration),
        configuration,
      ),
    };
  });

export const makeTargetPasskeyRegistration = <M, RSetup>(
  database: any,
  source: PasskeyMappingSource<M, RSetup>,
  configuration: PasskeyTargetConfiguration,
): Effect.Effect<
  PasskeyRegistrationCeremonyServices,
  PasskeyConfigurationError | DrizzleMappingError,
  RSetup | LifecycleHooks
> =>
  Effect.gen(function* () {
    const mapping = yield* capturedMapping(source, "registration", configuration);
    const hooks = yield* LifecycleHooks;

    return registrationServices(
      mapping,
      makePasskeyExecution(database, hooks, configuration),
      configuration,
    );
  });

export const coordinateTargetPasskey = <M, RSetup, Transaction, A, E, R>(
  database: any,
  source: PasskeyMappingSource<M, RSetup>,
  configuration: PasskeyTargetConfiguration,
  owner: (
    transaction: Transaction,
    services: PasskeyPersistenceServices,
    append: (statement: Statement<unknown>) => void,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, PasskeyCoordinatorError<E>, R | RSetup | LifecycleHooks> =>
  Effect.flatMap(capturedMapping(source, "assertion", configuration), (mapping) =>
    Effect.flatMap(LifecycleHooks, (hooks) =>
      coordinateTransactionOwner(
        database,
        CurrentPasskeyTransaction,
        configuration,
        Effect.void,
        unavailable,
        nonce,
        (execution) => ({
          passkeyPersistence: makePasskeyPersistence(
            mapping,
            {
              ...execution,
              run: (operation, mutation) =>
                execution
                  .run(operation, mutation)
                  .pipe(Effect.provideService(LifecycleHooks, hooks)),
            },
            configuration,
          ),
        }),
        owner,
      ).pipe(Effect.provideService(LifecycleHooks, hooks)),
    ),
  );

export const coordinateTargetPasskeyRegistration = <M, RSetup, Transaction, A, E, R>(
  database: any,
  source: PasskeyMappingSource<M, RSetup>,
  configuration: PasskeyTargetConfiguration,
  owner: (
    transaction: Transaction,
    services: PasskeyRegistrationCeremonyServices,
    append: (statement: Statement<unknown>) => void,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<A, PasskeyCoordinatorError<E>, R | RSetup | LifecycleHooks> =>
  Effect.flatMap(capturedMapping(source, "registration", configuration), (mapping) =>
    Effect.flatMap(LifecycleHooks, (hooks) =>
      coordinateTransactionOwner(
        database,
        CurrentPasskeyTransaction,
        configuration,
        Effect.void,
        unavailable,
        nonce,
        (execution) =>
          registrationServices(
            mapping,
            {
              ...execution,
              run: (operation, mutation) =>
                execution
                  .run(operation, mutation)
                  .pipe(Effect.provideService(LifecycleHooks, hooks)),
            },
            configuration,
          ),
        owner,
      ).pipe(Effect.provideService(LifecycleHooks, hooks)),
    ),
  );
