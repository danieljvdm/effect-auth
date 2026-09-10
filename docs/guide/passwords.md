---
description: Compose password sign-in, hashing, registration, and recovery.
---

# Passwords

Use `Password.make()` for password authentication. Enable registration and reset only when the application provides their additional authorities. The [getting-started example](./getting-started.md#define-authentication) shows a sign-in service.

## Hashing and password policy

`effect-auth/Password` separates byte-preserving hashing from acceptance of new
passwords. New-password checks require an explicit compromised/common-password
capability; the package supplies no permissive production fallback or implicit
network disclosure. The lower password minimum is a trusted method choice only
when every password use, including recovery, requires MFA.

Persist normalization provenance beside each verifier. New-password policy
defaults to NFC; legacy PBKDF2 and its Argon2id rehash retain `none`. Login uses
the stored mode rather than inferring it from the hash algorithm. Rehash only
after successful verification and under the original credential revision CAS;
hashing alone supplies no registration, sign-in, reset, or persistence workflow.

Share one `PasswordKdfAdmission` Layer across hashers in a runtime. It rejects
excess work and retains capacity until nonabortable computation finishes even
when its caller is interrupted. Local capacity is separate from distributed
attempt limits. Portable Argon2id uses bounded, explicit work factors; its async
implementation is not off-thread, and JavaScript cannot promise hard constant
time. Deployments must supply sufficient CPU/memory or a suitable replacement
hasher. The package never lowers costs after a runtime or quota failure.

Malformed/over-budget verifier diagnostics are internal: method operations must
preserve uniform authentication failures. Passwords and encoded verifiers remain
Redacted, and the dummy path performs one admitted current-cost derivation even
on the first unknown-identifier request. Example screening data is disposable.

## Registration, sign-in, and changes

`Password.make` with explicit registration and reset configuration supplies
shared local/RPC registration, sign-in, password changes and reset operations.
Registration acknowledges a request without
logging in or verifying its email. Replayed registration requests retain the
original protected intent: fresh salted verifiers cannot establish password
identity, and a pending reference grants no authority to adopt or resume it.

Password attempt admission commits before guessing and is never refunded on
interruption. Sign-in commits attempt settlement and optional verifier-version
rehash, then performs session completion outside the password transaction using
the original semantic revisions and proof time. A crash or session failure can
leave bookkeeping or a harmless rehash committed without issuing authentication.
A fresh attempt is required. Changing a password skips opportunistic rehash.

Plan password mutations before entering a physical transaction; provide the
transaction-bound authority when executing the plan's `commit` Effect. Reset continuation
consumption, password replacement, security-revision changes and required
invalidation must share one conditional commit. Identifier changes that invalidate
captured login evidence must also advance subject securityRevision atomically.

Action authorization verifies independent fresh evidence against the current
call's private salted replacement intent. Replay-sensitive factors are consumed
in their own authority before the password mutation and remain consumed if that
mutation fails. Retry with a fresh factor; a grant for an earlier salted intent
cannot resume this workflow. Enabled MFA is never satisfied by a bare password
or reset continuation. Consumer-owned staged-intent workflows require their own
protected persistence and resume authority.

## Prepared password intents

Optional prepared password intents reserve a bounded command before screening or
hashing. Only the committed reservation winner creates one salted replacement;
a failed or interrupted preparation remains charged and cannot be taken over by
retrying that command. Ready publication alone releases its private bearer.
Existing one-call password operations do not require intent persistence.

Prepared completion preserves the original password proof instant and exact
replacement. Additional-factor methods may use internal authorized completion
after consuming their own ceremony; a later password failure does not refund that
factor. Reset requires the original continuation bearer again and consumes it with
the password mutation. Intent, password, revisions, invalidation, and optional
proof writes need one prepared persistence authority. Maintained intent mappings
are a separate capability; composing independently committing ports is unsafe.
Base and Reset handlers/groups are separate so Add/Change need no proof service.
Browser adapters must protect the distinct private intent credential against
client override and CSRF; it belongs in protected storage, never a URL.

## Example and adapters

The password-method example uses real hashing and signed sessions with an
explicit disposable sequential storage model, local screening and fake delivery
and factor verifiers. It rejects ambient transactions. It demonstrates the
method contract, not production database atomicity, distributed budgets, or a
production MFA implementation; maintained driver mappings must enforce those
contracts before the methods are mounted in a real application.

Continue with the [runnable password example](./examples.md#authentication-methods) or [Drizzle password mappings](../reference/adapters.md#passwords).
