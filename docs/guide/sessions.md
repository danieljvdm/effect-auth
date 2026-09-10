---
description: Choose a session strategy and understand completion, invalidation, and step-up.
---

# Sessions

`effect-auth/Sessions` preserves consumer claim codecs and keeps credential
commands outside public operation results. A per-call collector accepts those
commands; the outer HTTP or native workflow owns cookie or secure-store
persistence. Never put bearer credentials or private commands in RPC success
schemas, logs, or lifecycle events.

## Choose a strategy

Stateful verification is authoritative and uncached. Pure stateless verification
and renewal need no identity authority or database; sign-out clears the local
credential, while existing tokens remain valid until their original absolute
expiry. State-assisted signing is a separate Layer. Key/generation changes take
effect only as each runtime installs the new configuration; a deployment cannot
claim global invalidation before all verifiers have changed.

Trusted methods capture subject and credential revisions before verification.
Completion compares those same revisions and current factor policy at the
actual commit. Reset, disable/delete, and identifier/factor changes must advance
the security revision in the same authority as the change. A pure stateless
consumer accepts the bounded exposure of existing tokens or selects state.

## Commit before delivery

Persistence adapters own the transaction or batch and prepare private results
before its physical commit. Nested work returns an opaque receipt; only the
outer owner can make it readable. Call `AuthenticationCompletion.prepare` for
transaction assembly, then read the receipt and deliver commands after the
outer commit succeeds. Public operations reject unsupported ambient execution
before mutation. D1 owners must allocate final session IDs/versions before the
batch; they cannot prepare after a committed batch or use stale replica reads
for immediate revocation. Duplicate stateful and pending flows fail instead of
pairing an existing digest with a newly generated bearer.

The session example's disposable memory authority demonstrates composition,
not durable or database transaction guarantees. Production consumers provide
persistence and commit ownership appropriate to their driver.

A failed sign-out can still return an explicit failure outcome with a local
clear command; it never reports successful server revocation. Credential
collection is best effort after commit. If a process fails between a stateful
commit and delivery, the digest cannot recover the lost bearer: retrying that
flow fails, and the consumer starts a fresh authentication flow. This boundary
does not promise exactly-once credential delivery.

## Inspect a session

Session inspection is an internal method capability authenticated by the private
bearer. It returns the original evidence and an issued-credential version distinct
from storage CAS revisions. Public verification, lists and RPC responses exclude
those private fields. Stateful mappings must explicitly persist them and rotate
the credential version while retaining provenance and the original authentication
and absolute-expiry horizons. Old records/envelopes are not inferred or upgraded.
Signed envelope v2 authenticates provenance but does not encrypt it; a bearer
holder can decode that metadata. Choose an explicit confidential token strategy
when credential metadata must also be hidden from the bearer holder.

## Step-up authentication

Reusable session step-up is optional and uses fixed server-owned profiles and a
separate private credential. Its context only correlates independently verified
factor evidence; it grants no session or action authority. Completion requires
the original session bearer again and preserves its authentication and absolute
expiry horizons. Changing a profile requires a generation bump deployed across
all runtimes. Browser adapters must supply both private credentials, reject client
overrides, and protect Begin against CSRF.

Step-up persistence must consume the intent and rotate the stateful session or
invalidate the state-assisted source lineage in one authority. Pure signed
completion consumes the intent while the old bearer retains its existing
lifetime. Private replacement commands remain unavailable until the actual outer
commit succeeds. Failed factors charge committed rejection decisions; factor
implementations remain separate capabilities. Maintained mappings use a distinct
intent table and a fixed source kind. Stateful mappings must encode the full
replacement Claims and provenance, including queryable credential version and
authentication time; generic security guards do not validate consumer Claims
serialization. Use the target coordinator to join consumer writes to the same
commit authority. Do not approximate this transition by composing standalone pending, renewal or revocation
commits.

See the [session example](./examples.md#sessions-and-identity) and [persistence adapters](../reference/adapters.md).
