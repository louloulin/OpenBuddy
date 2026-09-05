# OpenBuddy 企业级部署与运维指南

更新时间：2026-08-30

本文是 OpenBuddy + Casdoor + Resource Gateway + New API 端到端生产部署的"作业手册"，
对应 `docs/enterprise-casdoor-newapi-openbuddy-architecture.md` 第 5-8 节的工程落地。
所有命令基于 `docker compose --env-file .env.production` 与 `git pull` 即可重放。

> **适用范围**：自建 Casdoor 实例 + 自建 New API 实例 + Resource Gateway（内置）+ Electron 桌面客户端。
> 不包括 Casdoor 服务端自身的安装（请参考 [casdoor/casdoor](https://github.com/casdoor/casdoor) 官方文档）。
> 也不修改 Casdoor 服务端；Casdoor 负责身份和组织，OpenBuddy 负责产品权限、资源和商业账本。

## 1. 系统组件与端口

| 组件 | 监听端口（容器内/对外） | 数据持久化 | 启动顺序 |
| --- | --- | --- | --- |
| Postgres 16 | 5432 / 仅 internal | `openbuddy-postgres` volume | 1 |
| Resource Gateway | 8787 / 仅 internal | `openbuddy-resource-data` volume | 2 (depends on postgres healthy) |
| Caddy (reverse proxy) | 80 / 443 / 公开 | `openbuddy-caddy-data`, `openbuddy-caddy-config` | 3 (depends on gateway healthy) |
| Casdoor | 8000 / 公开 | Casdoor 自管 | 外部前置 |
| New API | 3000 / 公开 | New API 自管 | 外部前置 |
| OpenBuddy Desktop (Electron) | 本地无端口 | 客户端配置目录 | 用户启动 |

Caddy 自动申请 Let's Encrypt TLS 证书，**只有 Caddy 暴露 80/443** 到宿主机，
Gateway 与 Postgres 仅加入 `openbuddy-net` 内部网络。

## 2. 环境变量完整清单

### 2.1 Gateway 侧（`services/casdoor-resource-gateway/.env.production`）

所有变量都在 `services/casdoor-resource-gateway/src/index.ts` 中读取，下表列出源码中的所有引用。

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `CASDOOR_ISSUER` | ✅ | — | Casdoor issuer URL，必须 HTTPS（开发模式除外），禁止带 query/credential/fragment |
| `CASDOOR_AUDIENCE` | ✅ | 无（生产禁止回退） | OIDC audience 校验；必须填写 Casdoor 应用的实际 client ID，不能使用 `openbuddy`、占位值或示例值 |
| `RESOURCE_GATEWAY_DATA_DIR` | | `/var/lib/openbuddy-resource-gateway` | JSON store 落地目录；postgres/mysql 模式下不使用 |
| `RESOURCE_GATEWAY_MAX_BODY_BYTES` | | 1 MB | 入站请求体上限 |
| `RESOURCE_GATEWAY_MAX_RESOURCES` | | 10000 | 单租户最大资源数 |
| `RESOURCE_GATEWAY_DEFAULT_TENANT_MAX_RESOURCES` | | 100 | 新建租户的默认上限 |
| `RESOURCE_GATEWAY_AUDIT_MAX_BYTES` | | 200 MB | 审计日志滚动阈值 |
| `RESOURCE_GATEWAY_RATE_LIMIT_REQUESTS` | | 120 | 每租户每窗口最大请求数 |
| `RESOURCE_GATEWAY_RATE_LIMIT_WINDOW_MS` | | 60000 | 限流窗口（ms） |
| `RESOURCE_GATEWAY_WEBHOOK_RATE_LIMIT_REQUESTS` | | 60 | Casdoor webhook 每 IP 每窗口最大请求数 |
| `RESOURCE_GATEWAY_WEBHOOK_SECRET` | ✅ | — | Casdoor → Gateway webhook HMAC 密钥（32 字节十六进制） |
| `RESOURCE_GATEWAY_AUTO_WELCOME` | | `false` | 是否允许签名 Casdoor 用户生命周期 webhook 自动编排 Free 欢迎额度 |
| `RESOURCE_GATEWAY_AUTO_WELCOME_ORGANIZATIONS` | | 空（关闭） | 自动欢迎额度的租户白名单，逗号分隔；必须显式配置，不能使用 `*` |
| `RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET` | ✅ | — | 支付渠道 → Gateway 回调验签密钥 |
| `RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET` | ✅生产 | — | New API 对账 Worker → Gateway 的 HMAC-SHA256 密钥；配置后必须发送 `X-OpenBuddy-New-Api-Cost-Signature` |
| `RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET` | ✅ | — | Casdoor backchannel-logout 验签密钥 |
| `RESOURCE_GATEWAY_CASDOOR_PUBLIC_KEY` | | — | 可选 RSA PEM 公钥；启用后对资源 metadata 中的敏感字符串做 RSA-OAEP-SHA256/AES-256-GCM 加密。私钥不得放入 Gateway 或仓库 |
| `RESOURCE_GATEWAY_STORE` | | `memory` | `memory` / `json`（默认） / `postgres` / `mysql` |
| `RESOURCE_GATEWAY_SQL_PREFIX` | | `casdoor_` | SQL 表前缀（postgres/mysql 模式） |
| `POSTGRES_CONNECTION_STRING` | * | — | `RESOURCE_GATEWAY_STORE=postgres` 时必填 |
| `MYSQL_CONNECTION_STRING` | * | — | `RESOURCE_GATEWAY_STORE=mysql` 时必填 |
| `NEW_API_BASE_URL` | ✅ | — | New API 实例地址（不带 query/credential） |
| `NEW_API_TOKEN` | 开发 | — | 单租户开发回退用 New API 专用 token，**只放在 Gateway**，从不发到 UI；生产禁用，必须使用 `NEW_API_GROUP_TOKENS_JSON` |
| `NEW_API_GROUP_TOKENS_JSON` | ✅生产 | — | 生产多租户必填的 Secret JSON 映射，例如 `{"standard":"sk-...","enterprise":"sk-..."}`；每个 Group 使用独立 New API Token |
| `NEW_API_GROUP` | ✅生产 | `default` | 未设置租户级 `newApiGroup` 时使用的默认 Group；生产启动时必须存在于 `NEW_API_GROUP_TOKENS_JSON` |
| `NEW_API_CAPABILITIES_JSON` | ✅生产 | — | 按 Group/模型声明已真实验证的协议和 usage 能力；支持协议必须 `usage=required` 且提供真实 `verifiedAt` 日期，生产启动门禁会拒绝缺失或不完整目录 |
| `NEW_API_CAPABILITY_MAX_AGE_HOURS` | ✅生产 | `24` | 能力目录验证日期的最大年龄；过期、未来日期或非正数会阻止 Gateway 启动，发布前应由能力快照/真实联调刷新 |
| `NEW_API_MODEL` | | — | `deploy-doctor.sh` 可选的模型校验目标；为空时使用 `/v1/models` 返回的第一个模型 |
| `NEW_API_VERIFY_CHAT` | | `0` | `deploy-doctor.sh` 是否执行一次真实 Chat 验证；设为 `1` 才会产生上游调用和费用 |
| `NEW_API_GROUP` | | `default` | New API 用户分组，按组隔离计费 |
| `NEW_API_ALLOW_ESTIMATED_USAGE` | | `0` | 上游没有真实 usage 时是否允许估算结算；生产必须保持 `0` |
| `RESOURCE_GATEWAY_TARGET_GROSS_MARGIN_PERCENT` | | `70` | 商业模型目录的最低目标毛利；模型低于该值时返回 `sellable=false`，不是支付或财务系统的最终结算规则 |
| `RESOURCE_GATEWAY_NEW_API_CIRCUIT_FAILURE_THRESHOLD` | | `5` | 同一 New API Group + 模型连续 5 次 408/429/5xx 或超时后打开熔断；协议不支持不计入熔断 |
| `RESOURCE_GATEWAY_NEW_API_CIRCUIT_OPEN_MS` | | `30000` | 熔断打开保持时间；到期仅允许一个半开探测请求，成功后恢复 |
| `RESOURCE_GATEWAY_AI_REPLAY_MAX_BYTES` | | 10 MB | AI 最终响应可持久化重放的最大 body；超限只保证账本幂等 |
| `RESOURCE_GATEWAY_AI_REQUEST_LEASE_MS` | | 120000 | AI 请求持久化租约；超时后允许其他副本接管 |
| `RESOURCE_GATEWAY_AI_REQUEST_REPLAY_TTL_MS` | | 86400000 | AI 最终响应持久化重放保留时长 |
| `RESOURCE_GATEWAY_SIEM` | | _未配置_ | `syslog` / `webhook` / `csv` 三选一 |
| `RESOURCE_GATEWAY_SIEM_ENDPOINT` | * | — | `webhook` 模式下必填，SIEM ingest URL |
| `RESOURCE_GATEWAY_SIEM_FILE` | * | `{DATA_DIR}/audit-siem.csv` | `csv` 模式下落地路径 |

生成密钥命令：

```bash
# 32 字节随机十六进制（用于 HMAC secret / Postgres 密码）
openssl rand -hex 32

# 32 字节随机 base64（用于 AES-256 数据加密密钥）
openssl rand -base64 32
```

生产启动前建议运行只读预检：

```bash
scripts/preflight-production-config.sh services/casdoor-resource-gateway/.env.production
```

脚本只读取环境文件并输出脱敏 JSON，不连接 Casdoor/New API、不创建资源、不执行支付或模型请求。它会检查 HTTPS、显式 Casdoor audience、Group→Token 映射、已验证 capability 目录和密钥强度；输出 `status=failed` 时不要启动生产 Gateway。

### 2.2 Electron Main 侧（桌面客户端环境变量或 `.env`）

Electron 进程在 `electron/main/casdoor-auth.ts` 的 `readConfig()` 中读取以下环境变量，
**不存储任何 secret**（token 通过 OIDC PKCE 现场换取；refresh token 由系统 keychain 加密保存）。
变量优先级：**进程环境变量 > `~/.openbuddy/openbuddy.json` 持久化文件 > 内置默认值**。
macOS / Linux 上 `~/.openbuddy/` 等同于 `app.getPath("userData")`，Windows 走 `%APPDATA%\openbuddy\`。

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `OPENBUDDY_CASDOOR_ISSUER` | ✅ | `https://casdoor.example.com` | Casdoor issuer URL，必须与 Casdoor 服务端 `CASDOOR_ORIGIN` 对齐 |
| `OPENBUDDY_CASDOOR_CLIENT_ID` | ✅ | `openbuddy-desktop` | Casdoor OAuth client_id（PKCE 模式，desktop app） |
| `OPENBUDDY_CASDOOR_CLIENT_SECRET` | * | — | 仅在使用 client credentials / admin API 时需要；常规 PKCE 登录不需要 |
| `OPENBUDDY_CASDOOR_REDIRECT_URI` | ✅ | `casdoor://localhost/callback` | 必须在 Casdoor Application 中白名单；Electron 当前仅接受这个受保护回调 |
| `OPENBUDDY_CASDOOR_SCOPE` | | `openid profile email phone offline_access` | OIDC scope，建议保留 `offline_access` 以便刷新 token |
| `OPENBUDDY_CASDOOR_SMS_HINT` | | `Verification code` | 登录页"短信登录"按钮显示的文案，对应 Casdoor Provider name |
| `OPENBUDDY_CASDOOR_WECHAT_HINT` | | `Wechat` | 登录页"微信登录"按钮显示的文案，对应 Casdoor Provider name |
| `OPENBUDDY_CASDOOR_MANAGEMENT_URL` | | `{issuer}/` | Casdoor 管理后台地址，用于"打开 Casdoor 管理"菜单跳转 |
| `OPENBUDDY_CASDOOR_ENFORCER_ID` | | — | 启用资源级授权（Casdoor 模型 / 组织 / 资源）时填写，例如 `openbuddy-default` |
| `OPENBUDDY_CASDOOR_RESOURCE_API_URL` | ✅ | — | Gateway 公网地址（与 §2.1 的 `CASDOOR_ISSUER` 区分：这里是 Gateway 不是 Casdoor） |

桌面客户端 env 注入示例（开发模式）：

```bash
# macOS / Linux：写到 ~/.openbuddy/.env，Electron 启动时由 dotenv 加载
cat > ~/.openbuddy/.env <<EOF
OPENBUDDY_CASDOOR_ISSUER=https://casdoor.example.com
OPENBUDDY_CASDOOR_CLIENT_ID=openbuddy-desktop
OPENBUDDY_CASDOOR_REDIRECT_URI=casdoor://localhost/callback
OPENBUDDY_CASDOOR_SCOPE=openid profile email phone offline_access
OPENBUDDY_CASDOOR_RESOURCE_API_URL=https://gateway.example.com
OPENBUDDY_CASDOOR_WECHAT_HINT=wechat-official
OPENBUDDY_CASDOOR_SMS_HINT=alicloud-sms
OPENBUDDY_CASDOOR_MANAGEMENT_URL=https://casdoor.example.com
EOF
```

```powershell
# Windows：写入 %APPDATA%\openbuddy\.env
@'
OPENBUDDY_CASDOOR_ISSUER=https://casdoor.example.com
OPENBUDDY_CASDOOR_CLIENT_ID=openbuddy-desktop
OPENBUDDY_CASDOOR_REDIRECT_URI=casdoor://localhost/callback
OPENBUDDY_CASDOOR_RESOURCE_API_URL=https://gateway.example.com
'@ | Out-File -Encoding utf8 "$env:APPDATA\openbuddy\.env"
```

或者在 CI 打包阶段注入到 `app.asar`：

```yaml
- name: Build desktop
  env:
    OPENBUDDY_CASDOOR_ISSUER: ${{ secrets.CASDOOR_ISSUER }}
    OPENBUDDY_CASDOOR_RESOURCE_API_URL: ${{ secrets.GATEWAY_URL }}
  run: pnpm build
```

`OPENBUDDY_CASDOOR_WECHAT_HINT` 和 `OPENBUDDY_CASDOOR_SMS_HINT` 的值必须与 Casdoor 管理后台
Identity Providers 中配置的 `Name` 字段完全一致（区分大小写），否则登录按钮点击后报
`ProviderNotFound` 错误。详细 Provider 配置见 §6。

### 2.3 Casdoor 侧（不在仓库，由部署方维护）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `CASDOOR_ORIGIN` | ✅ | Casdoor 公网地址，必须与 `CASDOOR_ISSUER` 对齐 |
| `CASDOOR_DB` | ✅ | postgres / mysql / sqlite3 |
| Casdoor Provider 配置 | ✅ | 见第 6 节「微信 / 短信 Provider 配置模板」 |

## 3. 一次性启动

```bash
# 1) 克隆代码
git clone https://git.example.com/openbuddy.git
cd openbuddy

# 2) 进入 Gateway 包
cd services/casdoor-resource-gateway

# 3) 复制环境模板并填写
cp .env.production.example .env.production
$EDITOR .env.production

# 4) 启动
docker compose -f docker-compose.production.yml --env-file .env.production up -d

# 5) 启动前无密钥配置校验
../../scripts/validate-production-compose.sh .env.production

校验会 fail-closed 拒绝缺失或占位的生产变量；`NEW_API_GROUP` 必须存在于 `NEW_API_GROUP_TOKENS_JSON`，Group Token 不能包含 `replace-with`、`placeholder` 或 `example` 占位文本，Token 映射与能力目录必须覆盖完全相同的 Group，支持协议必须使用 `usage=required` 并提供真实 `YYYY-MM-DD` 验证日期，HMAC/数据库密钥至少 32 个字符。该命令只渲染 Compose 配置，不会代替目标服务器部署验收。

Gateway 运行时也执行同等门禁：生产环境的 Casdoor 与 New API 上游必须使用 HTTPS，Group Token 与能力目录必须一致，签名密钥必须达到最小强度。当前目标 New API `http://124.221.146.145:3000` 仅适合只读诊断或开发验证，不能直接作为生产 Gateway 上游。

# 6) 验证
docker compose -f docker-compose.production.yml ps
curl -fsS https://gateway.example.com/healthz
curl -fsS https://gateway.example.com/v1/tenants/built-in/health
```

### 3.1 Remote Docker host deployment

仓库提供 `scripts/deploy-gateway-remote.sh`，默认只做本地生产配置校验和远端 Docker/SSH 预检；不会上传文件或重启服务。远端部署必须显式设置 `DEPLOY_APPLY=1`，并提供已加入服务器授权列表的 SSH 私钥：

```bash
DEPLOY_SSH_HOST=203.0.113.10 \
DEPLOY_SSH_USER=deploy \
DEPLOY_SSH_KEY="$HOME/.ssh/openbuddy-prod" \
DEPLOY_ENV_FILE=/secure/openbuddy/.env.production \
bash scripts/deploy-gateway-remote.sh

DEPLOY_APPLY=1 \
DEPLOY_SSH_HOST=203.0.113.10 \
DEPLOY_SSH_USER=deploy \
DEPLOY_SSH_KEY="$HOME/.ssh/openbuddy-prod" \
DEPLOY_ENV_FILE=/secure/openbuddy/.env.production \
bash scripts/deploy-gateway-remote.sh
```

部署脚本默认将当前 Git 短 SHA 写入远端 `RESOURCE_GATEWAY_VERSION`；也可显式传入 `DEPLOY_VERSION`。该值会持久化在远端环境文件，Gateway `/healthz` 会返回同一版本，便于重启后确认运行代码未漂移。

脚本会排除 `node_modules`、`dist` 和仓库中的环境文件，上传环境文件后设置远端权限 `0600`，执行 Compose 配置校验、构建、启动、容器内 `/readyz` 等待检查，并校验 `/healthz` 返回的版本必须等于本次部署版本；版本不一致时会输出容器状态和最近日志后失败。凭据不会打印，也不会写入 Git。生产仍必须使用 HTTPS 的 Casdoor Issuer、HTTPS 的 New API 地址、真实 Group Token 和已验收的能力目录；当前 `http://124.221.146.145:3000` 只能用于开发/只读诊断，不能直接作为生产上游。

预期输出：两个端点都返回 `200 OK` 且 JSON 中 `ok: true`。

开发联调阶段，如果已经从 New API 管理员会话取得短期 Token，可使用 `scripts/configure-gateway-remote-dev.sh` 将 Casdoor `CASDOOR_AUDIENCE`、Token、经过真实 usage 验证的能力目录和当前 Git 短 SHA 通过 SSH 标准输入原子写入远端 `.env.remote-dev`；也可用 `DEPLOY_VERSION` 显式覆盖版本。脚本不把凭据放入 SSH 命令参数、日志或 Git，远端文件权限为 `0600`。`CASDOOR_AUDIENCE` 必须填写 Casdoor 应用的实际 client ID，不能使用默认的 `openbuddy`，否则 JWT 会因 audience 不匹配返回 `INVALID_TOKEN`。生产环境不要使用该脚本，必须使用 HTTPS、Secret Manager 和 `docker-compose.production.yml`：

```bash
DEPLOY_SSH_HOST=124.221.146.145 \
DEPLOY_SSH_USER=ubuntu \
DEPLOY_SSH_KEY="$HOME/.ssh/openbuddy-prod" \
NEW_API_GROUP=default \
NEW_API_TOKEN="$SHORT_LIVED_NEW_API_TOKEN" \
NEW_API_CAPABILITIES_JSON="$VERIFIED_CAPABILITIES_JSON" \
bash scripts/configure-gateway-remote-dev.sh
```

## 4. Postgres HA 与备份

### 4.1 备份（每日）

推荐使用 `scripts/backup-openbuddy.sh` 一键备份（支持本地 + S3 远端 + 保留策略 + DRY_RUN）：

```bash
# 每日 cron：凌晨 3 点跑一次，保留 14 天
echo "0 3 * * * PGPASSWORD=$(cat /etc/openbuddy/pg.pwd) S3_BUCKET=s3://my-bucket/openbuddy /opt/service/openbuddy/scripts/backup-openbuddy.sh" | sudo crontab -

# 手动 DRY-RUN 验证
DRY_RUN=1 PGPASSWORD=test bash scripts/backup-openbuddy.sh

# 实际备份
PGPASSWORD="$(cat /etc/openbuddy/pg.pwd)" bash scripts/backup-openbuddy.sh
```

### 4.2 恢复

```bash
# 假设恢复时容器未运行
docker compose -f services/casdoor-resource-gateway/docker-compose.production.yml stop resource-gateway

cat /var/backups/openbuddy/20260829.dump | \
  docker compose -f services/casdoor-resource-gateway/docker-compose.production.yml \
  exec -T postgres pg_restore -U openbuddy -d openbuddy --clean --if-exists

docker compose -f services/casdoor-resource-gateway/docker-compose.production.yml start resource-gateway
```

### 4.3 升级到 HA

生产环境建议把 Postgres 换成外部托管（AWS RDS / Aliyun RDS / 自建 Patroni）。
**不要**依赖单一 docker volume 做高可用，磁盘级故障将导致全部账本数据丢失。

迁移步骤：
1. 创建只读副本，验证延迟 < 1s
2. 停止 Gateway → `pg_dump` → 导入托管实例
3. 切换 `POSTGRES_CONNECTION_STRING` 指向托管实例
4. 重启 Gateway，验证 `/healthz`

## 5. SIEM 接入

Gateway 支持三种 SIEM 投递，通过 `RESOURCE_GATEWAY_SIEM` 切换：

### 5.1 syslog（推荐自建 ELK / Loki）

```bash
RESOURCE_GATEWAY_SIEM=syslog
```

容器内 syslog 写入 `/dev/log`，需在 `docker-compose.production.yml` 中追加
`logging` driver：

```yaml
resource-gateway:
  logging:
    driver: syslog
    options:
      tag: openbuddy-gateway
      syslog-address: tcp://siem.example.com:514
```

### 5.2 webhook（推荐 SaaS SIEM）

```bash
RESOURCE_GATEWAY_SIEM=webhook
RESOURCE_GATEWAY_SIEM_ENDPOINT=https://siem.example.com/audit-ingest
RESOURCE_GATEWAY_SIEM_AUTH=Bearer xxxxxx   # 可选：附加鉴权头
```

每条审计事件 POST 一份 JSON，gateway 自带重试（指数退避，3 次）。

### 5.2.1 Casdoor 生命周期与 Free 欢迎额度

Casdoor 的 Webhook 在 Casdoor 管理面配置为 POST 到
`/v1/webhooks/casdoor`，使用与 `RESOURCE_GATEWAY_WEBHOOK_SECRET` 对应的
HMAC-SHA256 签名。Gateway 同时兼容 Casdoor 原生 Record payload（通常包含
`organization`、`user`、`action`、`object`）和测试/编排 payload（`type`、`action`、
`organization`、`user`）。

只有在完成租户映射、反滥用评审并配置明确白名单后才启用自动发放：

```bash
RESOURCE_GATEWAY_AUTO_WELCOME=true
RESOURCE_GATEWAY_AUTO_WELCOME_ORGANIZATIONS=acme,contoso
```

自动发放只读取当前激活且价格为零的 `free` 套餐，不接受 webhook 传入金额或有效期；
幂等键由 `tenantId + subject` 派生。普通注册路径不应由 Electron renderer 调用
`/credits/welcome`，邀请成员是否获得额度也必须单独制定策略。若不满足这些条件，
保持 `RESOURCE_GATEWAY_AUTO_WELCOME=false`，由受信任的注册编排服务显式调用
`/credits/welcome`。

### 5.3 csv（应急 / 调试）

```bash
RESOURCE_GATEWAY_SIEM=csv
RESOURCE_GATEWAY_SIEM_FILE=/var/lib/openbuddy-resource-gateway/audit-siem.csv
```

落地 CSV 在 `openbuddy-resource-data` volume 中，可用 `tail -f` 实时观察。
**生产严禁长期使用 csv**，它缺少脱敏和告警能力。

### 5.4 审计事件结构

每个事件包含：

```json
{
  "id": "evt_20260830_xxx",
  "at": "2026-08-30T12:00:00.000Z",
  "tenantId": "built-in",
  "subject": "admin",
  "resource": "tenant.policy",
  "action": "update",
  "outcome": "success",
  "traceparent": "00-...-...",
  "details": { "policyVersion": 4, "killSwitch": false }
}
```

## 6. 微信 / 短信 Provider 配置模板

> 这一节是配置模板，**不修改 Casdoor 服务端代码**。部署方在 Casdoor 管理后台
> （`https://casdoor.example.com`）按下面模板填入即可。

### 6.0 模板与导入脚本

[`docs/casdoor-providers/`](../casdoor-providers/) 提供 7 个常用 Provider 的 JSON 模板：
微信开放平台 / 微信公众号 / 阿里云短信 / 腾讯云短信 / GitHub / Google / 邮箱验证码。
[`scripts/import-casdoor-providers.sh`](../../scripts/import-casdoor-providers.sh) 用 Casdoor admin
API 一键批量导入，并支持 `DRY_RUN=1` 干跑和 `STRICT=1` 拒绝占位符未替换的模板。

### 6.1 微信 OAuth（开放平台）

登录 Casdoor 管理后台 → Identity Providers → Add → WeChat：

| 字段 | 值 |
| --- | --- |
| `Name` | `wechat-official`（公众号）或 `wechat-open`（开放平台网页应用） |
| `Client ID` | 微信开放平台 `AppID` |
| `Client Secret` | 微信开放平台 `AppSecret` |
| `Redirect URL` | `https://casdoor.example.com/callback/wechat-official` |
| `Scope` | `snsapi_login`（网页应用）或 `snsapi_userinfo`（公众号） |
| `Endpoint` | `https://open.weixin.qq.com/connect/oauth2/authorize` |
| `Token endpoint` | `https://api.weixin.qq.com/sns/oauth2/access_token` |
| `User info endpoint` | `https://api.weixin.qq.com/sns/userinfo` |
| `User ID field` | `openid`（公众号）或 `unionid`（开放平台） |

把 Provider 绑定到 Application → OpenBuddy → Signin methods 勾选 WeChat 即可。

### 6.2 短信 Provider（阿里云 / 腾讯云）

Casdoor 默认支持阿里云 / 腾讯云 SMS（参见 [casdoor/casdoor#providers](https://casdoor.ai/zh/docs/provider/overview/)）。
部署方需先在短信平台申请签名 + 模板，并把 `AccessKey` / `SecretKey` 填入 Casdoor Provider。

### 6.3 桌面客户端引导

OpenBuddy 登录页（`AccountSettingsPanel`）会自动通过 `casdoor:login { provider: "wechat" }`
调用对应 Provider；只要 Casdoor 端配置完成，前端零改动即可上线。

## 7. New API 集成要点

New API 负责：

1. 模型路由（OpenAI / Anthropic / 自定义）
2. 真实计费（按 token 计费扣减用户余额）
3. 用户余额管理

Resource Gateway 负责：

1. 把 OpenBuddy 客户端调用转发到 New API
2. 按 `parseUsage` 自行维护积分账本（Credits Service）
3. 实时按 `creditPricing` 算积分，按 `upstreamCost` 对账

详细字段映射参见 `docs/new-api-casdoor-openbuddy.md`。

### 7.1 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `NEW_API_BASE_URL` | New API 公网地址 |
| `NEW_API_TOKEN` | 专用 token，建议建一个 `service-openbuddy` 用户，只赋 `user` 组 |
| `NEW_API_GROUP` | 用户组，按组隔离计费（与 `TenantPolicyPanel.newApiGroup` 对应） |
| `NEW_API_GROUP_TOKENS_JSON` | 生产多租户必填的 Secret JSON，例如 `{"standard":"sk-...","enterprise":"sk-..."}`；每个 Group 使用独立 New API Token，未映射 Group 必须 fail-closed |
| `NEW_API_ALLOW_ESTIMATED_USAGE` | 兼容开关；生产保持 `0`，缺少真实 usage 时返回 `NEW_API_USAGE_REQUIRED` 并释放预扣 |
| `NEW_API_QUOTA_PER_UNIT` | 可选；Worker 读取 New API `/api/status.data.quota_per_unit` 失败时的受控覆盖值，必须为已核对的正数 |
| `OPENBUDDY_COMMERCIAL_MODEL_CONFIG` | | — | 商业模型审计器的 JSON 基线；发布前运行 `node scripts/audit-commercial-model.mjs --config <file>` |

Gateway 的模型定价同时保存两套不可混用的基线：`inputPointsPerThousand` / `outputPointsPerThousand` 是客户积分价格；`inputCostPerMillion` / `outputCostPerMillion`、`costCurrency` 和 `costSource` 是供应商成本基线。后者只用于 quote 展示、New API 成本对账和毛利分析，不能直接给用户账户充值或扣费。商业目录还使用所有启用付费套餐中最低的“每积分收入”计算保守毛利；缺少同币种付费套餐或低于 `RESOURCE_GATEWAY_TARGET_GROSS_MARGIN_PERCENT` 时自动不可售。目标实例当前为 `quota_per_unit=500000`，该值只用于 Worker 将没有明确 USD 成本的日志标记为 `provider-reported-quota`。

示例（MiniMax-M3 的成本基线与产品积分价格分开配置）：

```json
{
  "model": "MiniMax-M3",
  "inputPointsPerThousand": 12,
  "outputPointsPerThousand": 40,
  "minimumPoints": 1,
  "inputCostPerMillion": 2.1,
  "outputCostPerMillion": 8.4,
  "costCurrency": "CNY",
  "costSource": "configured-pricing"
}
```

建议将该配置通过受保护的 `PATCH /v1/tenants/{tenantId}/credits/pricing` 写入，并要求变更审批、审计和版本化；不要把上游 API Key、New API 管理 Token 或 Casdoor 凭据放入定价 JSON。

### 7.2 本地成本对账报告

部署自检对 New API 分三层验证：公开 `/api/status` 只证明实例可达；设置 `NEW_API_TOKEN` 后会继续验证 `/v1/models` 和 `/api/usage/token/`；只有显式设置 `NEW_API_VERIFY_CHAT=1` 才会用最小请求调用一次 `/v1/chat/completions`，并要求响应包含真实 `usage`。Chat 返回 `401` 时通常代表 New API 渠道缺少合法上游凭据，不能用 Casdoor access token 或 OpenBuddy 积分代替渠道 Key。New API `/api/log/` 的 `quota` 是内部额度单位，不是币种金额；Worker 优先导入日志明确的 USD 成本，只有确认实例 `QuotaPerUnit` 后才允许显式换算并标记 `provider-reported-quota`，否则必须使用显式价格表并标记 `configured-pricing`，不得直接把 `quota` 当作货币成本。

Gateway 提供只读端点 `GET /v1/tenants/{tenantId}/credits/reconciliation`，按模型和成员
聚合本地已结算账本，返回 token、积分、`upstreamCost` 以及成本字段覆盖率：

```bash
curl -fsS "https://gateway.example.com/v1/tenants/${TENANT_ID}/credits/reconciliation?since=$(date -u -d 'yesterday' +%Y-%m-%dT00:00:00Z)" \
  -H "authorization: Bearer $GATEWAY_ADMIN_TOKEN" | jq .
```

报告会明确返回 `externalNewApiCostFetched` 和 `external.costBasis`。独立 Worker 的示例用法：

报告中的 `commerce` 同时汇总订单毛额、退款、净积分和按原币种保存的 `amountMinor`。Gateway 不做汇率换算，因此多币种净收入只能由财务总账或统一汇率服务核算；`commerce` 仅用于运营对账，不能替代财务总账，也不能把 New API `quota` 当作货币。

```bash
NEW_API_BASE_URL=https://new-api.example.com \
# Optional migration assertion; by default the Worker reads and verifies
# /api/status.data.quota_per_unit. A mismatch blocks cost writes.
NEW_API_QUOTA_PER_UNIT=500000 \
NEW_API_ALLOW_QUOTA_UNIT_OVERRIDE=0 \
NEW_API_ADMIN_ACCESS_TOKEN='<short-lived-admin-token>' \
NEW_API_ADMIN_SESSION_ID='<session-id>' \
NEW_API_ADMIN_USER_ID='<current-admin-user-id>' \
NEW_API_LOG_SINCE=2026-08-29T00:00:00Z \
NEW_API_LOG_UNTIL=2026-08-30T00:00:00Z \
NEW_API_TENANT_SUBJECT_MAP_JSON='{"groups":{"default":{"tenantId":"tenant-a"}},"users":{"alice":{"tenantId":"tenant-a","subject":"casdoor-user","group":"default"}},"tokens":{"57":{"tenantId":"tenant-a","subject":"casdoor-user","group":"default"}}}' \
OPENBUDDY_GATEWAY_URL=https://gateway.example.com \
OPENBUDDY_GATEWAY_ACCESS_TOKEN='<billing-worker-token>' \
RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET='<hmac-secret>' \
NEW_API_RECONCILIATION_WRITE=0 \
node scripts/new-api-reconciliation-worker.mjs
```

生产对账映射建议使用 `groups`、`users`、`subjects`、`tokens` 四个命名空间。Worker 会优先按 Token（若日志提供 `token_id`），再按用户名或 Gateway 注入的 `x-openbuddy-subject` 元数据解析主体，并强制校验 Actor、Group 与租户一致；Group 映射存在但日志缺失、出现未知 Group、主体未映射或 Actor 冲突时整条记录跳过，不会把成本归入默认租户。旧的扁平用户名映射仅用于迁移，不能证明 New API 多租户隔离。映射文件只保存 Casdoor `tenantId/subject` 和 New API 标识，不保存任何 API 密钥。

写入模式默认启用 `NEW_API_STRICT_TENANT_MAPPING=1` 和 `NEW_API_VALIDATE_GROUPS=1`：前者要求非空 `groups` 映射，后者通过 New API `GET /api/group/` 校验每个映射 Group 仍存在；任一配置漂移都会在导入前失败关闭。dry-run 可显式设置为 `0` 以兼容迁移，但不能作为生产写入配置。

默认 dry-run；确认记录后才设置 `NEW_API_RECONCILIATION_WRITE=1`。Worker 优先读取日志 `other` 中明确的 `upstream_cost/cost` 等 USD 字段；若仅有 `quota`，必须确认 `QuotaPerUnit` 并标记 `provider-reported-quota`；再无可验证成本时，只有配置 `NEW_API_PRICING_JSON` 才会按 token 价格导入，并明确标记 `configured-pricing`。它不读取或伪造 New API 管理端余额，且按 `tenantId`、`subject`、`model`、`newApiRequestId` 和 `importKey` 做幂等比对。

商业模型发布前还必须执行一次本地 SKU/毛利审计：

```bash
node scripts/audit-commercial-model.mjs --config deploy/openbuddy-commercial-model.example.json
```

该审计器只验证套餐、销售积分价格、供应商成本、币种和目标毛利，不访问网络，也不修改 Gateway；失败时禁止发布该价格目录。企业共享钱包已实现：`POST /v1/tenants/{tenantId}/wallets` 创建并自动绑定 owner；成员角色为 owner/spender/viewer；AI 调用通过 `x-openbuddy-wallet` 头声明扣费钱包；wallet 级 grant/billing/orders/refund/reserve/settle/release/ledger 均已生效；归档/暂停钱包会被网关拦截消费。生产部署时，租户管理员应通过 Casdoor Organization → Group → Role 把 Enterprise 成员同步为 wallet owner/spender/viewer，再授予 `tenant.billing.write` 权限。

生产可使用 `deploy/openbuddy-new-api-capability-snapshot.service` 与 `.timer` 定时刷新只读能力快照，再使用 `deploy/openbuddy-new-api-reconciliation-worker.service` 与 `.timer` 做成本对账，并使用 `deploy/openbuddy-new-api-reconciliation-watchdog.service` 与 `.timer` 每 15 分钟检查最近一次成功对账：将 `deploy/new-api-reconciliation-worker.env.example` 复制到 `/etc/openbuddy/`，由 Secret Manager 注入短期 New API 只读管理凭据、租户映射、Gateway service token 和导入 HMAC。Worker 环境文件包含密钥，watchdog 不读取该文件，只通过 systemd 的非敏感 `Environment=` 设置状态路径和 `NEW_API_RECONCILIATION_MAX_AGE_HOURS`。能力快照只保存版本、quota 单位、Group、渠道、模型和日志统计键，不保存 Token 或响应正文；脚本先写临时文件再 rename，避免 Worker 读到半写快照。安装后先运行 `CAPABILITY_SNAPSHOT_ENV_FILE=/etc/openbuddy/new-api-reconciliation-worker.env CAPABILITY_SNAPSHOT_UNIT_FILE=/etc/systemd/system/openbuddy-new-api-capability-snapshot.service scripts/validate-capability-snapshot-install.sh`，再执行 `systemctl enable --now openbuddy-new-api-capability-snapshot.timer`。部分 New API 版本会校验登录会话，需同时注入登录响应 `data.session.sid` 对应的 `NEW_API_ADMIN_SESSION_ID`，不能把 Casdoor 或 OpenBuddy token 填入该变量。默认使用 `NEW_API_LOG_WINDOW_MINUTES=60` 滚动窗口，并从 `/var/lib/openbuddy/new-api-reconciliation-checkpoint.json` 的上次成功水位向前重放 `NEW_API_LOG_OVERLAP_MINUTES=10` 分钟；Gateway 的 `importKey/newApiRequestId` 幂等保护不会重复计费，Worker 只有整轮导入成功且没有任何未映射、无成本或缺少 request id 的日志后才原子推进 checkpoint，失败不会推进。一次性补账时同时设置 `NEW_API_LOG_SINCE/UNTIL`，不会修改自动水位。然后执行 `systemctl enable --now openbuddy-new-api-reconciliation-worker.timer openbuddy-new-api-reconciliation-watchdog.timer`。Watchdog 只读状态文件，最近一次运行不是 `succeeded` 或超过 `NEW_API_RECONCILIATION_MAX_AGE_HOURS` 时以非零状态退出，交由 systemd/监控告警；它不访问 New API、不写 Gateway、不修改账本。先以 `NEW_API_RECONCILIATION_WRITE=0` dry-run，核对 `quotaPerUnit`、`costBasis`、跳过原因和租户数量；修复所有跳过记录后再切换为 `1`。

安装或升级 Worker 后先运行 `WORKER_ENV_FILE=/etc/openbuddy/new-api-reconciliation-worker.env WORKER_MAPPING_FILE=/etc/openbuddy/new-api-tenant-subject-map.json WORKER_UNIT_FILE=/etc/systemd/system/openbuddy-new-api-reconciliation-worker.service scripts/validate-reconciliation-worker-install.sh`。该门禁只检查 env/map 文件权限、HTTPS、占位符、凭据最小长度、HMAC、租户映射和 systemd 沙箱，不读取或打印任何秘密，也不访问 New API/Gateway；校验通过后再启用 timer。生产 env 必须为 `0600`，映射文件不得被 group/other 写入，checkpoint 和 `NEW_API_RECONCILIATION_STATUS_FILE` 只能位于 `/var/lib/openbuddy`。Worker 启动时原子写入 `running` 状态，成功后写入带窗口、租户、导入和重复计数的 `succeeded` 状态，异常写入脱敏的 `failed` 状态；任何失败都不会推进 checkpoint。写入模式还必须配置 `NEW_API_CAPABILITY_SNAPSHOT_FILE` 和 `NEW_API_CAPABILITIES_JSON`；Worker 会在导入前校验快照新鲜度、Group/模型/渠道漂移、usage 证据及 `quota_per_unit` 一致性。

积分过期建议与对账 Worker 分离执行每日租户批处理：生产环境使用 `scripts/credit-expiry-worker.mjs` 和 `deploy/openbuddy-credit-expiry-worker.service`/`.timer`，不要把 Casdoor 用户 Token 写进 systemd。复制 `deploy/credit-expiry-worker.env.example` 到 `/etc/openbuddy/credit-expiry-worker.env`，由 Secret Manager 注入 `RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET`，并显式配置 `CREDIT_EXPIRY_TENANT_IDS`；Worker 调用 `/internal/v1/credits/expire`，以 `timestamp + '.' + 原始 JSON body` 计算 HMAC，并用 `Idempotency-Key` 防重放。缺少租户清单、签名密钥、时间戳或重复使用不同租户清单时任务会失败关闭。用户 Token 形式的 `POST /v1/tenants/{tenantId}/credits/expire?all=true` 保留用于人工/租户管理员操作，仍只过期未被预留的 FIFO 积分并返回 `expired`、`accounts`、`wallets` 与 `entitlementsExpired`。

普通成员多租户验收使用 `OPENBUDDY_GATEWAY_URL=... OPENBUDDY_TENANT_A=... OPENBUDDY_TOKEN_A=... OPENBUDDY_TENANT_B=... OPENBUDDY_TOKEN_B=... pnpm tenant:boundary-audit`。该脚本只执行 GET：两名成员分别必须能读取自己的 `/resources`，使用对方 Token 访问另一租户必须返回 `403 TENANT_MEMBERSHIP_REQUIRED`；可选 `OPENBUDDY_RESOURCE_ID=...` 验证具体资源，`VERIFY_TENANT_CATALOG=1` 验证商业目录边界。必须使用真实普通成员短期 Casdoor Token，不能使用全局管理员 JWT 代替矩阵证据；脚本不会输出 Token 或响应正文。

> **Worker 安装边界**：systemd Worker 主机必须先将完整仓库（至少包含 `scripts/`、`deploy/`）安装到 `/opt/service/openbuddy`；`scripts/deploy-gateway-remote.sh` 上传的 Gateway 平铺目录与 Worker canonical runtime 一致，不能用旧的 `/opt/openbuddy` 路径。安装门禁会确认 `/opt/service/openbuddy/scripts/new-api-capability-snapshot.mjs` 和 `/opt/service/openbuddy/scripts/new-api-reconciliation-worker.mjs` 存在。

可用 `scripts/install-new-api-worker-remote.sh` 安装非敏感 Worker 脚本和 systemd unit。它默认 dry-run，不上传 env、租户映射或任何密钥；生产执行时使用已授权 SSH key、`DEPLOY_APPLY=1`，并在确认门禁通过后另设 `WORKER_ENABLE_TIMERS=1` 启用三个 timer。当前 systemd unit 的 canonical runtime path 是 `/opt/service/openbuddy`；如果主机使用其他目录，必须先生成对应的 unit，不得直接复用本安装器。

```bash
DEPLOY_SSH_HOST=203.0.113.10 \
DEPLOY_SSH_USER=deploy \
DEPLOY_SSH_KEY="$HOME/.ssh/openbuddy-prod" \
WORKER_REMOTE_RUNTIME_DIR=/opt/service/openbuddy \
bash scripts/install-new-api-worker-remote.sh

DEPLOY_APPLY=1 \
DEPLOY_SSH_HOST=203.0.113.10 \
DEPLOY_SSH_USER=deploy \
DEPLOY_SSH_KEY="$HOME/.ssh/openbuddy-prod" \
WORKER_REMOTE_RUNTIME_DIR=/opt/service/openbuddy \
bash scripts/install-new-api-worker-remote.sh

DEPLOY_APPLY=1 WORKER_ENABLE_TIMERS=1 \
DEPLOY_SSH_HOST=203.0.113.10 \
DEPLOY_SSH_USER=deploy \
DEPLOY_SSH_KEY="$HOME/.ssh/openbuddy-prod" \
WORKER_REMOTE_RUNTIME_DIR=/opt/service/openbuddy \
bash scripts/install-new-api-worker-remote.sh
```

## 8. 监控与告警

### 8.1 关键指标

Gateway 暴露 `/metrics`（Prometheus 格式）：

| 指标 | 告警阈值 |
| --- | --- |
| `http_requests_total{path,outcome}` 5xx 比率 | > 1% 持续 5min |
| `http_requests_rate_limited_total` 增长速率 | > 10/s |
| `audit_events_total` 速率 | < 1 或 > 1000（异常） |
| `webhook_accepted_total / webhook_rejected_total` 比值 | reject > 10% |
| `casdoor_jwks_cache_age_seconds` | > 3600（jwks 未刷新） |

### 8.2 健康检查

- `https://gateway.example.com/healthz`：进程存活
- `https://gateway.example.com/readyz`：依赖就绪（包含 store adapter 初始化）
- `https://gateway.example.com/v1/tenants/built-in/health`：租户维度健康

Caddy 容器 `docker compose ps` 显示 `healthy` 状态。

### 8.3 告警接入示例（Alertmanager）

```yaml
groups:
  - name: openbuddy-gateway
    rules:
      - alert: Gateway5xxHigh
        expr: sum by (path) (rate(http_requests_total{outcome=~"5.."}[5m])) > 0.01
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "OpenBuddy Gateway 5xx > 1% on {{ $labels.path }}"
      - alert: GatewayUnhealthy
        expr: up{job="openbuddy-gateway"} == 0
        for: 2m
        labels: { severity: page }
```

## 9. 灾备与升级

### 9.1 灰度发布

Gateway 镜像构建在 CI；建议用 blue/green：

```bash
# 1) 构建并打 tag
git tag v1.4.0 && git push --tags
docker build -t registry.example.com/openbuddy/gateway:v1.4.0 \
  services/casdoor-resource-gateway/

# 2) 推送到内网 registry
docker push registry.example.com/openbuddy/gateway:v1.4.0

# 3) 修改 docker-compose.production.yml 的 image tag
# 4) 滚动重启
docker compose -f services/casdoor-resource-gateway/docker-compose.production.yml \
  up -d --no-deps resource-gateway
```

回滚：

```bash
git revert HEAD
docker compose -f services/casdoor-resource-gateway/docker-compose.production.yml \
  up -d --no-deps resource-gateway
```

### 9.2 数据库迁移

Postgres 表 schema 变更走 `RESOURCE_GATEWAY_STORE=postgres` 模式下的
`storeAdapter.bootstrap()` 幂等迁移。每次升级前务必备份（见 §4.1）。

### 9.3 Casdoor 升级

Casdoor 服务端独立升级，与 Gateway 解耦。Gateway 只信任 Casdoor 的 issuer
URL + JWKS；只要 Casdoor 不换 issuer，Gateway 无需变更。

## 10. 安全检查清单

部署完成前逐项核对：

- [ ] 所有 `*-SECRET` / `*-TOKEN` / `*_PASSWORD` 都来自 Secret Manager，未硬编码
- [ ] `CASDOOR_ISSUER` 使用 HTTPS，不带 query/credential
- [ ] Postgres 仅监听 `openbuddy-net`，不暴露 5432 到宿主机
- [ ] Caddy 自动续签 Let's Encrypt（`docker logs caddy` 检查无 ACME 错误）
- [ ] SIEM 至少一种模式在运行（syslog / webhook / csv）
- [ ] `/v1/tenants/*` 端点都需要 Bearer token；curl 无 token 必须返回 401
- [ ] OpenBuddy 桌面客户端版本号与 Gateway 兼容（见 release notes）
- [ ] 备份目录有异地副本（OSS / S3）
- [ ] `RESOURCE_GATEWAY_RATE_LIMIT_REQUESTS` 已调整到合理上限
- [ ] kill switch 测试通过：临时在 TenantPolicyPanel 启用 → 调用方立即 503

## 11. 故障排查速查

| 症状 | 可能原因 | 处置 |
| --- | --- | --- |
| `/healthz` 返回 503 | Postgres 未就绪 / store 适配器初始化失败 | `docker logs resource-gateway` 查看 trace |
| 桌面端登录后立刻被踢出 | Casdoor ↔ Gateway clock skew > 30s | 启用 NTP / chrony |
| 微信登录白屏 | Provider 未在 Casdoor Application 中启用 | Casdoor 管理后台勾选对应 Provider |
| 积分扣减但 New API 余额未变 | `NEW_API_TOKEN` 失效 | Casdoor 端生成新 token，重启 Gateway |
| 审计事件未到 SIEM | `RESOURCE_GATEWAY_SIEM` 未设置或 webhook endpoint 401 | 检查环境变量 + curl 模拟 |
| kill switch 关闭后 AI 调用仍被允许 | Gateway 缓存未刷新 | 重启 Gateway 实例 |

## 12. 后续演进路线

| 优先级 | 任务 | 前置条件 |
| --- | --- | --- |
| P0 | SIEM 接入真实平台（Splunk / Elastic / Datadog） | 部署方提供 endpoint + 凭据 |
| P0 | Postgres HA / 托管化 | 部署方提供托管实例 |
| P0 | 微信开放平台真实凭据 | 部署方提供 AppID / AppSecret |
| P1 | 支付渠道（微信支付 / 支付宝）真实联调 | 部署方提供商户号 + 签名证书 |
| P1 | Casdoor 备份与异地容灾 | 同上 |
| P1 | OpenBuddy 桌面端 macOS 公证 + Windows 代码签名 | 部署方提供开发者证书 |
| P2 | New API Group 多组隔离扩展 | 业务侧需求 |
| P2 | 积分汇率策略引擎 | 业务侧需求 |
| P3 | 自助多租户注册流程 | 法务合规审核通过 |

## 13. 离线发布包与远程一致性校验

如果生产主机只能通过 scp/rsync/文件服务接收代码，或 CI 与生产之间网络受限，可使用离线发布包：

```text
scripts/build-release-bundle.sh /tmp/openbuddy-release
```

输出：

- `openbuddy-release-<git-short-sha>.tar.gz`：48 个非敏感文件（scripts/、deploy/、services/casdoor-resource-gateway/、所有架构与商业化文档）。
- `openbuddy-release-<git-short-sha>.sha256`：每个文件 SHA-256。
- `openbuddy-release-<git-short-sha>.manifest.json`：路径 + SHA-256 + size 列表。
- `openbuddy-release-<git-short-sha>.tar.gz.sha256`：压缩包 SHA-256。

发布包**不包含**生产 env、租户映射、能力快照或任何密钥。运维把 tarball 放到目标主机 `/opt/service/openbuddy-incoming/`，解压后由 `scripts/install-new-api-worker-remote.sh`（提供 SSH key）或 `scripts/deploy-gateway-remote.sh` 完成真正的部署。

部署后用 `scripts/verify-remote-install.sh` 校验：

```text
REMOTE_HOST=124.221.146.145 REMOTE_USER=ubuntu REMOTE_DIR=/opt/service/openbuddy \
EXPECTED_VERSION=<git-short-sha> bash scripts/verify-remote-install.sh
```

脚本只读 Gateway `/healthz`、systemd unit 表和 worker 脚本存在性，确认：

- 远端 Gateway `version` 字段 == `EXPECTED_VERSION`，避免代码已推但容器仍跑旧版本；
- 4 个 systemd timer（capability-snapshot、reconciliation-worker、reconciliation-watchdog、credit-expiry-worker）都已安装；
- `scripts/new-api-reconciliation-worker.mjs` / `scripts/credit-expiry-worker.mjs` / `scripts/new-api-capability-snapshot.mjs` 三个 Worker 在磁盘上存在；
- `/internal/v1/credits/expire` 路径出现在网关源码中，证明本轮内部 HMAC 过期任务接口已经随发布一并部署。

任何一项失败脚本以非零状态退出，便于 CI/工单系统拦截"代码已发但服务没更新"的常见漂移。

---

## 14. 部署后自检：`scripts/deploy-doctor.sh`

`scripts/deploy-doctor.sh` 是发布门禁，串接所有生产环境自检。最新包括 9 个分段：

| §  | 标题 | 关键校验 |
| -- | ---- | -------- |
| 1 | Gateway 健康 | `/healthz` + `/readyz`、版本号、`store` 类型 |
| 2 | Postgres | 联通、`schemaVersion` ≥ 13、`creditExpiryRuns` 已存在 |
| 3 | Casdoor Provider | 必要的 Provider（WeChat / SMS）状态 |
| 4 | New API | `/api/status`、余额、最低余额告警 |
| 5 | SIEM | 心跳事件计数 ≥ 1 |
| 6 | 企业面板 IPC | 11 个面板路由在 preload allowlist + main handler 双向可达 |
| 7 | Kill Switch | `KILL_SWITCH_TEST=2` 时实测启停 |
| 8 | Prometheus | 关键指标已暴露 |
| 9 | 内部 credit-expiry | `/internal/v1/credits/expire` 路径存在 + 拒绝无签名/错签名 +（可选）端到端 HMAC + 幂等回放 |

§9 的实现被抽到 `scripts/_section-credit-expiry.sh`，方便单元测试与 CI 直接调用 `run_credit_expiry_check`。任何修改签名/时间戳约束的变更必须同步：
1. `services/casdoor-resource-gateway/src/index.ts` 的 `handleInternalCreditExpiry`
2. `scripts/credit-expiry-worker.mjs` 的 `expirySignature`
3. `scripts/_section-credit-expiry.sh` 的 openssl HMAC 计算

最小集部署命令：

```bash
# 1. 仅路由存在性 + skip HMAC（最快）
bash scripts/deploy-doctor.sh

# 2. 加上 HMAC 完整校验
GATEWAY=https://gateway.example.com \
CREDIT_EXPIRY_SECRET="$RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET" \
CREDIT_EXPIRY_TENANTS="built-in,alice-corp" \
CREDIT_EXPIRY_RUN_ID="deploy-doctor-$(date +%s)-$$" \
  bash scripts/deploy-doctor.sh
```

推荐把 `bash scripts/deploy-doctor.sh` 接入发布流水线的最后一公里，任何 FAIL 都会让脚本 exit 1。

---

**版本**：v1.1 · 与 OpenBuddy 仓库 `codex/casdoor` 分支配套 · 任何环境变量变更请同步更新本文。
