# effect-auth

Authentication workflows for Effect applications. The package owns
security-sensitive sign-in, session, and OAuth behavior; applications own
identity and persistence adapters.

Auth resources live in the caller's Scope. Define a shared contract containing
claims and the actions your application exposes. This module is safe to import
in the browser; implementation Layers and keys belong in the server module.

```ts
import { Schema } from "effect";
import * as AuthContract from "effect-auth/AuthContract";

export const AuthApi = AuthContract.make("app/Auth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  actions: (sessions) => ({ signIn: AuthContract.passwordSignIn(sessions) }),
});
```

The contract includes four session actions: `getSession`, `requireSession`,
`signOut`, and `renewSession`. Its `actions` callback selects additional actions;
installing a strategy does not expose all of that strategy's methods. See the
[shared contract example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/auth-contract.ts).

Bind the contract to a yieldable server service, then mount its declared actions:

```ts
import { Effect, Layer } from "effect";
import { Auth, Password, Sessions } from "effect-auth";
import * as AuthHttp from "effect-auth/Http";

import { AuthApi } from "./auth-contract";

export const AppAuth = Auth.make(AuthApi, {
  sessions: Sessions.stateful({ idleTimeout: "7 days", maxAge: "30 days" }),
  strategies: { password: Password.make() },
  defaultStrategy: "password",
});

const http = AuthHttp.make(AppAuth, { origin: "https://app.example.com" });

// Supply application-owned stores, account authority, and other required services.
const AuthLive = AppAuth.layer.pipe(Layer.provide(ApplicationServicesLive));
const Routes = Layer.mergeAll(http.routes(), ApplicationRoutes.pipe(http.middleware)).pipe(
  Layer.provide(AuthLive),
);
```

`http.routes()` mounts the shared action table with its request handling. Apply
`http.middleware` to application routes that need session context. It accepts
ordinary form, multipart, and JSON endpoints without imposing auth's payload
format. Within those routes, call the service directly:

```ts
const currentMember = Effect.fn("app.currentMember")(function* () {
  const auth = yield* AppAuth;
  const session = yield* auth.getSession();

  return session?.claims.displayName ?? null;
});
```

These are local Effect calls. `AuthRequest` remains a requirement in `R` and is
resolved for each execution; constructing the service does not capture a request.
The [server example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/auth-server.ts)
shows this boundary, while the runnable
[password example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/password-methods.ts)
supplies a complete consumer implementation.

`getSession()` returns `null` for missing or invalid credentials. Availability
failures, defects, and interruption remain failures; they never become anonymous
successes. `requireSession()` fails with `AuthenticationRequired` when anonymous.
Session claims remain the application's exact decoded type. Application profile
lookups and response projections belong to the application.

`signOut()` reads the incoming credential without first verifying it. Its result
reports `revoked`, `already-invalid`, `client-only`, or `SessionSignOutUnavailable`;
local clearing does not claim successful server revocation. `renewSession()` is
explicit: session reads never silently rotate credentials. Outside a request,
`verifySession(redactedCredential)` verifies a supplied credential without cookie
or delivery requirements.

An existing `HttpApi` can include the auth group in its shared contract and OpenAPI:

```ts
// Shared API module
const Api = HttpApi.make("app").add(ExistingGroup, AuthContract.httpGroup(AuthApi));

// Server module
const Routes = HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(http.handlers(Api)),
  Layer.provide(ExistingHandlers),
  Layer.provide(AuthLive),
);
```

Both mounting forms use the same handlers and bounded operation transport.
The group defaults to `auth`; pass matching `{ name: "account" }` options to
`httpGroup` and `handlers` to rename it. Group middleware and annotations compose
normally and their service requirements remain visible. Configure auth paths in
the `basePath` option on `AuthContract.make`, rather than prefixing or replacing
the generated endpoints after construction. The handler checks that the mounted
group still describes the exact shared contract.

The same contract gives browser code a named HTTP client, usable without React:

```ts
import { Effect } from "effect";
import * as Client from "effect-auth/Client";

import { AuthApi } from "./auth-contract";

const currentMember = Effect.gen(function* () {
  const client = yield* Client.make(AuthApi, { baseUrl: "https://app.example.com" });
  const session = yield* client.auth.getSession();

  return session?.claims.displayName ?? null;
});
```

Calls such as `client.auth.signIn({ email, password })` and
`client.auth.signOut()` also return Effects. The client supplies credentials and
CSRF transport settings; application code does not construct request headers.
Each call makes one attempt, with typed errors and schema decoding requirements.

For React, install the optional `@effect/atom-react`, `react`, and `scheduler`
peers and define the provider once:

```tsx
import * as AuthReact from "effect-auth/React";
import { useAtomValue, useAtomSet } from "@effect/atom-react";

export const BrowserAuth = AuthReact.make(AuthApi, {
  baseUrl: "https://app.example.com",
});

function App() {
  return (
    <BrowserAuth.Provider fallback={<Loading />}>
      <Routes />
    </BrowserAuth.Provider>
  );
}

function Account() {
  const auth = BrowserAuth.useAuth();
  const session = useAtomValue(auth.session);
  const signOut = useAtomSet(auth.signOut);

  return <AccountView session={session} onSignOut={() => signOut(undefined)} />;
}
```

The provider owns its client, Scope, and registry switching. `session` is an
`AsyncResult` query; each declared action also has a named atom. The same client
is available as `auth.client.auth`. Each owned provider acquires independently;
keep one around the account subtree. Put account-specific application atoms
inside it so account changes dispose their state too. Place state intended to
survive sign-out in an outer application registry. Setup failures reach the
application's React error boundary. Keep provider configuration stable and use a
React key to remount when changing it. See the [React example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/auth-react.ts).

Without React, or when the application already owns an Effect Scope, construct
the same bindings directly:

```ts
const memoMap = yield * Layer.makeMemoMap;
const appRuntime = Atom.context({ memoMap });
const client = yield * Client.make(AuthApi, { baseUrl: "https://app.example.com" });
const auth =
  yield *
  AuthAtom.make(client.auth, {
    memoMap,
    reactivityKeys: { signOut: ["projects", "profile"] },
  });
```

Use the same memo map for existing application runtimes whose queries must share
invalidation. Each successful mutation invalidates the auth queries and its
additional application keys. Account transitions settle invalidation before
interruption can escape from the disposing account registry. Direct calls through
the same `client.auth` publish the same transitions and invalidations. Private
reveals remain in their finite collector, outside query state.

Render an already acquired handle with `<BrowserAuth.Provider value={auth}>`.
The provider borrows that handle; the host keeps its Scope alive and closes it
after unmounting. `AuthReact.fromEffect(acquire)` accepts a custom acquisition
Effect whose dependencies have already been provided. `AuthReact.make` accepts
`services` for contract codec services, requiring that Layer in its options when
necessary. No async work runs while defining a provider.

For SSR, an owned provider renders only its fallback on the server. For
session-aware rendering, acquire a handle in each request's Scope and pass the
encoded result of the local `auth.getSession()` as `AuthAtom.make`'s
`initialSession` option. Render with `Provider value`, serialize only that public
session through the framework's serializer, and close the request Scope. Before
browser hydration, acquire a separate handle with the same seed in the browser
application's Scope. Never share a server registry, client, or request-bearing
memo map across requests. The [SSR example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/auth-ssr.ts)
shows rendering, hydration, and unmount finalizers.

The initial session is schema-decoded display data, not client authority. Server
rendering does not fetch. Browser reads still verify the live cookie; a result,
failure, or account transition permanently drops the seed. It cannot reappear
after sign-out. Do not hydrate auth atoms through generic late hydration updates.

Advanced non-React hosts can still observe `auth.lifetime.current` through its
`controlRegistry` and mount action/account atoms in `current.registry`.
`auth.runtime` provides the lifetime service for custom workflow atoms. Keep
multi-step flows in Effect and declare mutation reactivity keys; React renders
and dispatches, including returning promise-mode dispatches without `.then`
chains that orchestrate authentication.

`AuthContract.action` defines an additional action's input, success, and error
schemas, query or mutation mode, and selected implementation method/strategy.
`AuthContract.fromOperation` reuses a pure public operation contract.
`AuthContract.passwordSignIn` is the provided password sign-in helper; other
methods require explicit action entries. Both local and HTTP calls run the full
declared input, result, and error validation, preserving schema transformations
and typed failures. `requestFields` maps private implementation inputs to
request credential slots. `fromOperation` removes these fields from the public
payload schema; local and HTTP callers cannot supply them, and the server
injects them from `AuthRequest` at execution time.

`Sessions.stateful`, `Sessions.stateless`, and `Sessions.stateAssisted` select the
backend. Signed modes require an explicit `keys` keyring. Defaults are a seven-day
idle timeout (bounded by maximum age), thirty-day maximum age, renewal after one
day (bounded by half the idle timeout), generation 1, and a 4096-byte token limit.
Issuer and audience default to the stable session namespace. Override these
options when retaining an existing installation. After reducing maximum age,
retain `maximumIssuedAge` through the lifetime of previously issued tokens.
Pure stateless sign-out only clears the current client: existing tokens retain
their original absolute expiry.

For local composition without additional shared actions, keep the identifier form:

```ts
const LocalAuth = Auth.make("app/LocalAuth", {
  claims: Schema.Struct({ displayName: Schema.String }),
  sessions: Sessions.stateful(),
});
```

A session-only service needs its selected session backend; it does not acquire
authentication or provisioning authority. The
[application composition example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/getting-started.ts)
uses this form.

Add authentication methods with `strategies` and optionally `defaultStrategy`.
Authentication methods share the selected session implementation and default
completion authority. Other method bundles do not acquire completion authority;
custom bundles request it with `Auth.makeStrategy(methods, layer, { completion: true })`. Applications needing custom completion, pending factors,
or runtime-selected session Layers omit `sessions` and supply those services
through ordinary Layers. `Auth.Service<Self>()` is the class form of the same
service. `Auth.make` creates the service definition synchronously; `AppAuth.layer`
provides an instance, while `yield* AppAuth.make` constructs one directly in the
caller's Scope.

No-input query actions use GET, including `/auth/getSession` and
`/auth/requireSession`. Mutations use POST, including `/auth/signOut` and
`/auth/renewSession`. Queries with payloads stay POST so arbitrary inputs and
credentials do not enter URLs. The contract owns paths through `basePath`, which
defaults to `/auth`; server and named client use the same descriptors.

POST auth actions require the configured Origin, JSON content type, and
`x-effect-auth-csrf: 1` by default. GET actions have no body or CSRF header and
reject an explicitly untrusted Origin. `Client.make` handles the operation
request/response envelopes and transport settings, while the browser manages
Origin and cookies. The native `HttpApi` group documents those exact envelopes;
a plain `HttpApiClient` does not replace the named client's credential admission,
private reveal handling, or account lifetime coordination.

Cookie defaults are
`Secure`, `HttpOnly`, `SameSite=Lax`, path `/`, and the `__Host-effect-auth-`
prefix. Override `cookie.name` for the session slot,
`cookie.prefix` for all slots, or `csrf` for a different header/value. Plain HTTP
development requires an explicit `cookie.secure: false` override. Duplicate
credential cookies and unauthorized origins are rejected. Session responses are
not cacheable. Pass matching `csrf` settings to `Client.make` when overriding them.

`http.middleware` wraps raw HttpRouter or HttpApi route Layers. It installs fresh
request credentials and private collectors for each request, and delivers
commands as cookies on the completed response. It does not make every endpoint
require authentication; protected application handlers call `requireSession()`.
Named auth mutations validate Origin and CSRF before calling their implementation,
even when called locally from an application route. Raw strategy methods are
conservatively treated as mutations; declared queries supply their read mode.
For custom credential-producing workflows, use `http.protect(effect)` inside the
request boundary. It validates mutation policy before running the workflow and
providing credential collectors, while leaving its body format to the application.
Unprotected raw credential operations cannot acquire the collectors. The host
still owns ordinary application mutation policy, including webhook validation.
For declarative HttpApi protection, define `makeSessionHttpContract` from the
pure `SessionContract` module beside the shared API. Add its `RequireSession`
middleware to protected endpoints or groups, and yield its typed `CurrentSession`
in handlers. Supply `http.securityLayer(contract)` when building the API, then
apply `http.middleware` to the route Layer. The security contract declares 401
for absent/invalid sessions and 503 for unavailable verification; its cookie name
must match the adapter. See the small [shared session contract](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/session-contract.ts)
and [session HTTP example](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/session-http.ts).

`http.withRequest` wraps a custom Effect returning an HttpServerResponse.
For lower-level transport composition, `http.operationLayer` supplies the same
browser policy and caller resolution to existing `OperationHttpServer` contracts.
Those contracts continue to own private payload injection and explicitly selected
reveals. `OperationHttpClient` and the explicit `AuthAtom.query`, `mutation`, and
`workflow` helpers remain available; their authentication completion uses the same
transition boundary as the generated atoms. Custom response workflows must encode
their expected failures before leaving the request wrapper.

`Password.make`, `Passkey.make`, `PhoneOtp.make`, and `Sessions.make` are available
through named root namespaces or their explicit module subpaths. Selected strategies
include portable implementation layers where appropriate; applications supply
protocol verification, persistence, account authority, and delivery through
Effect requirements. Keys and session policy remain
explicit configuration.
Strategies share the bound session contracts and require their runtime completion
service. Ordinary setup needs no separate strategy tags or session constructor.
Explicit namespace overrides retain existing credential and operation identities
when migrating configuration. A shared namespace identifies the same logical
installation and requires compatible claims, registration codecs, and policy.
Use distinct namespaces for incompatible installations, including when merging
adapter Layers. Password sign-in alone does not acquire registration, recovery,
or new-password services.

Optional database, platform, browser, and OAuth adapters have separate exports.
The root import does not load their peer dependencies. Internal code imports owning
modules directly; Oxlint checks public indexes and rejects internal barrels and
package self-imports.

The HTTP adapter supplies `AuthRequest`. A custom or native host provides its
trusted invocation, private incoming `credentials` by slot, and credential delivery
sink for each workflow. Keep this context outside shared Layers. Public results never include credential commands. Password sign-in
creates a fresh flow on each execution; commands whose IDs support replay still
require the caller's original ID. No call automatically retries a mutation.

`effect-auth/Operations` owns validated local invocation and shared RPC handler
boundaries. Caller identity is trusted application input supplied per invocation,
never part of an operation payload. Applications explicitly select remotely
exposed operations; an RPC definition alone does not expose an endpoint.

`effect-auth/Identity` owns application-neutral identity lifecycle contracts.
Consumers retain their native keys, schema, and provisioning authority. An
adapter must enforce uniqueness, last-method protection, and cleanup atomically
or return an explicit pending recovery outcome. Key codecs reject lossy mappings.
The identity examples demonstrate independent UUID and numeric-key consumers.

`effect-auth/Hooks` owns ordered lifecycle contributions and commit event
coordination. The consumer's actual transaction or batch owner controls when
events become committed. Direct postcommit delivery is best effort; durable
delivery requires an outbox in that same authority and consumer-owned retries.
Plugins use ordinary operation and service Layers, with static metadata only
for contributions that need aggregation.

Production OAuth adapters must encrypt tokens at rest and keep token values
out of logs, errors, and telemetry. In-memory stores are for development only.

`effect-auth/OAuth` also provides guest sign-in for existing application
identities through `OAuth.make`. Identity selection uses the complete
provider, issuer and subject tuple; profile fields and email never authorize
selection or provisioning. Its base layer requires no registration, linking or
connected-token storage. Existing OAuth connection workflows remain independent.

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

Browser adapters must inject the initiating client's binder from private storage,
reject body or URL overrides, and enforce same-origin CSRF protection. Before
parsing callbacks, bound their raw size and reject duplicate fields. The generic
RPC resolver does not supply this predecode boundary. Native callers may retain
explicit binders in keyed secure storage; the standard browser binding slot
supports one flow at a time. Only an explicitly configured callback and approved
return target may participate; the core does not redirect or install a provider.

Public exports live in [src/index.ts](src/index.ts).

`effect-auth/Sessions` preserves consumer claim codecs and keeps credential
commands outside public operation results. A per-call collector accepts those
commands; the outer HTTP or native workflow owns cookie or secure-store
persistence. Never put bearer credentials or private commands in RPC success
schemas, logs, or lifecycle events.

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

The password-method example uses real hashing and signed sessions with an
explicit disposable sequential storage model, local screening and fake delivery
and factor verifiers. It rejects ambient transactions. It demonstrates the
method contract, not production database atomicity, distributed budgets, or a
production MFA implementation; maintained driver mappings must enforce those
contracts before the methods are mounted in a real application.

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

Session inspection is an internal method capability authenticated by the private
bearer. It returns the original evidence and an issued-credential version distinct
from storage CAS revisions. Public verification, lists and RPC responses exclude
those private fields. Stateful mappings must explicitly persist them and rotate
the credential version while retaining provenance and the original authentication
and absolute-expiry horizons. Old records/envelopes are not inferred or upgraded.
Signed envelope v2 authenticates provenance but does not encrypt it; a bearer
holder can decode that metadata. Choose an explicit confidential token strategy
when credential metadata must also be hidden from the bearer holder.

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

The optional `effect-auth/Passkey` core separates sign-in, registration,
enrollment, management, pending login, step-up and protected-action capabilities.
Applications explicitly provide `PasskeyProtocol`, persistence and account
authority. The maintained verifier is available through the server-only
`PasskeySimpleWebAuthn` entrypoint. Shared contract imports never install it.
Browser interaction and database adapters remain separate.
`effect-auth/PasskeyPassword` binds separate assertion payloads to existing
prepared password intents. Reset validates the original continuation before
spending the passkey, and the password owner repeats its final checks.

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

`PhoneOtp` supports phone-only registration, verification, sign-in and authenticated
change. Consumers own numeric or custom account IDs, country eligibility, sender,
spend policy and trusted per-request network identity. Native custody tombstones
prevent a recycled number from silently acquiring a previous account. SMS carries
neither user-verification nor phishing-resistance assurance. The runnable
[phone consumer](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/phone-sqlite-bun.ts) uses a controlled sender and pure
stateless sessions without a session table; its migrations belong to the consumer.

`Totp` owns encrypted enrollment, confirmation, replay/attempt policy and single-use
recovery. Consumers provide encryption keys, current factor requirements and fresh
action evidence; retain old decryption keys through outstanding enrollment and
factor lifetimes. Private setup and recovery reveals are finite capabilities,
never ordinary query state. The [Studio consumer](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-consumer.ts)
combines passkeys and TOTP with UUIDv7 IDs, PostgreSQL timestamps, a registration
hook and stateful sessions. Its [browser workflows](https://github.com/danieljvdm/effect-auth/blob/main/examples/auth/src/studio-browser.ts)
use the same contracts as its HTTP server.

`OperationHttpServer` owns transport security and private credential translation;
applications explicitly configure cookies, origins, CSRF, callbacks and native
exposure. `OperationHttpClient` performs one attempt per call. Ambiguous writes
require a fresh authoritative lookup or a new flow, never an automatic mutation
retry. Pure `AuthContract`, `SessionContract`, `PasskeyContract` and `TotpContract`
imports keep server implementations out of browser bundles.

Public modules support both root namespaces and direct subpaths:

```ts
import { Identity, SessionContract } from "effect-auth";
// The same modules, selected directly:
import * as IdentityModule from "effect-auth/Identity";
import * as SessionContractModule from "effect-auth/SessionContract";
```

Prefer a direct subpath when bundle size or module-loading cost matters. Named
imports such as `import { stringSubjectId } from "effect-auth/Identity"` let a
bundler discard unrelated identity operations. Root namespaces are convenient,
but retaining a namespace as a value can retain its other exports. Native ESM
loads the root's entire static dependency graph; tree shaking requires a bundler.
Use the contract subpaths above for shared browser/server definitions and import
optional adapters directly, for example `effect-auth/DrizzlePostgres`,
`effect-auth/OpenIdClient`, or `effect-auth/PasskeyBrowser`. Install only the peers
required by the selected adapters. `effect-auth/Testing` remains test-only.

`Atom` owns authentication workflows and their state lifetimes. Mount account
atoms in the current subject registry. Authentication completion and subject
replacement settle together, disposing the previous registry before publishing
the next. Device acquisition remains cancellable; admitted credential responses
settle before cancellation can publish a different subject. React only renders
and dispatches these atoms.
