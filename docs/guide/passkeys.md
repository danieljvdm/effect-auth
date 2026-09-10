---
description: Compose WebAuthn ceremonies with explicit protocol, account, and persistence authority.
---

# Passkeys

The optional `effect-auth/Passkey` core separates sign-in, registration,
enrollment, management, pending login, step-up and protected-action capabilities.
Applications explicitly provide `PasskeyProtocol`, persistence and account
authority. The maintained verifier is available through the server-only
`PasskeySimpleWebAuthn` entrypoint. Shared contract imports never install it.
Browser interaction and database adapters remain separate.
`effect-auth/PasskeyPassword` binds separate assertion payloads to existing
prepared password intents. Reset validates the original continuation before
spending the passkey, and the password owner repeats its final checks.

## Ceremonies and credential ownership

Every ceremony binds its purpose, RP/profile, challenge, private browser binder
and original target authority. A confirmed fixed claim allows one verification;
interruption or uncertain commit never permits another attempt on that claim.
Proof freshness uses the original challenge issue instant because WebAuthn does
not attest the time of the gesture. Failed session or target completion does not
refund the spent assertion. Registration creates no authentication evidence or
session; factor-only enrollment remains ineligible for primary sign-in.

The RP authority owns protocol credential IDs and opaque user handles across
all same-RP module aliases. Public protocol options necessarily contain opaque
IDs; management summaries exclude them. The verifier must validate RP domain
and public-suffix policy, exact origins, UP/UV, signature, credential identity and
backup eligibility. Core URL checks alone are not a public-suffix authority.
Single-device positive counters must increase; synced credential observations
merge without turning telemetry races into a second replay mechanism.

Persistence owners enforce current policy, original semantic revisions, durable
admission windows, ownership, last usable method and final physical clock guards
in the same commit as their writes. Retain unresolved provisioning reservations
and full admission charges independently of ceremony cleanup. Counter, backup
telemetry and rename preserve semantic revisions; removal or eligibility changes
advance credential and subject security revisions. Management reports the chosen
session strategy's actual invalidation window.

## Server verification

The optional `effect-auth/PasskeySimpleWebAuthn` adapter implements the passkey
protocol with SimpleWebAuthn and a maintained public-suffix authority. Register
explicit RP/profile generations, retaining original profiles while their
credentials remain usable. Its canonical framing checks preserve the original
signed bytes.

The verifier's ASN.1 parser and decorated key classes must share one resolved
`@peculiar/asn1-schema` registry. A dependency graph containing separate versions
can make valid ES256 assertions unavailable; keep that transitive dependency
deduplicated when updating the maintained verifier.

The adapter performs no network or persistence work. Effect interruption can
discard its result but cannot cancel a native WebCrypto operation already in
progress; the core retains ownership of the spent claim and final freshness
checks. Browser interaction and database mappings remain separate capabilities.

## Browser ceremonies

The optional `effect-auth/PasskeyBrowser` capability runs native browser
ceremonies inside Effect. The application owns Begin/Complete RPCs, request
binding and session state; React only dispatches the workflow. The helper uses
maintained conversion/capability helpers, preserves the issued options and
returns a bounded Redacted response without client extension outputs.

Each request owns its AbortController. Interrupting an Effect requests native
cancellation and suppresses its result, but cannot undo a credential or signature
already produced. A started native promise keeps the helper Busy until it
settles; a broken browser or extension may require a page reload. This module's
instances coordinate with each other, not third-party calls or separate module
copies. Conditional authentication requires positive feature detection, an empty
allow-list and a light-DOM input with a final `webauthn` autocomplete token.
Capability reports do not reveal whether an account or credential exists.

Use the [Studio example](./examples.md#http-and-browser-clients) for composition and [Drizzle passkey mappings](../reference/adapters.md#passkeys) for storage.
