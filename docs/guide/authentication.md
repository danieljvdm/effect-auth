---
description: Understand application ownership, authentication methods, and private credential delivery.
---

# How it fits together

Effect Auth supplies authentication workflows as Effect services. Your application chooses its identity model, storage, policy, and delivery. Start with [Getting started](./getting-started.md) for a small definition.

| Effect Auth owns                         | Your application supplies                            |
| ---------------------------------------- | ---------------------------------------------------- |
| Method verification and typed operations | Account lookup, provisioning, and claim construction |
| Session and proof contracts              | Storage, keys, and session policy                    |
| Commit and retry boundaries              | A transaction or batch authority                     |
| Private credential commands              | Cookies, secure storage, email, and SMS delivery     |

## Compose authentication methods

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

## Requests and credential delivery

The host supplies `AuthRequest` for each request or native workflow, including
trusted caller identity and private credential delivery. Keep it outside shared
Layers. Public results never include credential commands. Password sign-in
creates a fresh flow on each execution; commands whose IDs support replay still
require the caller's original ID. No call automatically retries a mutation.

## Operations

`effect-auth/Operations` owns validated local invocation and shared RPC handler
boundaries. Caller identity is trusted application input supplied per invocation,
never part of an operation payload. Applications explicitly select remotely
exposed operations; an RPC definition alone does not expose an endpoint.

## Identity

`effect-auth/Identity` owns application-neutral identity lifecycle contracts.
Consumers retain their native keys, schema, and provisioning authority. An
adapter must enforce uniqueness, last-method protection, and cleanup atomically
or return an explicit pending recovery outcome. Key codecs reject lossy mappings.
The identity examples demonstrate independent UUID and numeric-key consumers.

## Lifecycle hooks

`effect-auth/Hooks` owns ordered lifecycle contributions and commit event
coordination. The consumer's actual transaction or batch owner controls when
events become committed. Direct postcommit delivery is best effort; durable
delivery requires an outbox in that same authority and consumer-owned retries.
Plugins use ordinary operation and service Layers, with static metadata only
for contributions that need aggregation.

Authentication resources live in the caller’s `Scope`. See [Sessions](./sessions.md) for commit and invalidation behavior, [HTTP and client state](./http-and-client.md) for transport, and [Adapters](../reference/adapters.md) for persistence requirements.
