# OpenBuddy Privacy Policy

> **DRAFT — pending formal legal review.**
>
> This document describes the data behavior implemented by the OpenBuddy desktop
> client (`com.openbuddy.desktop`, currently v0.15.0). It is written from the
> shipped code paths so that engineering and legal review start from the same
> facts. The DRAFT banner is removed only after formal legal sign-off.
> Last reviewed against the code: 2026-09-22.

## 1. Scope and summary

OpenBuddy is a desktop AI workspace. It runs on your machine, keeps its state on
your machine, and talks only to services **you configure**. There is no
OpenBuddy-hosted backend that receives your workspace content: conversations,
files, audit events, and telemetry stay local unless you explicitly point a
feature at an external endpoint.

| Data | Where it lives | Leaves the machine? |
| --- | --- | --- |
| Conversations, sessions, workspace files | Local app data / your filesystem | Only to the AI provider you configure |
| Audit trail | `~/.openbuddy/audit.jsonl` | No |
| Provider credentials / session tokens | Local, OS-encrypted where available | Only to the service that issued them |
| Telemetry events | Memory, plus an OTLP endpoint if you set one | No, unless you set an OTLP endpoint |
| Plugin / marketplace metadata | Local | Only when you query a marketplace source |

## 2. Data handling

### 2.1 Local-first storage

- Application state (window state, Chromium caches, local storage) lives in the
  Electron user-data directory: `%APPDATA%\OpenBuddy` on Windows,
  `~/Library/Application Support/OpenBuddy` on macOS, `~/.config/OpenBuddy` on
  Linux.
- Agent state, sessions, MCP configuration, and imported experts live under
  `~/.openbuddy/` — for example `~/.openbuddy/agent/mcp.json` and
  `~/.openbuddy/agent/openbuddy-events.jsonl`.
- The audit trail is an append-only JSONL file at `~/.openbuddy/audit.jsonl`
  (`electron/main/audit/audit-log.ts`). Settings → Local Audit Trail can search,
  export (JSONL or JSON), and clear it; clearing deletes the local data.
- Uninstalling the application does **not** delete these directories. Remove them
  manually for a full wipe.

### 2.2 Platform "required-reason" APIs

macOS requires apps that use certain APIs to declare the category and the reason.
OpenBuddy's `Info.plist` declares the five categories below, all with the "same
app, per documentation" reason code, and **none of the data read through them
leaves the machine** (`electron-builder.yml` → `mac.extendInfo.NSPrivacyAccessedAPI`):

| API category | Reason code | Why OpenBuddy touches it |
| --- | --- | --- |
| `NSPrivacyAccessedAPICategoryUserDefaults` | CA92 | Electron/Chromium stores its own preferences |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | C617 | Runtime reads file timestamps when listing files |
| `NSPrivacyAccessedAPICategorySystemBootTime` | 35AB | Chromium runtime timing primitives |
| `NSPrivacyAccessedAPICategoryDiskSpace` | E174 | Pre-flight checks before writes and local builds |
| `NSPrivacyAccessedAPICategoryActiveNetwork` | E523 | Checking whether the network is reachable before a request |

### 2.3 Credentials

- Provider credentials and sign-in tokens are stored locally. Session tokens are
  encrypted with Electron `safeStorage` (OS keychain / DPAPI backed) before they
  are written to disk (`electron/main/casdoor/casdoor-auth.ts`).
- Credentials are used only to call the provider or gateway you configured them
  for. OpenBuddy does not proxy them through a vendor-operated service.

### 2.4 Network egress

OpenBuddy opens network connections only for:

1. The AI provider(s) and gateways you configure (your own API key and endpoint).
2. Marketplace / package sources you explicitly query (for example `pi.dev`).
3. Your OTLP collector — only when `openbuddy.otlp.endpoint` is set.
4. Update checks against the release host configured for the desktop build.

## 3. Telemetry and audit

Audit and telemetry are local-first by design; see
`docs/AUDIT_AND_TELEMETRY.md` for the full contract.

| Layer | Storage | Scope | Uploaded? |
| --- | --- | --- | --- |
| L1 — user audit | `~/.openbuddy/audit.jsonl` | Settings opened, sign-in, plugin installs, key file operations | No |
| L2 — Pi extension policy reports | In-memory | allowed / denied / needs-review counts | No |
| L3 — telemetry | In-memory + optional OTLP | event name, level, attributes | Only if you set an OTLP endpoint |

With no OTLP endpoint configured, telemetry events are delivered to a console
provider only — they never leave the process.

## 4. Retention and deletion

- Local files persist until you delete them; the app ships no background
  retention job.
- Settings → Local Audit Trail → Clear removes the local audit data.
- Deleting the app data directories in §2.1 (`~/.openbuddy/`,
  `%APPDATA%\OpenBuddy`) removes the rest.
- Data already sent to an AI provider or gateway you configured is governed by
  that provider's own retention policy, not by OpenBuddy.

## 5. Third-party services

OpenBuddy ships no analytics SDK and no advertising SDK. The only third parties
that can receive data are the ones you connect: your AI provider/gateway, a
marketplace source you query, an OTLP collector you configure, and the release
host used for update checks. Plugin and MCP servers are third-party code you
install; review their own policies.

## 6. Changes and contact

- Material changes to this policy are recorded in `CHANGELOG.md` and ship with a
  new application version.
- Questions or data requests: open an issue at
  <https://github.com/louloulin/OpenBuddy/issues>, or use the security contact in
  `SECURITY.md` for anything sensitive.

## 7. 中文摘要

OpenBuddy 是本地优先的桌面 AI 工作台：会话、文件、审计与遥测数据默认只保存在本机
（`~/.openbuddy/`、应用数据目录），不会上传到任何 OpenBuddy 自有后端。审计记录
（`~/.openbuddy/audit.jsonl`）可在「设置 → 本地审计追踪」中查看、导出与清空；遥测默认
只输出到本地控制台，只有显式设置 `openbuddy.otlp.endpoint` 才会外发。凭据使用
Electron `safeStorage`（系统钥匙串/DPAPI）加密后落地，仅用于调用你自行配置的服务商。
唯一的外发目标是：你配置的 AI 服务商/网关、你主动查询的插件市场源、你设置的 OTLP
端点，以及桌面版的更新检查地址。本文件为**待法务评审的草案**。
