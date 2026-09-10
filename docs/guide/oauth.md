---
description: Separate provider sign-in, account linking, and API grants.
---

# OAuth and connected accounts

`effect-auth/OAuth` also provides guest sign-in for existing application
identities through `OAuth.make`. Identity selection uses the complete
provider, issuer and subject tuple; profile fields and email never authorize
selection or provisioning. Its base layer requires no registration, linking or
connected-token storage. Existing OAuth connection workflows remain independent.

## Protocol adapters and sign-in

`effect-auth/OpenIdClient` is an optional server protocol adapter. Its OIDC
profile requires signed ID tokens from the configured issuer's JWKS; plain OAuth
requires a fresh authenticated identity response and an application decoder.
It discards provider tokens and never persists or exposes them. Keep retained
configuration generations installed through their flow and claim horizons.
The initial profile accepts canonical HTTPS query callbacks, RS256, and explicit
Basic, Post or public-client authentication. Transport overrides must honor abort,
preserve endpoint authority, and never retry grants or log credentials.

Sign-in requires a configured protocol authority, an exact return-target policy,
and persistence that commits each flow transition under one physical owner.
Protocol work runs outside those owners. A claimed callback has one exchange
attempt and never becomes pending again: interruption, ambiguity or a later
session failure requires a new flow. Cleanup terminalizes abandoned claims and
retains replay tombstones through their captured horizons. Shared session
completion rechecks identity revisions and enforces the application's MFA policy.

Transaction encryption and request-binding signing require separate dedicated
keyrings. Retain decryption keys and protocol configurations through every issued
flow and claim horizon. Retain binder verification keys through every restricted
registration intent's original expiry as well, including deployment convergence. Private
binder commands and authorization URLs become available only after confirmed
issuance; an unknown commit outcome cannot recover or republish them.

## Registration

Optional OAuth registration creates an immutable restricted identity intent at
callback and binds application data at the first accepted registration command.
Select its sign-in Layer in place of the base Layer behind the same Begin/Complete
handlers. Only registration completion carries the application's exact codec;
it requires both the private registration bearer and the original request binder.
Application policy owns roles, invitations and tenant authorization. A submitted
email address is not verified by this process. Registration never issues a session.

The registration authority must bind the original command and full request while
creating the subject, external ownership and login credential in one commit, or
first record protected pending work and reserve the external tuple before external
provisioning. Pending reservations exclude every competing intent and remain until
reconciliation, including after bearer expiry. Exact replay returns safe metadata;
changed data or uncertain provisioning cannot restart or adopt an orphan. A pending
reference grants no authentication or reconciliation authority. Finalization plans
permit one execution of `commit`; unknown results discard
receipts and require an authenticated fresh lookup of the original decision.

## Linked login accounts

Optional OAuth accounts management requires independently verified fresh action
evidence at both ends of linking and before unlinking. The original subject and
security revisions remain fixed; a newer session cannot rescue a stale link.
Linking uses a distinct request-binding purpose and transaction encryption domain.
A provider login, pending sign-in or registration bearer is not action authority.
Consumed one-time factors remain consumed if the later mutation rejects.

The accounts owner joins full-tuple ownership, login/shared-factor changes,
security revision advancement, invalidation and lifecycle events in one commit.
Unlink must evaluate remaining usable primary sign-in methods and enabled factor
policy under that same owner using the installed methods' eligibility rules.
Factor-only credentials and connected grants do not count as primary methods.
Keep external ownership while connected access still references it; unlinking
login authority does not disconnect application API access.

Account mutations issue no replacement session. Changed results report the
selected strategy's actual invalidation window; unchanged links invalidate
nothing. Exact unlink replay returns stored safe metadata without consuming
another action factor, repeating events or issuing private commands. Unknown
outcomes discard receipts and never authorize retrying provider exchange.

## Connected API grants

Optional `OAuth.makeConnected` manages API grants separately from login
credentials and sessions. It requires dedicated connected action authority,
request binding, transaction encryption and encrypted token custody. Permission
profiles fix the provider, client registration, scopes and resources; retaining
refresh tokens is explicit. The token-bearing protocol and persistence services
are separate capabilities from sign-in and the token-discarding protocol adapter.

`effect-auth/OpenIdClientConnected` supplies the optional token-bearing
protocol. Retained profiles and client registration identities must remain
consistent across adapter instances and configuration rotation. Resource indicators
are declared grant targets, not proof of an opaque token's audience. Refresh
validates any returned ID token against the original signed identity and retains
the original authentication context. Provider rotation and revocation capabilities
must be explicitly verified: a successful RFC 7009 job acknowledges only its
captured tokens, not remote cohort erasure or quiescence. Durable cutoff and
unresolved-work decisions remain with connected persistence.

Server-only `withAccessToken` requires an authenticated invocation. Its final
same-owner admission checks current subject, policy, grant and cohort authority
after decryption. A confirmed receipt permits at most one callback invocation;
crashes may prevent that invocation, and disconnect cannot undo admitted external
work. The application callback is trusted with the token and owns its own errors
and service requirements. No token-use callback is exposed through RPC.

Refresh claims have fixed deadlines and no takeover after ambiguity. Disconnect
disables local use before remote revocation, retains the full-tuple ownership and
cohort cutoff needed to exclude older work, and conservatively invalidates sibling
grants in that cohort. Late exchanged tokens enter encrypted cleanup custody.
Unknown exchange, refresh or revocation outcomes require reauthorization or
explicit reconciliation; clearing an old job alone cannot clear unresolved
cohort work. An exchange whose external tuple is still unknown retains a
conservative client-registration dependency through reconciliation or proven
provider quiescence, even after its ordinary flow retention expires.
Applications own the durable authority, explicit maintenance scheduling and key
retention through every grant, refresh and revocation horizon.

Production OAuth adapters must encrypt tokens at rest and keep token values
out of logs, errors, and telemetry. In-memory stores are for development only.

## Browser callbacks

Browser adapters must inject the initiating client's binder from private storage,
reject body or URL overrides, and enforce same-origin CSRF protection. Before
parsing callbacks, bound their raw size and reject duplicate fields. The generic
RPC resolver does not supply this predecode boundary. Native callers may retain
explicit binders in keyed secure storage; the standard browser binding slot
supports one flow at a time. Only an explicitly configured callback and approved
return target may participate; the core does not redirect or install a provider.

## GitHub OAuth Apps

`effect-auth/GitHub` is a GitHub.com OAuth App reference for the ordinary
and connected ports, backed by the optional maintained `openid-client` adapter.
It fixes the endpoints and stable numeric account identity, requests `read:user`
for sign-in, and grants no authority from email. Connected permission profiles
use the actual client ID as their cohort registration identity. Keep retired
client credentials and profile generations available while their flows, grants
or cleanup obligations survive.

Expiring connected grants require rotating refresh receipts; `offline_access`
is an authorization modifier, never a stored permission. Grant revocation uses
GitHub's app/user-wide DELETE endpoint and confirms only its exact 204 receipt.
An expired access token can leave cleanup unresolved even when a refresh token
remains. The reference does not refresh for cleanup or retry remote mutations.
GitHub App installation/user tokens and their production migration are separate
from this OAuth App reference.

See the [GitHub example](./examples.md#authentication-methods) and [OAuth persistence mappings](../reference/adapters.md#oauth).
