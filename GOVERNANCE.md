# Project Governance

**English** · [简体中文](GOVERNANCE.zh-CN.md)

### Roles

OpenBuddy uses a **federated governance model** with four explicit roles. The same person can hold multiple roles; roles are earned through contribution, not assigned.

#### Users

Anyone running OpenBuddy. No obligations, no authority.

#### Contributors

Anyone whose **code or documentation PR is merged**. Contributors:

- Get listed in the GitHub Contributors graph
- Get a 🎉 in their first PR's merge commit
- May be granted `write` access to specific `src/locales/<locale>/` directories after demonstrating sustained translation work
- May be invited to a `contributors` team once the project moves to an organization

#### Reviewers

Contributors who have demonstrated review skills (consistent, constructive feedback over ≥ 3 months and ≥ 10 reviewed PRs). Reviewers:

- Get `@mention` notifications on PRs in their area
- May request changes / approve PRs within their review area
- Are listed in [`MAINTAINERS.md`](MAINTAINERS.md)

#### Maintainers

Long-term contributors with **strategic authority**. Maintainers:

- Have merge rights across the repo
- May cast votes in RFC decisions
- May add or remove reviewers
- Are responsible for releases
- Are listed in [`MAINTAINERS.md`](MAINTAINERS.md)

There is no formal "core team" — every maintainer has the same authority, with informal specialization by area.

### Teams

`louloulin` is currently a personal account, so GitHub teams do not exist yet. The
table below is the **planned** ownership split; the handles become real once the
project moves to an organization. Until then [`.github/CODEOWNERS`](.github/CODEOWNERS)
routes every path to `@louloulin`.

| Team | Purpose |
|---|---|
| `@louloulin/maintainers` | Global merge rights + RFC voting |
| `@louloulin/security` | Security response team (see [`SECURITY.md`](SECURITY.md)) |
| `@louloulin/community` | Community + docs + translations |
| `@louloulin/build` | Build, CI, packaging, infrastructure |
| `@louloulin/runtime` | Cordis runtime, storage, plugin host |
| `@louloulin/main` | Electron main + preload (security-critical) |
| `@louloulin/ui` | Renderer + UI primitives |
| `@louloulin/auth` | Casdoor + permission |
| `@louloulin/agents` | Multi-agent + collaboration packages |
| `@louloulin/capability` | Capability packages |
| `@louloulin/enterprise` | Payment + SAML + SCIM + webhook-outbox + admin portal |
| `@louloulin/eval` | Eval + benchmark + analysis |
| `@louloulin/i18n-<locale>` | Translation maintainers per locale |
| `@louloulin/former-maintainers` | Alumni (emeritus) |

The path-to-area mapping is kept in [`.github/CODEOWNERS`](.github/CODEOWNERS); its
owner column switches from `@louloulin` to the teams above when the org exists.

### Decision-making

#### Day-to-day

- Lazy consensus. A maintainer proposes, contributors respond in 7 days, default = approve.
- Routine changes (bug fixes, docs, refactors) ship without a vote.

#### Major changes (RFC process)

For changes that affect:

- Public API surface (IPC channels, package exports)
- Monorepo structure (DAG, toolchain)
- Licensing
- Release cadence
- Strategic direction
- Security model

Follow the RFC process:

1. **Propose** — open a GitHub Discussion with the `rfc:` label.
2. **Debate** — minimum 7-day public discussion window.
3. **Decide** — a maintainer calls for a vote: 👍 / 👎 / neutral.
4. **Implement** — the assigned maintainer opens PRs, the community reviews.
5. **Ship** — once merged, mark the discussion as "Accepted" or "Rejected".

Voting rules:

- Only current `@louloulin/maintainers` members vote.
- Simple majority wins.
- Voting window: 14 days.
- A maintainer may call a vote to extend the discussion if substantive concerns are raised.

#### Emergencies

For critical security or data-loss issues, a maintainer may ship a patch without an RFC. The change is documented retroactively in a public post within 24 hours.

### Releases

- **Cadence**: every 2–4 weeks, opportunistic.
- **Process**: see [`.github/workflows/release.yml`](.github/workflows/release.yml). Triggered by `workflow_dispatch` with the new tag.
- **Notes**: auto-extracted from [`CHANGELOG.md`](CHANGELOG.md).
- **Promotion**: a release candidate ships to internal users for ≥ 3 days before public release.

### Conflict resolution

1. **Disagree technically?** Discuss in the PR or RFC. Defer to data and benchmarks.
2. **Disagree on direction?** Open a Discussion, not a PR.
3. **Disagree personally?** Escalate to `conduct@openbuddy.dev` per [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
4. **Stuck?** Any two maintainers may call a vote.

A maintainer who persistently violates the code of conduct may be removed by a 2/3 supermajority of other maintainers.

### Adding/removing maintainers

#### Becoming a maintainer

1. Be a reviewer for ≥ 6 months.
2. Have ≥ 30 merged PRs across diverse areas.
3. Be nominated by an existing maintainer.
4. Get 👍 from 2/3 of current maintainers in a public Discussion.
5. Be added to `@louloulin/maintainers` and listed in [`MAINTAINERS.md`](MAINTAINERS.md).

#### Stepping down

Maintainers may step down at any time by filing a PR removing themselves from [`MAINTAINERS.md`](MAINTAINERS.md). They become `@louloulin/former-maintainers`.

#### Inactive removal

A maintainer with no merged PRs, no review activity, and no Discussion participation for 12 consecutive months is moved to `@louloulin/former-maintainers` after a friendly ping.

### Org ownership

The `louloulin` GitHub org is owned by the maintainer team collectively. Org-level admin is held by ≥ 3 maintainers (multi-sig style). No single individual owns the org.

### Inspirations

This governance borrows from:

- [Rust language governance](https://www.rust-lang.org/governance)
- [Node.js project governance](https://nodejs.org/en/about/governance)
- [Python Software Foundation](https://www.python.org/psf/)
- [Mozilla Module Ownership](https://www.mozilla.org/en-US/about/governance/policies/module-ownership/)
