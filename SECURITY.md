# Security Policy

**English** · [简体中文](SECURITY.zh-CN.md)

### Supported Versions

We release security patches for the **latest minor release** and the previous minor release. Older versions receive best-effort fixes only.

| Version | Supported |
|---|---|
| `0.15.x` (latest) | ✅ |
| `0.14.x` | ✅ |
| `< 0.14` | ❌ |

### Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, use one of these private channels:

1. **GitHub Security Advisories** (preferred) — [Report a vulnerability](https://github.com/louloulin/OpenBuddy/security/advisories/new)
2. **Email** — `security@openbuddy.dev` (PGP key in [`docs/SECURITY-PGP.md`](docs/SECURITY-PGP.md))
3. **Discord** — `@security` moderator team (DM only)

When reporting, please include:

- A clear description of the issue and its impact
- Steps to reproduce (proof-of-concept code or screenshot preferred)
- The affected version(s)
- Your name / handle for the acknowledgement list (or "anonymous")

### Response Timeline

| Stage | Target |
|---|---|
| Acknowledgement | within **48h** of receipt |
| Initial assessment | within **5 business days** |
| Patch for critical issues | within **7 days** |
| Patch for high issues | within **30 days** |
| Patch for medium / low | next release cycle |
| Public disclosure | after patch is shipped + 14-day grace |

### Recognition

We run a public thank-you page for security researchers who follow coordinated disclosure. Researchers may opt out at any time.

### Built-in Security Features

OpenBuddy ships with the following protections out of the box:

| Feature | Where | What it does |
|---|---|---|
| **Context isolation** | Electron renderer | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Allowlisted IPC** | `electron/preload/index.ts` | Every channel is explicitly enumerated; no dynamic invocation |
| **Per-folder trust** | `@openbuddy/capability-folder-trust` | User must explicitly grant each folder before file ops |
| **Capability-level policy** | `@openbuddy/capability-authorization` | Each Cordis capability declares required permissions |
| **CSP** | `index.html` | Strict default-src, no inline scripts |
| **OIDC PKCE** | `@openbuddy/auth-casdoor` | Authorization-code-with-PKCE for SSO; no client secrets on desktop |
| **Token rotation** | Casdoor refresh flow | Refresh tokens rotated on each use |
| **Transactional outbox** | `@openbuddy/webhook-outbox` | Webhooks delivered at-least-once with idempotency keys |
| **Local-first audit** | `@openbuddy/runtime-storage` | Every privileged op logged to a tamper-evident local ledger |
| **Dependency scanning** | `.github/workflows/release.yml` | `pnpm audit` runs in CI on every PR |
| **Mirror configuration** | `electron-builder.yml` | electron-builder downloads pinned through npmmirror, not github |

### Threat Model (summary)

**In scope:**

- Renderer escape → main process
- Preload bridge exposure of internal IPC
- Provider SDK key leakage through logs / errors
- Local file system access beyond granted folder
- Casdoor / NewAPI token exfiltration via prompt injection
- MCP connector sandbox escape

**Out of scope:**

- The user themselves (BYOK means the user owns their keys)
- Provider-side security (Anthropic, OpenAI, etc.)
- The Pi coding agent runtime itself (filed upstream)

### Security Hardening Checklist (for self-hosted / enterprise)

- [ ] Enable macOS notarization in CI
- [ ] Sign Windows installers with EV certificate
- [ ] Rotate Casdoor signing keys annually
- [ ] Restrict webhook endpoints to known IPs
- [ ] Enable audit log shipping to SIEM
- [ ] Run `pnpm audit` weekly
- [ ] Subscribe to GitHub Security Advisories
