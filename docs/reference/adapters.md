---
description: Choose an optional adapter and preserve its transaction and retry contracts.
---

# Adapters and persistence

Adapters implement the application-owned ports. Import them from their direct subpaths and install only the peers needed by that adapter. Consumers own tables, codecs, IDs, migrations, and transaction authority.

| Runtime or database              | Module                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shared Drizzle mapping contracts | `effect-auth/Drizzle`                                                                            |
| PostgreSQL / PGlite              | `effect-auth/DrizzlePostgres`, `effect-auth/DrizzlePglite`                                       |
| MySQL                            | `effect-auth/DrizzleMysql2`                                                                      |
| libSQL                           | `effect-auth/DrizzleLibsql`                                                                      |
| SQLite in Node, Bun, or WASM     | `effect-auth/DrizzleSqliteNode`, `effect-auth/DrizzleSqliteBun`, `effect-auth/DrizzleSqliteWasm` |
| Cloudflare D1 / Durable Objects  | `effect-auth/DrizzleD1`, `effect-auth/DrizzleSqliteDo`                                           |
| Cloudflare platform integration  | `effect-auth/Cloudflare`                                                                         |

Choose protocol and browser adapters in the [OAuth](../guide/oauth.md) and [passkey](../guide/passkeys.md) guides. See [Examples](../guide/examples.md) for concrete compositions.

## Passwords

Drizzle password mappings keep attempt budgets, credential revisions and subject
security revisions under one native transaction or D1 batch. Consumers own the
tables, codecs, IDs and migrations. Reset support is optional and requires the
matching proof mapping; registration uses declarative provisioning or returns a
non-authorizing pending reference. D1 registration requires a preallocated ID.

Prepared password mappings reserve admission before password screening or KDF
work and consume the Ready intent with the password mutation, revisions and
optional original recovery proof in one owner. Retained intents carry
nonrefundable admission charges after sensitive fields are erased; maintenance
must preserve both admission and replay horizons. A permanent module admission
row coordinates competing reservations. All runtimes of that module must agree
on generation and admission policy, and changes to authentication policy or
eligibility must advance the shared subject security revision.

Join application writes through the prepared persistence coordinator. D1 uses
one conditional batch and never replays a caller-owned command after an
ambiguous result. Durable Object owners require synchronous allocators and
codecs inside their actual transactionSync; do not nest these services in an
untracked raw Drizzle transaction. Reset is independently optional and requires
only the matching proof completion capability.

## Email

Drizzle email mappings keep verified identifiers, email credentials, every
factor revision and the subject security revision under one native authority.
Sign-in lookup remains independently constructible and needs only subject,
identifier and email-credential tables. Address changes require the matching
proof mapping, retire the selected source and advance the shared security
revision; every policy or eligibility change that affects authentication must
advance that same revision. D1 uses one preplanned conditional batch and never
replays a caller-owned command after an ambiguous result. Durable Object bound
registration requires synchronous registration snapshots and inspection, and
must not be nested in an untracked raw Drizzle transaction.

Address cleanup removes address command records only. Consumers own bounded
registration maintenance. Never delete an unresolved pending registration only
because its retention deadline elapsed: external provisioning may still finish.
Remove only proven terminal reconciliation or registered tombstones after their
declared replay and related proof/request horizons. A pending reference grants no
reconciliation or authentication authority.

## OAuth

Drizzle OAuth mappings independently compose sign-in, restricted registration
and account management. Consumers own tables, migrations, exact uniqueness and
native ID codecs. Every OAuth module shares one full-tuple authority and at most
one active login credential per external identity. The fixed tuple key excludes
the module; exact provider, issuer and subject bytes remain authoritative.
Another module's login is rejected, never relabeled or duplicated. Separate
legacy ownership tables must join that same tuple authority. Unowned anchors
remain after bounded cleanup; unresolved reservations are never expired away.

Known-subject owners lock the subject before its sorted credential vector.
Registration locks configured application authority anchors before tuple,
intent and command rows; application coordinators must use that same order.
Shared mutable admission, such as invitations or tenant quotas, requires these
stable anchors or an equivalent owner-held lock. Admission precedes application
writes; a separate final predicate verifies their resulting state. Registration
serialization preserves the exact application Type and must roundtrip through
its declared private representation. Mapped rows use plain structured data,
Dates and binary values; codecs reconstruct application identity classes.

Each coordinator permits one semantic mutation and closes its bound services
when the owner exits. Prepare before physical commit and read receipts afterward;
closed, poisoned or uncertain owners cannot expose private results. Native SQL
constraint failures remain unavailable unless a committed authority decision
establishes a conflict; they never trigger automatic retries. MySQL OAuth owners
reserve one connection and select READ COMMITTED for that transaction without
changing pooled session defaults. PostgreSQL clocks must use actual wall time
after lock acquisition, not transaction-start timestamps.

D1 requires authoritative primary reads and one conditional batch. Its fixed
claim-time sample and repeated engine-time guards allow queueing only to shorten
the usable lease. Durable Object mappings require one database containing tuple,
subject, factor, flow, intent and application authority; a separate global tuple
registry cannot provide this atomic contract. Native DO owner bodies and bound
registration codecs remain synchronous. Eligibility descriptors must describe
the actual installed method and verified identifier state. Every policy or
eligibility mutation must advance the shared revision; generic active status
alone does not establish a usable primary sign-in method.

## Passkeys

Passkey Drizzle mappings separate credential/context reads from assertion
persistence. The assertion facet supports sign-in, pending authentication,
step-up and protected actions. Registration and management mappings provide issuance, enrollment, provisioning
and credential writers under the same native owner. Registration admission and
its final eligibility predicate are distinct; declare mutable policy guard rows
so they remain locked through provisioning. Unsupported purposes fail closed.

Keep RP ownership, subject and credential revisions, declared policy guards,
ceremonies and admission charges in one physical authority. Native IDs remain
consumer-owned, and row callbacks may use only their declared columns. Context
reads are advisory; a coordinator permits one mutation that rereads and locks
current authority. Final admission stamps preserve the full charge horizon after
queue or application delay. Cleanup never releases unresolved registration
custody, and a later session or action rejection does not refund an assertion.

## Connected OAuth grants

Connected OAuth mappings expose management persistence and revocation workers as
independent capabilities. They share the global external tuple authority with
login mappings but never create login credentials or change sessions. Mapped
SQL fragments, tables and codec implementations are immutable configuration;
callbacks receive detached bounded inputs. Application policy predicates and
stable policy guard rows remain authoritative through the final commit.

Connected client-registration tables also hold permanent provider/issuer scope
anchors. Keys must fit 52 ASCII characters; an empty registration ID is reserved
for a scope anchor and its counter remains zero. Client and tuple mutation authority
always acquires the scope first. Compose Accounts with
`oauthConnectedOwnershipReferences` so unlink uses that same lock. Missing or
malformed anchors conservatively retain ownership. Automatic connected release
also requires the application's same-owner external-reference predicate.

Keep client counters and subject-independent cohort generations/cutoffs after
cleanup and ownership changes. Unknown initial exchanges retain their dependency
beyond browser retention; expiry does not prove provider quiescence. Cleanup may
resolve an exact late cancellation but cannot activate a late positive result.
Revocation confirmation opens a new generation only after all earlier relevant
work is resolved, using a newly allocated cutoff. An unsupported-only mapping
can reopen its own quiescent, previously open cohort; it cannot clear another
capability's existing barrier without the revocation authority.

All connected tables, global tuple authority, subject revisions and mutable policy
must share one physical transaction or D1 batch authority. A Durable Object
implementation requires one database for that entire authority; separate subject
objects and a global registry cannot implement these atomic contracts. Keep
ciphertext and its decryption keys until every refresh, admission and revocation
obligation is resolved. Maintenance scheduling belongs to the application.
