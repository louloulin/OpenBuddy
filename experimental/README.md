# experimental/

Packages that are tested, but **not built into the application**.

Nothing here is imported by any other package, and nothing here is referenced by
a capability registration, a moon project glob, or the root tsconfig project.
They are kept in the repository rather than deleted because they represent real,
unwired feature work — not abandoned experiments.

## What "unwired" means here

Verified for every package below by grepping the whole tree (excluding
`node_modules`, `dist`, and the package's own directory) for:

- any `import`/`require` of `@openbuddy/<name>` — no hits outside the website's
  feature-list copy, which is marketing text, not a dependency;
- any `package.json` that declares it as a dependency — no hits;
- any build/config reference (moon glob, tsconfig `references`, CI matrix) that
  would put it in a compile or bundle — no hits.

## Why they are outside the workspace

`experimental/` is deliberately not listed in `pnpm-workspace.yaml`. That is what
keeps these packages out of:

- `pnpm install` (and therefore out of `pnpm-lock.yaml`),
- moon's `packages/*/*` project glob, so CI does not typecheck them,
- the root `tsconfig.json` project.

Their tests still run: `vitest.config.ts` includes `experimental/**`, so the
code cannot silently rot while it sits here. What the move removes is the
*build and dependency-graph* surface — nothing compiles them into the app, and
no shipped code path can reach them.

Each package keeps its own `moon.yml`, `package.json`, and `tsconfig.json`, so
wiring one up is a matter of moving the directory back under `packages/` and
adding the workspace entry — see the flat-package note in
`pnpm-workspace.yaml` for the glob form that directory needs.

### A pre-existing typecheck caveat

`tsc --noEmit` inside one of these packages reports an unrelated error in
`electron/main/agent/agent-session-search-bridge.ts` (missing
`@openbuddy/host-runtime`). That is not caused by the move: `tsconfig.package-base.json`
declares `include: ["src/**/*"]`, which resolves against the repo root and drags
in `electron/`, where the alias `@openbuddy/host-runtime` is declared only in the
root `tsconfig.json` and not in the package base. It predates this change and was
never surfaced in CI, because these packages had no moon project and so were
never typechecked there.

## Packages

| Package | What it holds |
| --- | --- |
| `payment` | Payment channel adapters (Stripe · WeChat Pay · Alipay · platform-agnostic HMAC) |
| `saml` | SAML 2.0 SSO primitives for enterprise IdP federation |
| `scim` | SCIM v2 endpoints (RFC 7644) for enterprise user/group provisioning |
| `webhook-outbox` | Transactional outbox with durable retry and exponential backoff |
| `bundle-desktop` | Desktop UI bundle composition (depends on the `ui-*` packages) |
