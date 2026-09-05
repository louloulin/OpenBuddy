# OpenBuddy Documentation

> 🌐 **Language:** **English** · [简体中文](README.zh-CN.md)

Welcome to the OpenBuddy documentation index. This directory is the **single source of truth** for everything you need to install, run, extend, and contribute to OpenBuddy.

---

## 🇬🇧 English · Documentation entry point

> 📅 Most recent full verification: **2026-09-05** · 📦 Version: `0.14.0` · 🌿 git HEAD: `a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks`

### 🚀 30-second tour

<p align="center">
  <img src="diagrams/tour-30s.svg" alt="OpenBuddy 30-second tour" />
</p>

### ⚡ Quick links

| I want to… | Read this |
|---|---|
| Run OpenBuddy for the first time | [`GETTING_STARTED.md`](GETTING_STARTED.md) · [`GETTING_STARTED.zh-CN.md`](GETTING_STARTED.zh-CN.md) |
| Understand the codebase | [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`ARCHITECTURE.zh-CN.md`](ARCHITECTURE.zh-CN.md) · [`CODEBASE_ANALYSIS.md`](CODEBASE_ANALYSIS.md) (verified 2026-09-05 inventory) |
| Build a Cordis capability package | [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) |
| Write tests | [`TESTING.md`](TESTING.md) |
| Optimize performance | [`PERFORMANCE.md`](PERFORMANCE.md) |
| Make features accessible | [`ACCESSIBILITY.md`](ACCESSIBILITY.md) |
| Deploy to production | [`OPERATIONS.md`](OPERATIONS.md) |
| Migrate from WorkBuddy | [`WORKBUDDY_MIGRATION.md`](WORKBUDDY_MIGRATION.md) |
| Translate the UI into a new language | [`I18N.md`](I18N.md) |
| Compare OpenBuddy with other AI tools | [`COMPARISON.md`](COMPARISON.md) |
| Get my questions answered | [`FAQ.md`](FAQ.md) · [`FAQ.zh-CN.md`](FAQ.zh-CN.md) |
| Find community channels | [`COMMUNITY.md`](COMMUNITY.md) |
| See real examples & showcase | [`EXAMPLES.md`](EXAMPLES.md) |
| Understand the release process | [`RELEASING.md`](RELEASING.md) |
| Find the security PGP key | [`SECURITY-PGP.md`](SECURITY-PGP.md) |
| Look up a term | [`GLOSSARY.md`](GLOSSARY.md) |
| See all environment variables | [`ENVIRONMENT.md`](ENVIRONMENT.md) |
| See what's coming next | [`ROADMAP.md`](ROADMAP.md) |
| Read our architecture decision history | [`adr/`](adr/) |
| Report a security issue | [`../SECURITY.md`](../SECURITY.md) |
| Get help | [`../SUPPORT.md`](../SUPPORT.md) |
| Contribute | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) · [`../CONTRIBUTING.zh-CN.md`](../CONTRIBUTING.zh-CN.md) |
| Understand project governance | [`../GOVERNANCE.md`](../GOVERNANCE.md) |
| See who's a maintainer | [`../MAINTAINERS.md`](../MAINTAINERS.md) |

---

## 📚 Documentation structure (categorized)

### 🏠 Top-level (start here)

- [`../README.md`](../README.md) · [`../README.zh-CN.md`](../README.zh-CN.md) — main landing page
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) · [`../CONTRIBUTING.zh-CN.md`](../CONTRIBUTING.zh-CN.md) — contributor workflow
- [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — community standards
- [`../SECURITY.md`](../SECURITY.md) — vulnerability disclosure
- [`../SUPPORT.md`](../SUPPORT.md) — getting help
- [`../CHANGELOG.md`](../CHANGELOG.md) — release notes
- [`../LICENSE`](../LICENSE) — MIT license

### 🚀 Getting started

- [`GETTING_STARTED.md`](GETTING_STARTED.md) · [`GETTING_STARTED.zh-CN.md`](GETTING_STARTED.zh-CN.md) — 30-minute developer setup walkthrough
- [`FAQ.md`](FAQ.md) · [`FAQ.zh-CN.md`](FAQ.zh-CN.md) — frequently asked questions
- [`I18N.md`](I18N.md) — translation & localization workflow
- [`COMPARISON.md`](COMPARISON.md) — OpenBuddy vs Cursor / Continue / aider / Copilot

### 🏗️ Architecture & design

- [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`ARCHITECTURE.zh-CN.md`](ARCHITECTURE.zh-CN.md) — layer-by-layer architecture deep dive
- [`adr/`](adr/) — architecture decision records (one per major decision)
- [`openbuddy-product-vs-pi.md`](openbuddy-product-vs-pi.md) — how OpenBuddy extends Pi
- [`pi-core-capabilities.md`](pi-core-capabilities.md) — Pi core capabilities
- [`pi-extension-architecture.md`](pi-extension-architecture.md) — Pi extension points
- [`pi-capability-gap-analysis.md`](pi-capability-gap-analysis.md) — gaps we filled
- [`pi-analysis-critique.md`](pi-analysis-critique.md) — critique of Pi's analysis
- [`pi-runtime-next-roadmap.md`](pi-runtime-next-roadmap.md) — Pi runtime roadmap
- [`pi-real-plugin-compatibility.md`](pi-real-plugin-compatibility.md) — Pi plugin compatibility
- [`pi-sdk-implementation-plan.md`](pi-sdk-implementation-plan.md) — SDK implementation plan
- [`expert-team-design.md`](expert-team-design.md) — expert team design
- [`menu-architecture-audit.md`](menu-architecture-audit.md) — menu architecture audit

### 🧩 Capabilities & plugins

- [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) — build your first Cordis capability
- [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md) — package-by-package capability list
- [`openbuddy-plugin-architecture.md`](openbuddy-plugin-architecture.md) — plugin architecture
- [`openbuddy-plugin-catalog.md`](openbuddy-plugin-catalog.md) — plugin catalog
- [`openbuddy-module-overlap-analysis.md`](openbuddy-module-overlap-analysis.md) — module overlap analysis
- [`full-pluginization-plan.md`](full-pluginization-plan.md) — full pluginization plan

### ⚔️ WorkBuddy parity

- [`workbuddy-parity-matrix.md`](workbuddy-parity-matrix.md) — OpenBuddy vs WorkBuddy parity matrix
- [`workbuddy-points-system-comparison.md`](workbuddy-points-system-comparison.md) — points system comparison

### 🔄 Migration history

- [`migration-pi-electron.md`](migration-pi-electron.md) — Pi → Electron migration notes
- [`moon-monorepo-refactor.md`](moon-monorepo-refactor.md) — moon monorepo refactor
- [`deepseek-cordis-runtime-status.md`](deepseek-cordis-runtime-status.md) — DeepSeek Cordis runtime status
- [`dsh-version-compatibility-matrix.md`](dsh-version-compatibility-matrix.md) — DSH version compatibility

### 🏢 Enterprise & commercial

- [`casdoor-enterprise-auth.md`](casdoor-enterprise-auth.md) — Casdoor enterprise auth
- [`casdoor-integration-matrix-v2.md`](casdoor-integration-matrix-v2.md) — Casdoor integration matrix v2
- [`casdoor-new-api-openbuddy-commercial-architecture.md`](casdoor-new-api-openbuddy-commercial-architecture.md) — commercial architecture
- [`casdoor-newapi-openbuddy-architecture-diagram.md`](casdoor-newapi-openbuddy-architecture-diagram.md) — architecture diagram (text)
- [`new-api-casdoor-openbuddy.md`](new-api-casdoor-openbuddy.md) — NewAPI + Casdoor integration
- [`newapi-integration-guide.md`](newapi-integration-guide.md) — NewAPI integration guide
- [`new-api-channel-capability-matrix.md`](new-api-channel-capability-matrix.md) — NewAPI channel capability matrix
- [`enterprise-casdoor-newapi-openbuddy-architecture.md`](enterprise-casdoor-newapi-openbuddy-architecture.md) — enterprise architecture
- [`enterprise-completion-matrix.md`](enterprise-completion-matrix.md) — enterprise completion matrix
- [`enterprise-live-verification-2026-08-29.md`](enterprise-live-verification-2026-08-29.md) — live verification (08-29)
- [`enterprise-live-verification-2026-08-30.md`](enterprise-live-verification-2026-08-30.md) — live verification (08-30)
- [`enterprise-live-verification-2026-08-31.md`](enterprise-live-verification-2026-08-31.md) — live verification (08-31)
- [`enterprise-live-verification-2026-09-01.md`](enterprise-live-verification-2026-09-01.md) — live verification (09-01)
- [`openbuddy-enterprise-integration-manifest.md`](openbuddy-enterprise-integration-manifest.md) — enterprise integration manifest
- [`openbuddy-token-billing-v2.md`](openbuddy-token-billing-v2.md) — token billing v2
- [`token-billing-and-reconciliation-architecture.md`](token-billing-and-reconciliation-architecture.md) — billing architecture
- [`openbuddy-credit-transfer.md`](openbuddy-credit-transfer.md) — credit transfer

### 🌐 Distributed buddy (multi-agent)

- [`distributed-buddy-network-architecture.md`](distributed-buddy-network-architecture.md) — distributed network architecture
- [`distributed-buddy-product-plan.md`](distributed-buddy-product-plan.md) — distributed product plan
- [`openbuddy-distributed-buddy-vision.md`](openbuddy-distributed-buddy-vision.md) — distributed vision
- [`openbuddy-distributed-buddy-research.md`](openbuddy-distributed-buddy-research.md) — distributed research
- [`openbuddy-distributed-buddy-plugin-and-ui-plan.md`](openbuddy-distributed-buddy-plugin-and-ui-plan.md) — distributed plugin + UI plan
- [`openbuddy-unified-buddy-product-plan.md`](openbuddy-unified-buddy-product-plan.md) — unified buddy plan

### 📧 Email

- [`openbuddy-email-support-plan.md`](openbuddy-email-support-plan.md) — email support plan
- [`openbuddy-email-validation.md`](openbuddy-email-validation.md) — email validation

### 💾 Storage & data

- [`storage-architecture-overview.html`](storage-architecture-overview.html) — storage overview (HTML)
- [`storage-architecture-audit.md`](storage-architecture-audit.md) — storage architecture audit
- [`storage-architecture-audit.html`](storage-architecture-audit.html) — storage audit (HTML)
- [`storage-verification-report.md`](storage-verification-report.md) — storage verification report
- [`build-output-conventions.md`](build-output-conventions.md) — build output conventions

### ⚙️ Operations

- [`release-ci.md`](release-ci.md) — release & CI pipeline
- [`macos-signing.md`](macos-signing.md) — macOS code signing & notarization
- [`deployment-guide.md`](deployment-guide.md) — deployment guide
- [`electron-testing.md`](electron-testing.md) — Electron testing
- [`ai-agent-test-plan.md`](ai-agent-test-plan.md) — AI agent test plan
- [`agent-evaluation-matrix.md`](agent-evaluation-matrix.md) — agent evaluation matrix

### 💼 Commercial model

- [`openbuddy-commercial-model.md`](openbuddy-commercial-model.md) — commercial model
- [`publish-checklist-v0.15.0.md`](publish-checklist-v0.15.0.md) — v0.15.0 publish checklist

### 🌏 Community

- [`COMMUNITY.md`](COMMUNITY.md) — community channels and language communities
- [`ROADMAP.md`](ROADMAP.md) — public roadmap

### 🎨 Diagrams

<p align="center">
  <img src="diagrams/architecture-overview.svg" alt="OpenBuddy end-to-end architecture" width="800" />
</p>
<p align="center">
  <img src="diagrams/capability-matrix.svg" alt="OpenBuddy capability matrix" width="800" />
</p>

- [`diagrams/architecture-overview.svg`](diagrams/architecture-overview.svg) — end-to-end architecture
- [`diagrams/capability-matrix.svg`](diagrams/capability-matrix.svg) — 64-package capability matrix
- [`diagrams/data-flow-end-to-end.svg`](diagrams/data-flow-end-to-end.svg) — data flow (prompt → tool result)
- [`diagrams/workbuddy-parity.svg`](diagrams/workbuddy-parity.svg) — WorkBuddy parity
- [`diagrams/tour-30s.svg`](diagrams/tour-30s.svg) — 30-second tour
- [`diagrams/`](diagrams/) — all system architecture diagrams
- [`casdoor-newapi-openbuddy-architecture-diagram.svg`](casdoor-newapi-openbuddy-architecture-diagram.svg) — Casdoor + NewAPI + OpenBuddy architecture
- [`openbuddy-transformation-plan.html`](openbuddy-transformation-plan.html) — transformation plan (HTML)
- [`analysis/`](analysis/) — analysis reports

### 📊 Analysis reports

Internal research, audits, and gap analyses that informed the design.

- [`analysis/codebase-inventory.md`](analysis/codebase-inventory.md) — full file/module inventory (updated 2026-09-01)
- [`analysis/gap-report.md`](analysis/gap-report.md) — feature-gap report vs WorkBuddy / Pi / Continue
- [`analysis/permissions-safety-gap.md`](analysis/permissions-safety-gap.md) — permission model audit
- [`analysis/storage-sync-gap.md`](analysis/storage-sync-gap.md) — storage sync coverage analysis
- [`analysis/eval-evidence-gap.md`](analysis/eval-evidence-gap.md) — eval coverage analysis
- [`analysis/docs-dx-gap.md`](analysis/docs-dx-gap.md) — documentation developer-experience gap
- [`analysis/best-package-design.md`](analysis/best-package-design.md) — package-design patterns review
- [`analysis/ci-release-gap.md`](analysis/ci-release-gap.md) — CI & release pipeline audit
- [`analysis/codex-app-specific-gap.md`](analysis/codex-app-specific-gap.md) — desktop app feature gap
- [`analysis/deploy-commercial-gap.md`](analysis/deploy-commercial-gap.md) — deployment & commercial readiness
- [`analysis/electron-host-security.md`](analysis/electron-host-security.md) — Electron host security audit
- [`analysis/modularization-analysis.md`](analysis/modularization-analysis.md) — modularization scoring
- [`analysis/pi-runtime-gap.md`](analysis/pi-runtime-gap.md) — Pi runtime feature gap
- [`analysis/provider-auth-gap.md`](analysis/provider-auth-gap.md) — provider auth coverage
- [`analysis/renderer-workbuddy-parity.md`](analysis/renderer-workbuddy-parity.md) — renderer UI parity matrix
- [`analysis/skills-plugin-mcp-gap.md`](analysis/skills-plugin-mcp-gap.md) — skills / plugins / MCP analysis

### 📜 Architecture Decision Records (ADRs)

See [`adr/`](adr/) for our full architecture decision history.

---

<div align="center">

**Documentation is a feature, not a chore.**

<sub>Found a doc that's out of date or wrong? File an [issue](https://github.com/louloulin/OpenBuddy/issues/new?labels=docs).</sub>

</div>
