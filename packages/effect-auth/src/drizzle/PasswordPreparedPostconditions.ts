import { Context, type Effect } from "effect";

import type { PreparedCommit } from "../hooks/commit";
import type { PasswordUnavailable } from "../password/methods/errors";
import type { ProofUnavailable } from "../proofs/errors";
import type { PasswordSqlDatabase } from "./password-sql";

/** Final reads resolve the current physical owner, never a released savepoint. */
export class CurrentPasswordPreparedTransaction extends Context.Service<
  CurrentPasswordPreparedTransaction,
  PasswordSqlDatabase
>()("effect-auth/drizzle/CurrentPasswordPreparedTransaction") {}

export type PasswordPreparedPostcondition = Effect.Effect<
  void,
  PasswordUnavailable | ProofUnavailable,
  CurrentPasswordPreparedTransaction
>;

/** Registration ends when the application owner returns, before final validation. */
export class PasswordPreparedPostconditions extends Context.Service<
  PasswordPreparedPostconditions,
  { readonly register: (check: PasswordPreparedPostcondition) => boolean }
>()("effect-auth/drizzle/PasswordPreparedPostconditions") {}

/** Journal registration closes with the prepared-password owner callback. */
export class PasswordPreparedJournalGuards extends Context.Service<
  PasswordPreparedJournalGuards,
  { readonly register: (guard: PreparedCommit<void>) => boolean }
>()("effect-auth/drizzle/PasswordPreparedJournalGuards") {}
