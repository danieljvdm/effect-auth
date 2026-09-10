import { Effect, Layer, Option } from "effect";
import {
  IdentityRepository,
  numericSubjectId,
  stringSubjectId,
  SubjectSnapshot,
} from "effect-auth/Identity";

/**
 * Minimal read-only identity compositions, deliberately without a database or
 * another authentication method. These collections are demonstration data,
 * not a production persistence adapter.
 */
const staff = new Map([
  ["01991ac9-e630-7ef2-9577-af4d762fa101", { suspended: false }],
  ["01991ac9-e630-7ef2-9577-af4d762fa102", { suspended: true }],
]);

export const staffIdentity = Layer.succeed(IdentityRepository, {
  findSubject: Effect.fn("StaffIdentity.findSubject")(function* (subjectId) {
    const id = yield* stringSubjectId.toNative(subjectId).pipe(Effect.orDie);
    const row = staff.get(id);

    return row === undefined
      ? Option.none()
      : Option.some(
          SubjectSnapshot.make({ subjectId, status: row.suspended ? "disabled" : "active" }),
        );
  }),
  findIdentifier: () => Effect.succeed(Option.none()),
  findExternalIdentity: () => Effect.succeed(Option.none()),
  listIdentifiers: () => Effect.succeed([]),
  listCredentials: () => Effect.succeed([]),
});

const shoppers = new Map([[42, { enabled: true }]]);

export const shopperIdentity = Layer.succeed(IdentityRepository, {
  findSubject: Effect.fn("ShopperIdentity.findSubject")(function* (subjectId) {
    const id = yield* numericSubjectId.toNative(subjectId).pipe(Effect.orDie);
    const row = shoppers.get(id);

    return row === undefined
      ? Option.none()
      : Option.some(
          SubjectSnapshot.make({ subjectId, status: row.enabled ? "active" : "disabled" }),
        );
  }),
  findIdentifier: () => Effect.succeed(Option.none()),
  findExternalIdentity: () => Effect.succeed(Option.none()),
  listIdentifiers: () => Effect.succeed([]),
  listCredentials: () => Effect.succeed([]),
});
