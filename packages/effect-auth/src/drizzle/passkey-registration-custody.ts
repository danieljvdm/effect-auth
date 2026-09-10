/* oxlint-disable no-explicit-any -- private mapped custody writes preserve the public concrete table descriptors. */
import { Effect } from "effect";

import type { PasskeyCeremony } from "../passkey/models";
import {
  ceremonyStorage,
  equal,
  handleKey,
  invariant,
  CurrentPasskeyTransaction,
} from "./passkey-state";

/** SQL-local writers have no external provisioning work. A definite terminal
 * rejection can release only its exact still-reserved handle; ambiguous owners
 * retain custody, and an accepted transaction no longer matches this reservation. */
export const releaseRegistrationCustody = Effect.fn("passkey.releaseRegistrationCustody")(
  function* (mapping: any, ceremony: PasskeyCeremony) {
    if (mapping.registration === undefined || ceremony.context._tag !== "Registration") return;
    const owner = yield* CurrentPasskeyTransaction;
    const handle = mapping.handle;
    const intent = mapping.intent;
    const hashed = handleKey(ceremony.profile.rpId, ceremony.context.userHandle);

    const held = (yield* owner.read(
      handle.table,
      equal(handle.table, { [handle.handleKey]: hashed }),
      { limit: 1 },
    )).rows[0];

    const row = (yield* owner.read(
      intent.table,
      equal(intent.table, {
        [intent.moduleId]: mapping.moduleId,
        [intent.flowId]: ceremony.flowId,
      }),
      { limit: 1 },
    )).rows[0];

    if (row === undefined || !intent.isPendingState(row[intent.state])) return;
    invariant(
      held !== undefined &&
        handle.isReservedState(held[handle.state]) &&
        held[handle.reservationId] === row[intent.reservationId] &&
        row[intent.handleKey] === hashed &&
        row[intent.commandId] === ceremony.commandId &&
        row[intent.ceremonySnapshot] === ceremonyStorage.encode(ceremony),
    );
    yield* owner.update(
      intent.table,
      { [intent.moduleId]: mapping.moduleId, [intent.flowId]: ceremony.flowId },
      { [intent.state]: intent.rejectedState, [intent.version]: owner.marker },
    );
    yield* owner.remove(handle.table, { [handle.handleKey]: hashed });
  },
);

/** Keep the command/flow tombstone after retention, without retaining the
 * application registration payload or ceremony. Ambiguous custody is never scrubbed. */
export const scrubRegistrationIntent = Effect.fn("passkey.scrubRegistrationIntent")(function* (
  mapping: any,
  ceremony: PasskeyCeremony,
) {
  if (mapping.registration === undefined || ceremony.context._tag !== "Registration") return;
  const owner = yield* CurrentPasskeyTransaction;
  const intent = mapping.intent;
  const identity = { [intent.moduleId]: mapping.moduleId, [intent.flowId]: ceremony.flowId };

  const row = (yield* owner.read(intent.table, equal(intent.table, identity), { limit: 1 }))
    .rows[0];

  if (row === undefined) return;
  invariant(
    (row[intent.state] === intent.acceptedState || row[intent.state] === intent.rejectedState) &&
      row[intent.commandId] === ceremony.commandId &&
      row[intent.ceremonySnapshot] === ceremonyStorage.encode(ceremony),
  );
  yield* owner.update(intent.table, identity, {
    [intent.applicationSnapshot]: "",
    [intent.ceremonySnapshot]: "",
    [intent.version]: owner.marker,
  });
});
