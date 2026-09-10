/* oxlint-disable no-explicit-any -- private row bridge; public mappings retain consumer payload, table, and ID types. */
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import {
  PasskeyLabel,
  PasskeyRevision,
  type PasskeyCeremony,
  type PasskeyClaim,
  type PasskeyRegistrationVerified,
} from "../passkey/models";
import type { PasskeyMethodPolicy } from "../passkey/policy";
import { SubjectId } from "../Schema";
import { lockAdmission, readCharges, guardChargeSet } from "./passkey-admission";
import { readModule, readPolicyGuards } from "./passkey-credentials";
import {
  compatiblePolicy,
  exactClaim,
  issueAssertion,
  liveCondition,
  readFlow,
  terminalFlow,
} from "./passkey-flow";
import { releaseRegistrationCustody } from "./passkey-registration-custody";
import {
  ceremonyStorage,
  credentialKey,
  equal,
  handleKey,
  invariant,
  CurrentPasskeyTransaction,
} from "./passkey-state";
import { digest, insertCredential, jsonStorage, validRegistration } from "./passkey-write-state";
import { both } from "./transaction-owner";

const registrationData = (mapping: any, registration: any) => {
  const codec = jsonStorage(mapping.registration.schema);
  const encoded = codec.encode(registration);

  invariant(new TextEncoder().encode(encoded).length <= 1048576);

  return {
    encoded,
    registration: codec.decode(encoded),
    fingerprint: digest(mapping.registration.schema, registration),
  };
};

const describe = (mapping: any, registration: any) => {
  const data = registrationData(mapping, registration);

  const labels = Schema.decodeSync(
    Schema.Struct({ name: PasskeyLabel, displayName: PasskeyLabel }),
  )(mapping.registration.describe(data.registration));

  return { ...data, ...labels };
};

export const inspectRegistration = Effect.fn("passkey.inspectRegistration")(function* (
  mapping: any,
  registration: any,
) {
  const owner = yield* CurrentPasskeyTransaction;
  const value = describe(mapping, registration);
  const current = yield* readModule(mapping);

  yield* readPolicyGuards(mapping);

  const eligible =
    current !== undefined &&
    (yield* owner.check(mapping.registration.eligible(value.registration)));

  return {
    fingerprint: value.fingerprint,
    name: value.name,
    displayName: value.displayName,
    eligible,
  };
});

export const issueRegistration = Effect.fn("passkey.issueRegistration")(function* (
  mapping: any,
  input: {
    readonly ceremony: PasskeyCeremony;
    readonly policy: PasskeyMethodPolicy;
    readonly registration: any;
  },
) {
  const owner = yield* CurrentPasskeyTransaction;
  const ceremony = input.ceremony;

  if (
    ceremony.moduleId !== mapping.moduleId ||
    ceremony.purpose !== "registration" ||
    ceremony.context._tag !== "Registration" ||
    !ceremony.profile.primarySignIn ||
    ceremony.profile.userVerification !== "required" ||
    ceremony.profile.residentKey !== "required" ||
    ceremony.allowedCredentials.length !== 0
  )
    return { _tag: "Rejected" } as const;
  const value = describe(mapping, input.registration);

  if (
    value.fingerprint !== ceremony.context.fingerprint ||
    value.name !== ceremony.context.name ||
    value.displayName !== ceremony.context.displayName
  )
    return { _tag: "Rejected" } as const;
  if ((yield* readModule(mapping)) === undefined) return { _tag: "Rejected" } as const;
  yield* lockAdmission(mapping);
  yield* readPolicyGuards(mapping);
  const eligible = mapping.registration.eligible(value.registration);

  if (!(yield* owner.check(eligible))) return { _tag: "Rejected" } as const;
  const handle = mapping.handle;
  const hashed = handleKey(ceremony.profile.rpId, ceremony.context.userHandle);

  const absentHandle = yield* owner.read(
    handle.table,
    equal(handle.table, { [handle.handleKey]: hashed }),
    { limit: 1 },
  );

  const intent = mapping.intent;

  const absentCommand = yield* owner.read(
    intent.table,
    equal(intent.table, {
      [intent.moduleId]: mapping.moduleId,
      [intent.commandId]: ceremony.commandId,
    }),
    { limit: 1 },
  );

  const absentFlow = yield* owner.read(
    intent.table,
    equal(intent.table, { [intent.moduleId]: mapping.moduleId, [intent.flowId]: ceremony.flowId }),
    { limit: 1 },
  );

  if (
    absentHandle.rows.length !== 0 ||
    absentCommand.rows.length !== 0 ||
    absentFlow.rows.length !== 0
  )
    return { _tag: "Rejected" } as const;
  const issued = yield* issueAssertion(mapping, ceremony, input.policy);

  if (issued._tag !== "Issued") return issued;

  const reserved = yield* owner.insert(
    handle.table,
    {
      ...handle.encodeInsert({ ceremony, reservationId: owner.marker }),
      [handle.handleKey]: hashed,
      [handle.rpId]: ceremony.profile.rpId,
      [handle.userHandle]: ceremony.context.userHandle,
      [handle.state]: handle.reservedState,
      [handle.version]: owner.marker,
      [handle.reservationId]: owner.marker,
      [mapping.read.handleOwnership.subjectId]: null,
    },
    { [handle.handleKey]: hashed },
  );

  absentHandle.rows = reserved.rows;

  const inserted = yield* owner.insert(
    intent.table,
    {
      ...intent.encodeInsert({
        ceremony,
        registration: value.registration,
        reservationId: owner.marker,
      }),
      [intent.moduleId]: mapping.moduleId,
      [intent.flowId]: ceremony.flowId,
      [intent.commandId]: ceremony.commandId,
      [intent.state]: intent.pendingState,
      [intent.version]: owner.marker,
      [intent.fingerprint]: value.fingerprint,
      [intent.handleKey]: hashed,
      [intent.reservationId]: owner.marker,
      [intent.ceremonySnapshot]: ceremonyStorage.encode(ceremony),
      [intent.applicationSnapshot]: value.encoded,
    },
    { [intent.moduleId]: mapping.moduleId, [intent.flowId]: ceremony.flowId },
  );

  absentCommand.rows = inserted.rows;
  absentFlow.rows = inserted.rows;
  owner.postconditions.push(eligible);

  return issued;
});

export const completeRegistration = Effect.fn("passkey.completeRegistration")(function* (
  mapping: any,
  input: {
    readonly claim: PasskeyClaim;
    readonly verified: PasskeyRegistrationVerified;
    readonly nowMillis: number;
  },
) {
  const owner = yield* CurrentPasskeyTransaction;
  const ceremony = input.claim.ceremony;

  if (
    ceremony.moduleId !== mapping.moduleId ||
    ceremony.purpose !== "registration" ||
    ceremony.context._tag !== "Registration"
  )
    return { _tag: "Rejected" } as const;
  const current = yield* readModule(mapping);

  if (current === undefined) return { _tag: "Rejected" } as const;
  yield* lockAdmission(mapping);
  yield* readPolicyGuards(mapping);
  const tuple = mapping.read.credentialOwnership;

  const absentCredential = yield* owner.read(
    tuple.table,
    equal(tuple.table, {
      [tuple.credentialKey]: credentialKey(
        ceremony.profile.rpId,
        input.verified.protocolCredentialId,
      ),
    }),
    { limit: 1, observe: false },
  );

  const handle = mapping.handle;
  const hashed = handleKey(ceremony.profile.rpId, ceremony.context.userHandle);

  const held = (yield* owner.read(
    handle.table,
    equal(handle.table, { [handle.handleKey]: hashed }),
    { limit: 1 },
  )).rows[0];

  const intent = mapping.intent;

  const row = (yield* owner.read(
    intent.table,
    equal(intent.table, { [intent.moduleId]: mapping.moduleId, [intent.flowId]: ceremony.flowId }),
    { limit: 1 },
  )).rows[0];

  const read = yield* readFlow(mapping, ceremony.flowId);

  if (read === undefined || !exactClaim(read, input.claim)) return { _tag: "Rejected" } as const;

  const reject = Effect.gen(function* () {
    yield* releaseRegistrationCustody(mapping, ceremony);
    yield* terminalFlow(mapping, read, "Rejected");

    return { _tag: "Rejected" } as const;
  });

  if (
    absentCredential.rows.length !== 0 ||
    held === undefined ||
    row === undefined ||
    !handle.isReservedState(held[handle.state]) ||
    !intent.isPendingState(row[intent.state]) ||
    row[intent.commandId] !== ceremony.commandId ||
    row[intent.ceremonySnapshot] !== ceremonyStorage.encode(ceremony) ||
    row[intent.fingerprint] !== ceremony.context.fingerprint ||
    row[intent.handleKey] !== hashed ||
    held[handle.reservationId] !== row[intent.reservationId] ||
    held[handle.rpId] !== ceremony.profile.rpId ||
    held[handle.userHandle] !== ceremony.context.userHandle ||
    !compatiblePolicy(ceremony, read.policy, current) ||
    !validRegistration(ceremony, input.verified) ||
    !input.verified.userVerified ||
    !ceremony.profile.primarySignIn ||
    !(yield* owner.check(liveCondition(mapping, ceremony, input.claim)))
  )
    return yield* reject;

  const data = describe(
    mapping,
    jsonStorage(mapping.registration.schema).decode(row[intent.applicationSnapshot]),
  );

  if (
    data.encoded !== row[intent.applicationSnapshot] ||
    data.fingerprint !== ceremony.context.fingerprint ||
    data.name !== ceremony.context.name ||
    data.displayName !== ceremony.context.displayName
  )
    return yield* reject;
  const eligible = mapping.registration.eligible(data.registration);

  if (!(yield* owner.check(eligible))) return yield* reject;

  const provision = mapping.registration.subject({
    registration: data.registration,
    ceremony,
    marker: owner.marker,
  });

  const nativeId = provision.subjectId;
  const subjectId = SubjectId.make(mapping.read.subjectIds.toSubject(nativeId));

  invariant(mapping.read.subjectIds.equals(mapping.read.subjectIds.toNative(subjectId), nativeId));
  const table = mapping.read.subject;

  const absentSubject = yield* owner.read(
    table.table,
    equal(table.table, { [table.id]: nativeId }),
    { limit: 1 },
  );

  if (absentSubject.rows.length !== 0) return yield* reject;

  const values = {
    ...provision.values,
    [table.id]: nativeId,
    [table.status]: mapping.registration.activeStatus,
    [table.securityRevision]: owner.marker,
  };

  const inserted = yield* owner.insert(table.table, values, { [table.id]: nativeId });

  absentSubject.rows = inserted.rows;

  const subject = {
    subjectId,
    nativeId,
    row: values,
    revision: PasskeyRevision.make({
      subjectId,
      securityRevision: PasskeyRevision.fields.securityRevision.make(owner.marker),
      credentials: [],
    }),
  };

  yield* owner.update(
    handle.table,
    { [handle.handleKey]: hashed },
    {
      [mapping.read.handleOwnership.subjectId]: nativeId,
      [handle.state]: mapping.write.handleOwnership.ownedState,
      [handle.version]: owner.marker,
      [handle.reservationId]: null,
    },
  );
  yield* readCharges(mapping, ceremony, read.policy);
  yield* guardChargeSet(mapping, ceremony);
  yield* insertCredential(
    mapping,
    subject,
    ceremony,
    input.verified,
    yield* owner.now(mapping.clock),
  );
  yield* owner.update(
    intent.table,
    { [intent.moduleId]: mapping.moduleId, [intent.flowId]: ceremony.flowId },
    { [intent.state]: intent.acceptedState, [intent.version]: owner.marker },
  );
  const flow = mapping.flow;

  yield* owner.update(
    flow.table,
    { [flow.moduleId]: mapping.moduleId, [flow.flowId]: ceremony.flowId },
    { [flow.state]: flow.states.RegistrationAccepted, [flow.version]: owner.marker },
  );
  owner.postconditions.push(
    liveCondition(mapping, ceremony, input.claim),
    mapping.registration.finalEligibility({ registration: data.registration, subjectId: nativeId }),
    sql`exists(select 1 from ${table.table} where ${both(owner.exact(table.table, values), table.activeCondition)})`,
  );

  return { _tag: "RegistrationAccepted" } as const;
});
