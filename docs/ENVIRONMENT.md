# Environment Variables

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

Every environment variable OpenBuddy recognizes. Set these in your shell, in `.env`, in CI secrets, or via the OS service manager.

> **Note**: OpenBuddy auto-loads `.env` from the project root (development) and from the user's data directory (production). Variables set in the shell take precedence over `.env`.

---

<a id="english"></a>
## 🇬🇧 English

### Application

| Variable | Default | Purpose |
|---|---|---|
| `OPENBUDDY_DATA_DIR` | OS default | Override the user data directory |
| `OPENBUDDY_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `OPENBUDDY_LOG_FILE` | unset | Path to write logs (in addition to stdout) |
| `OPENBUDDY_TELEMETRY` | `off` | `off` (we never collect telemetry) |
| `OPENBUDDY_DEV` | `false` | Enable dev-mode flags (verbose logging, devtools) |
| `OPENBUDDY_DISABLE_GPU` | `false` | Disable GPU acceleration (troubleshooting) |
| `OPENBUDDY_PORT` | `5173` | Vite dev server port |
| `OPENBUDDY_ELECTRON_PORT` | `9229` | Electron DevTools port |
| `OPENBUDDY_NO_AUTO_UPDATE` | `false` | Disable auto-update checks |
| `OPENBUDDY_UPDATE_CHANNEL` | `latest` | `latest` / `beta` / `nightly` |

### Provider credentials

These are **alternatives** to using the Settings UI (which uses the OS keychain). Use only for CI / headless / test setups.

| Variable | Provider | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | Claude API key |
| `ANTHROPIC_BASE_URL` | Anthropic | Override base URL (for proxies) |
| `OPENAI_API_KEY` | OpenAI | GPT API key |
| `OPENAI_BASE_URL` | OpenAI | Override base URL |
| `OPENAI_ORG_ID` | OpenAI | Organization ID |
| `NEWAPI_BASE_URL` | NewAPI | Self-hosted instance URL |
| `NEWAPI_USER_KEY` | NewAPI (BYOK) | User's `sk-…` key |
| `NEWAPI_SERVICE_TOKEN` | NewAPI (Service Token) | Server-side token |

### Casdoor (OIDC)

| Variable | Purpose |
|---|---|
| `CASDOOR_ENDPOINT` | Casdoor instance URL (e.g. `https://casdoor.your-domain.com`) |
| `CASDOOR_CLIENT_ID` | OIDC application client ID |
| `CASDOOR_CLIENT_SECRET` | OIDC application client secret (desktop only; mobile uses PKCE) |
| `CASDOOR_REDIRECT_URI` | OAuth callback URI (e.g. `casdoor://oauth/callback`) |
| `CASDOOR_AUDIENCE` | Token audience claim |
| `CASDOOR_SCOPE` | OAuth scopes (default `openid profile email`) |
| `CASDOOR_CERT` | PEM-encoded IdP signing certificate (for token verification) |
| `CASDOOR_ORG` | Default organization for login |

### NewAPI gateway

| Variable | Purpose |
|---|---|
| `NEWAPI_ADMIN_TOKEN` | Admin token (for channel management) |
| `NEWAPI_USER_ID` | Default user ID for the session |
| `NEWAPI_CHANNEL_PRIORITY` | Comma-separated channel priority list |

### Storage

| Variable | Default | Purpose |
|---|---|---|
| `OPENBUDDY_STORAGE_BACKEND` | `sqlite` | `sqlite` / `memory` |
| `OPENBUDDY_STORAGE_PATH` | OS default | Override storage directory |
| `OPENBUDDY_AUDIT_HASH` | `sha256` | Hash algorithm for the audit ledger |
| `OPENBUDDY_AUDIT_RETENTION_DAYS` | `90` | Auto-prune audit entries older than N days |

### Plugin host

| Variable | Purpose |
|---|---|
| `OPENBUDDY_PLUGIN_DIR` | Override the plugin directory |
| `OPENBUDDY_PLUGIN_AUTOLOAD` | `true` / `false` — auto-load plugins on startup |
| `OPENBUDDY_PLUGIN_HOT_RELOAD` | `true` / `false` — hot-reload plugin changes |

### MCP

| Variable | Purpose |
|---|---|
| `OPENBUDDY_MCP_TIMEOUT_MS` | Default `30000` |
| `OPENBUDDY_MCP_MAX_CONNECTIONS` | Default `10` |
| `OPENBUDDY_MCP_LOG_LEVEL` | `info` / `debug` / `warn` / `error` |

### Network

| Variable | Default | Purpose |
|---|---|---|
| `OPENBUDDY_HTTP_PROXY` | unset | HTTP proxy URL (applied to all outbound requests) |
| `OPENBUDDY_HTTPS_PROXY` | unset | HTTPS proxy URL |
| `OPENBUDDY_NO_PROXY` | unset | Comma-separated list of hosts to bypass the proxy |
| `OPENBUDDY_TLS_CA_BUNDLE` | unset | Custom CA bundle path |
| `OPENBUDDY_DNS_OVER_HTTPS` | unset | DoH endpoint |

### Internationalization

| Variable | Purpose |
|---|---|
| `OPENBUDDY_LOCALE` | Force a specific locale (e.g. `zh-CN`, `en`) |
| `OPENBUDDY_FALLBACK_LOCALE` | Default `en` — fallback when a translation is missing |

### Testing & evaluation

| Variable | Default | Purpose |
|---|---|---|
| `OPENBUDDY_EVAL_FIXTURES` | `evals/fixtures` | Path to evaluation fixtures |
| `OPENBUDDY_EVAL_OUTPUT` | `evidence/` | Where to write eval results |
| `OPENBUDDY_EVAL_PARALLEL` | `4` | Parallel eval worker count |
| `NEWAPI_LIVE_SKIP` | `1` | Skip live NewAPI integration tests (`0` to enable) |
| `CASDOOR_LIVE_SKIP` | `1` | Skip live Casdoor integration tests |

### CI / build

| Variable | Purpose |
|---|---|
| `ELECTRON_MIRROR` | npmmirror mirror for Electron binary download |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | npmmirror mirror for electron-builder-binaries |
| `CSC_LINK` | Code-signing certificate (base64-encoded `.p12`) |
| `CSC_KEY_PASSWORD` | Code-signing certificate password |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

### Example: full `.env` for an enterprise dev

```bash
# .env (do NOT commit — see .gitignore)

# Provider
ANTHROPIC_API_KEY=sk-ant-…
OPENAI_API_KEY=sk-…

# NewAPI
NEWAPI_BASE_URL=https://newapi.your-domain.com
NEWAPI_SERVICE_TOKEN=sk-…

# Casdoor
CASDOOR_ENDPOINT=https://casdoor.your-domain.com
CASDOOR_CLIENT_ID=openbuddy-desktop
CASDOOR_CLIENT_SECRET=…
CASDOOR_REDIRECT_URI=casdoor://oauth/callback
CASDOOR_ORG=acme-corp

# App
OPENBUDDY_LOG_LEVEL=info
OPENBUDDY_DATA_DIR=/var/lib/openbuddy

# Storage
OPENBUDDY_AUDIT_RETENTION_DAYS=365

# CI mirrors (CN networks)
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 应用程序

(同英文)

### Provider 凭据

(同英文)

### Casdoor(OIDC)

(同英文)

### NewAPI 网关

(同英文)

### 存储

(同英文)

### Plugin Host

(同英文)

### MCP

(同英文)

### 网络

(同英文)

### 国际化

(同英文)

### 测试与评测

(同英文)

### CI / 构建

(同英文)

### 示例:企业开发的完整 `.env`

(同英文)

---

<div align="center">

**Document every variable you set. / 每个环境变量都要文档化。**

<sub>Add a new variable? Open a PR editing this file AND mention it in the release notes. / 加新变量?开 PR 改此文件并在发布说明中提及。</sub>

</div>
