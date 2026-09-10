# Repository toolchain

Vite+ is the command authority; Bun is the package manager and script runtime.
The root catalog owns shared versions, and the lockfile is committed. Workspace
manifests use `catalog:` and `workspace:*`. CI installs the frozen lockfile and
uses the same checks as local development.

## Development

Run `vp install`, then `vp run patch:tsgo`. The prepare hook installs `.vite-hooks`;
the pre-commit hook runs Vite+ checks on staged TypeScript and JavaScript.
`vp run ready` is the handoff gate: static checks, tests, package builds, and docs.
Use `vp help` and command help for task options. Include `vp env doctor` output
when investigating toolchain failures.

Shared strict compiler settings live in `tsconfig.base.json`. Public packages
use Effect as a peer and the exact catalog pin for development. Upgrade the
Effect family together and rerun installation and the handoff gate. The
`preferTypedSchemaDecoder` diagnostic follows the reference repository's disabled
setting until the upstream TypeScript-Go panic is resolved.

Library code lives in `packages/*`; public consumer examples are leaf workspaces
under `examples/*`. Internal adapter fixtures belong to the package's `test/fixtures`.
Every workspace and repository script is typechecked. Tests retain their existing
regression coverage; new tests follow the repository's testing policy.

## Public modules

Use explicit, flat source exports with matching `vp pack` entries. Root namespaces
and direct subpaths identify the same public module. Internal imports go directly
to their owning implementation, without routing through self-barrels.

The export check validates casing, namespace targets, build entries, and workspace
dependencies. The purity check rejects production paths that reach test-only code.
`effect-auth/Testing` is an explicit test-only entrypoint. Optional adapters remain
separate exports, and `sideEffects: []` requires import-time code to stay free of I/O.

## Contributor skills

Repository-owned skills under `.agents/skills` have individual `.dev-kit-origin.json`
receipts and are linked from `.claude/skills`. Use the `dev-kit` skill for catalog
updates. Dev Kit is not a runtime dependency or repository lifecycle manager.

## Releases

Changesets maintains the public package's beta release train. Add a changeset for
consumer-visible changes. Do not leave prerelease mode without an explicit release
decision. `release:publish` builds and temporarily converts source manifests to
npm-ready exports and resolves catalog/workspace ranges, then restores the original
files on success, failure, or interruption.

Before enabling automated releases:

1. Give the release GitHub App contents and pull-request write access to this repo.
2. Configure `EFFECT_AUTH_APP_ID` and `EFFECT_AUTH_APP_PRIVATE_KEY` repository secrets.
3. Configure npm trusted publishing for `effect-auth`, repository
   `danieljvdm/effect-auth`, workflow `release.yml`. The first npm publication may
   require a manually authenticated owner before trusted publishing can be set.
4. Set the repository variable `RELEASE_ENABLED=true`.

The release workflow maintains a version PR using the App token so updates trigger
ordinary CI. After merge, it validates unpublished versions with the full ready gate
and publishes to npm with provenance. Initialization alone does not enable publication.

For a manual release, run the handoff gate, `vp run changeset:version`, and
`vp run release:publish --dry-run`. Once authorized, run `vp run release:publish`
and push the generated tags. The dry run does not publish or create tags.

## CI and review

CI runs static checks, tests, and builds in separate jobs with a required `ready`
fan-in on pull requests. Vite Task cache entries are reused only when their inputs
match; Vitest's mutable result cache is disabled.

Optional Effect Agent PR reviews require `PR_REVIEW_ENABLED=true`, the existing
Effect Agent App credentials, and `OPENAI_API_KEY`. Before enabling them, configure
the `pr-review-forks` environment with maintainer approval. Review runs execute
trusted default-branch code and never execute PR-head code with secrets. The
`pr-review` environment handles same-repository and authorized comment reviews.

Docs use the same VitePress theme, typography, and syntax colors as Effect Agent.
`vp run docs:build` checks local links and produces a standalone static site.
Hosting is configured separately when a domain or deployment target is chosen.
