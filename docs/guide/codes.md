---
description: Use possession proofs, email links and codes, phone authentication, and second factors.
---

# Email, SMS, and TOTP

Email and SMS establish control over a destination through scoped proofs. TOTP adds enrollment, factor verification, and recovery. Applications supply delivery, policy, and persistence.

## Possession proofs

`effect-auth/Proofs` owns purpose-bound possession proofs, delivery decisions,
restricted continuations, and semantic persistence commands. Trusted methods
choose eligibility and bind the exact target, action, flow, and captured
revisions. Material chosen later uses separate trusted action authorization;
the original proof binding stays fixed. Public context must never include
plaintext secrets or guessable fingerprints of passwords. Custom binding fields must feed `contextDigest`; they
are not implicitly included in canonical proof bytes. Host adapters also enforce
trusted network/device ingress limits before parsing requests.

Proof persistence owns authoritative rolling issue/attempt budgets and atomic
supersession, continuation consumption, and send claims. Failed attempts are
committed decisions before a public failure is returned. Method-specific reset
or linking commands consume `Proofs.planComplete` and perform the protected write
under the same conditional authority. Standalone completion intentionally burns
the continuation before downstream work; it never grants a session by itself.
Drizzle consumers own these tables, codecs, migrations, and the exact uniqueness
constraints declared by their mapping. Retain scope anchors until bounded cleanup
has removed their related histories. Use the target coordinator for application
writes in the same authority; a D1 owner admits one proof transition per batch and
is never replayed after an ambiguous batch result.

Email/SMS secrets remain in private prepared dispatch closures, outside lifecycle
events and RPC results. Dispatch begins only after the actual root commit and
persists a claim before sending. Vendor acceptance is not recipient delivery;
ambiguous retries require a declared vendor idempotency horizon and retain the
same delivery ID. A process crash can lose an un-dispatched secret: this closure
is not a durable outbox. Recovery starts a new budgeted issuance. An encrypted
outbox requires a custom issuance/delivery coordinator joined to the same
authority; the built-in issuance plan does not expose such a staging seam. Restricted continuation bearers
use the separate private credential-command path and are stored only as digests.

The proof example uses disposable single-process storage and fake senders. It
rejects ambient transactions and subject-bound commands; production adapters
must supply real commit ownership, revision checks, and distributed limits.

## Email codes and links

`effect-auth/Email` separates code/link sign-in from registration and address
management. Compose only the capability Layers being installed. Sign-in consumes
a restricted proof first, then asks the common completion authority to evaluate
the original revisions and current MFA policy. Failure after that first commit
burns the proof and requires a new request. Registration returns no session;
verified email is an identifier claim, never automatic MFA assurance.

Registration and address changes consume `ProofCompletionPlan` in the same
physical owner as identifier/credential creation, uniqueness, security-revision
changes and invalidation. Plan before locks; provide the transaction-bound
authority when executing the plan's `commit` Effect. Registration DTO snapshots derive from their Type,
so original wire transformations run once. Opaque Type values without a derived
JSON representation are rejected rather than shared across callback boundaries.
The consumer owns a deterministic fingerprint of the entire validated intent.
Pending provisioning metadata cannot adopt or authorize a protected intent.

### Request binding

Every email request, resend, attempt and completion requires the initiating
client's private request-binding credential. The shared binding factory fixes
module, purpose and signing policy, with a dedicated keyring; its expiry is a
request-entry deadline, while final proof/action expiry belongs to the commit
owner. The scalar credential slot supports one standard browser flow at a time.
Native consumers may explicitly retain separate bindings in keyed secure storage.
The binder's derived verifier is internal correlation, never issuance authority.

Browser transport must inject the binder from private storage and rejects body/URL
overrides; every binder-bearing mutation requires same-origin CSRF protection.
The generic RPC resolver runs after payload decoding and is insufficient for
HttpOnly injection by itself: browser adapters must supply a trusted predecode
boundary. The local/native facade intentionally accepts the explicit redacted
credential. A forwarded link or code alone cannot authenticate a different
client; return to the initiating client or start a new flow.

### Magic links and address changes

Magic-link delivery uses a fixed HTTPS landing URL with reference/token only in
the fragment. Disable vendor rewriting that leaks fragments. Landing GET is
static, non-redirecting consumer UI with no-store/no-referrer/restrictive CSP;
it never consumes proof or issues authentication. Client code removes the
fragment immediately and waits for intentional confirmation before a protected
POST. Binder, flow and return target come from private originating-client state,
never email/deep-link fields. Return targets require explicit consumer approval
before binding and consumption; the core never performs the redirect.

Address authorization is independent of target-mailbox possession. Fresh
replay-sensitive factors may be consumed before the identity owner and are not
refunded on its later rejection. Optional old-address notifications compose as
ordered postcommit hooks with stable event IDs; failures cannot roll back or
repeat the identity change. Direct notification is best effort. Durable delivery
requires a consumer outbox joined to that same owner.

The email example exercises both session strategies with disposable sequential
storage, fake independent factors/mail and real cryptographic boundaries. Its
local landing route demonstrates scanner-safe GET behavior; deployed browser
CSRF/cookie wiring and all maintained method mappings remain separate integration
boundaries. Do not mount generic email removal without the same ownership,
last-method, revision, proof cleanup and invalidation joins.

## Phone codes

`PhoneOtp` supports phone-only registration, verification, sign-in and authenticated
change. Consumers own numeric or custom account IDs, country eligibility, sender,
spend policy and trusted per-request network identity. Native custody tombstones
prevent a recycled number from silently acquiring a previous account. SMS carries
neither user-verification nor phishing-resistance assurance. The runnable
[phone consumer](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/phone-sqlite-bun.ts) uses a controlled sender and pure
stateless sessions without a session table; its migrations belong to the consumer.

## TOTP and recovery codes

`Totp` owns encrypted enrollment, confirmation, replay/attempt policy and single-use
recovery. Consumers provide encryption keys, current factor requirements and fresh
action evidence; retain old decryption keys through outstanding enrollment and
factor lifetimes. Private setup and recovery reveals are finite capabilities,
never ordinary query state. The [Studio consumer](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-consumer.ts)
combines passkeys and TOTP with UUIDv7 IDs, PostgreSQL timestamps, a registration
hook and stateful sessions. Its [browser workflows](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-browser.ts)
use the same contracts as its HTTP server.

See [HTTP and client state](./http-and-client.md) for private browser delivery and the [examples](./examples.md) for runnable flows.
