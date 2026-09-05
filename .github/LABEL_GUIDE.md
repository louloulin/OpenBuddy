# Label Guide

**English** · [简体中文](LABEL_GUIDE.zh-CN.md)

### Type labels (apply to one)

| Label | Color | Meaning | Auto-applied? |
|---|---|---|---|
| `bug` | `#d73a4a` | Something is broken | no |
| `enhancement` | `#a2eeef` | New feature or improvement | no |
| `documentation` | `#0075ca` | Docs only (no code change) | no |
| `tests` | `#bfdadc` | Adds or fixes tests | no |
| `performance` | `#fbca04` | Performance improvement | no |
| `security` | `#b60205` | Security-related | no |
| `ui` | `#e99695` | UI / visual change | no |
| `a11y` | `#5319e7` | Accessibility | no |
| `i18n` | `#1d76db` | Translation / localization | no |
| `ci` | `#0e8a16` | CI / build / tooling | no |
| `plugin` | `#c2e0c6` | New capability package | no |
| `eval` | `#d4c5f9` | Eval / benchmark / research | no |
| `refactor` | `#cccccc` | Code restructuring | no |
| `chore` | `#eeeeee` | Tooling / deps / config | no |

### Area labels (apply to many)

| Label | Color | Meaning |
|---|---|---|
| `area: renderer` | `#7057ff` | `src/` changes |
| `area: main` | `#7057ff` | `electron/main/` changes |
| `area: preload` | `#7057ff` | `electron/preload/` changes |
| `area: ipc` | `#7057ff` | New or changed IPC channel |
| `area: storage` | `#7057ff` | `@openbuddy/runtime-storage` |
| `area: cordis` | `#7057ff` | `@openbuddy/runtime-cordis` |
| `area: auth` | `#7057ff` | `@openbuddy/auth-*` |
| `area: agent` | `#7057ff` | Pi agent runtime |
| `area: ui-shell` | `#7057ff` | `@openbuddy/ui-shell` |
| `area: ui-sidebar` | `#7057ff` | `@openbuddy/ui-sidebar` |
| `area: ui-settings` | `#7057ff` | `@openbuddy/ui-settings` |
| `area: ui-workbench` | `#7057ff` | `@openbuddy/ui-workbench` |
| `area: capability` | `#7057ff` | `@openbuddy/capability-*` |
| `area: collab` | `#7057ff` | `@openbuddy/collaboration-*` |
| `area: enterprise` | `#7057ff` | `@openbuddy/payment`, `saml`, `scim`, `webhook-outbox` |
| `area: admin-portal` | `#7057ff` | `apps/admin-portal/` |
| `area: docs` | `#7057ff` | `docs/` |

### Priority labels (apply to one)

| Label | Color | Meaning |
|---|---|---|
| `priority: critical` | `#b60205` | Drop everything, ship ASAP |
| `priority: high` | `#d93f0b` | Next sprint |
| `priority: medium` | `#fbca04` | This quarter |
| `priority: low` | `#0e8a16` | When we get to it |

### Status labels (auto-applied by bots)

| Label | Color | Meaning |
|---|---|---|
| `status: needs-triage` | `#ededed` | Awaiting maintainer review |
| `status: needs-info` | `#fef2c0` | Awaiting author response |
| `status: needs-design` | `#d4c5f9` | Awaiting design discussion |
| `status: needs-repro` | `#f9c513` | Awaiting reproduction |
| `status: blocked` | `#b60205` | Cannot proceed (link blocker) |
| `status: in-progress` | `#0e8a16` | PR or branch linked |
| `status: review` | `#1d76db` | Under code review |
| `status: ready-to-merge` | `#0e8a16` | All checks green, awaiting merge |
| `status: stale` | `#cccccc` | No activity for 60+ days |

### Workflow labels

| Label | Color | Meaning |
|---|---|---|
| `good first issue` | `#7057ff` | Beginner-friendly, mentor available |
| `help wanted` | `#008672` | Extra attention needed |
| `rfc:` | `#d4c5f9` | Request for Comments (≥7-day debate) |
| `roadmap:` | `#d4c5f9` | Affects public roadmap |
| `breaking` | `#b60205` | Breaking change (semver-major) |
| `duplicate` | `#cccccc` | Closes another issue |
| `wontfix` | `#ffffff` | Will not be implemented |

### Locale labels

| Label | Color | Meaning |
|---|---|---|
| `locale: en` | `#1d76db` | English |
| `locale: zh-CN` | `#1d76db` | 简体中文 |
| `locale: ja` | `#1d76db` | 日本語 |
| `locale: ko` | `#1d76db` | 한국어 |
| `locale: es` | `#1d76db` | Español |
| `locale: de` | `#1d76db` | Deutsch |
| `locale: fr` | `#1d76db` | Français |

### How to label

- **Filing an issue?** Add one `type:` label and any applicable `area:` labels.
- **Reviewing a PR?** Apply `status: review` when you start, `status: ready-to-merge` when approved.
- **Triage?** Apply `status: needs-triage` first, then refine after investigation.

### Labeling bot

A bot auto-applies `status: stale` after 60 days of inactivity, and `status: needs-triage` to new issues from non-maintainers. Configuration in `.github/stale.yml`.
