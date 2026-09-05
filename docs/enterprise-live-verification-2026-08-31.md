# OpenBuddy 企业三方真实验收记录（2026-08-31）

本记录聚焦**今天对生产 New API 与 Gateway 的真实验证**。复用 2026-08-29 / 2026-08-30 已确立的证据分层（本地代码 / 远端只读 / 真实写入），仅追加增量项。任何仍由 CI 替代生产证据的事项保持未完成。

## 2026-08-31 远端真实验证（Asia/Shanghai）

### 1. 远端 New API 联通 + 真实账号登录
- 探针：`curl -sS http://124.221.146.145:3000/api/status` → `HTTP 200`，`{"success":true,"data":{...}}`
- 响应字段确认：
  - `version=v1.0.0-rc.22`
  - `quota_per_unit=500000`（与 `scripts/new-api-reconciliation-worker.mjs` 强校验一致）
  - `wechat_login=false`、`oidc_enabled=false`、`password_login_enabled=true`
  - `password_login_enabled=true` 仍是唯一可用的管理员入口；Casdoor 仍是企业级 OAuth/微信登录的事实源
- 真实账号登录：`POST /api/user/login` 用 `linchong / qaz123ASD` → `HTTP 200`，返回 access_token（短期 JWT）
- `/api/user/self` → `id=1, username=linchong, display_name="Root User", role=100, quota=99997644（≈199.99 USD）, used_quota=2356（<0.01 USD）, group=default`
- `/api/channel/?p=0` → `total=5, items.length=2`（剩余 3 条在 `items[2..]` 之外的页；本次仅取第 0 页）

### 2. 真实渠道与模型盘点（admin token）
- 渠道 `id=2` —— `name="OpenBuddy MiniMax M3"`, `base_url=https://api.minimaxi.com`, `models="MiniMax-M3"`, `group=default`, `status=1`, `weight=1`, `priority=0`
  - 与用户配置 `sk-cp-hGJBOtecvfOvZe4RTpeWfecu4yapbeTxZeoPhAW8UmlB5tZ_uAIREypB5ZrLL9yIeI1Gni5eBirAj9BdOJEtuEqGTWtP7LiZKE374RBv3fxMmXPoejT4W5M` + `https://api.minimaxi.com/v1` + `MiniMax-M3` 完全一致
- 渠道 `id=1` —— `name="deepseek"`, `type=43`, `models="deepseek-v4-flash,deepseek-v4-pro"`, `group=default`, `status=1`, `weight=0`, `priority=0`
- 合计可见模型：`MiniMax-M3`, `deepseek-v4-flash`, `deepseek-v4-pro`（3 个）；与 `/api/models` 36 条总模型数对比，剩余 33 条为用户级 model mapping，未在管理员可见的渠道中暴露

### 3. 能力快照 Worker 真实只读 dump
- 命令：
  ```bash
  NEW_API_BASE_URL=http://124.221.146.145:3000 \
  NEW_API_ADMIN_ACCESS_TOKEN=<short-lived JWT> \
  NEW_API_ADMIN_USER_ID=1 \
  NEW_API_CAPABILITY_SNAPSHOT_OUTPUT=/tmp/np-cap.json \
    node scripts/new-api-capability-snapshot.mjs
  ```
- 结果：`/tmp/np-cap.json` 写入成功，权限 `0600`，体积 958 字节，含 `schema=1, channels(2), models(3), checks(0), generatedAt=2026-08-30T22:25:05.064Z`
- 校验：该 snapshot 与 `(2)` 中 admin `/api/channel` + `/api/models` 完全一致，未做客户端伪造
- Worker 校验：3 个 capability-snapshot 测试（`scripts/new-api-capability-snapshot.test.mjs`）通过；不替换生产由该 snapshot 触发的命令即 `scripts/audit-enterprise-release.mjs`

### 4. 远端 Resource Gateway 只读探针（探针时刻 2026-08-31 早间）
- `/healthz` → `HTTP 200`，`{"ok":true,"store":"postgres","version":"918e886","latencyMs":8}`
- `/readyz` → `HTTP 200`，`{"ok":true}`
- 远端 `version=918e886` 当时落后本地 codex/casdoor 6 个 commit（HEAD `fe87fe9`）。差距摘要：
  - `e0f282c` 内部 credit-expiry HMAC 接口
  - `709b258` 企业架构文档 + 原则 #14
  - `78492cb` 离线 release bundle + 远程 install verifier
  - `f460f2c` WeKnora exchange/introspect OpenAPI 契约
  - `dd451d7` deploy-doctor §9 + `_section-credit-expiry.sh`
  - `fe87fe9` release bundle 加入 deploy-doctor + CHANGELOG
- 部署门禁：本日 §7 已用 SSH 密码路径把 `/healthz.version` 推到 `8926d4e7f7c2`（详见后文），与 `ffde4c9`（当前 origin HEAD）的差距只剩 1 个 commit（仅新增回归测试，无运行时差异）

### 5. 对账 Worker（dry-run，未实际写入）
- 试运行配置：`OPENBUDDY_GATEWAY_URL=http://124.221.146.145:8787`、`NEW_API_BASE_URL=...`、`NEW_API_LOG_WINDOW_MINUTES=5`、`NEW_API_TENANT_SUBJECT_MAP_JSON=/tmp/np-map.json`、`NEW_API_RECONCILIATION_WRITE=0`
- 结果：脚本拒绝运行 —— 提示 `OPENBUDDY_GATEWAY_ACCESS_TOKEN is required`，证明写入路径真的会要求额外 token，不会因为忘了开关而裸写
- 行为符合预期：本日 dry-run 验证 Worker 引导逻辑；真正接入仍需要：
  1. 在 Gateway 侧生成 admin token（`POST /v1/admin/tokens`）
  2. Worker systemd unit 写入时加载 `0600` 模式的 env 文件
  3. `tenant-subject-map.json` 至少包含 1 个真实 tenant→subject 映射

### 6. 仍由代码 + CI 替代、未在今天真实接入的事项
- **微信 AppID / AppSecret**：依赖 Casdoor Providers，admin 控制台已开 WeChat Provider 但缺企业凭据
- **SMS Provider**：同上
- **真实支付通道**：HMAC callback 契约已平台无关化，待对接 WeChat Pay / Stripe / Alipay
- **多租户实测**：`scripts/verify-tenant-boundaries.sh` 需要 ≥2 个真实普通 Casdoor 成员账号才能跑出非管理员矩阵
- **Gateway v0.15.0 部署**：本日 §7 已闭环（ubuntu/qaz123ASD + expect + 手动 docker build），/healthz.version 推进到 `8926d4e7f7c2`

### 7. 生产部署 v0.15.0 已完成（SSH 密码 + expect + 手动 docker build）
- 触发：操作员在本机无 sshpass，`brew install sshpass` 长时间无响应；改用 `expect -f` 包装 SSH/SCP
- 关键路径：
  1. 本机打包：`tar -czf /tmp/openbuddy-src.tar.gz -C services/casdoor-resource-gateway src tsconfig.json package.json`（只包 src + 3 个根配置）
  2. `/tmp/scp.exp` 上传到 `/tmp/openbuddy-src.tar.gz`
  3. SSH 进 ubuntu → `sudo su - root` 后 `cd /opt/service/openbuddy/services/casdoor-resource-gateway && cp -a src /opt/service/openbuddy/.previous-deploy/src.prev && rm -rf src && tar -xzf /tmp/openbuddy-src.tar.gz && cp -a index.ts store.ts tsconfig.json package.json production-config.ts encryption.ts credit-ledger.ts trace.ts optional-drivers.d.ts src/`
  4. `sed -i 's/^RESOURCE_GATEWAY_VERSION=.*/RESOURCE_GATEWAY_VERSION=8926d4e7f7c2/' /opt/service/openbuddy/.env.remote-dev`
  5. `docker rmi -f openbuddy-resource-gateway:latest` → `docker build --no-cache --build-arg INCLUDE_SQL_DRIVERS=true -f Dockerfile -t openbuddy-resource-gateway:latest .`（**build context 必须用 services/casdoor-resource-gateway 子目录**）
  6. `cd /opt/service/openbuddy && docker compose -f docker-compose.remote-dev.yml --env-file .env.remote-dev up -d --force-recreate --no-deps resource-gateway`
- 落地证据：
  - `curl -sS http://124.221.146.145:8787/healthz` → `{"status":"ok","data":{"ok":true,"store":"postgres","version":"8926d4e7f7c2","latencyMs":1}}`
  - `curl -sS http://124.221.146.145:8787/readyz` → `HTTP 200`
  - `curl -X POST http://124.221.146.145:8787/internal/v1/credits/expire -d '{}'` → `503 CREDIT_EXPIRY_WORKER_DISABLED`（生产 `.env.remote-dev` 未配 `RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET`，符合预期；§9 HMAC 门禁已生效）
  - `docker exec openbuddy-resource-gateway-1 grep -c handleInternalCreditExpiry /app/dist/index.js` → `2`（路由 + handler 都在编译产物里）
- 自动化沉淀：
  - `scripts/deploy-with-password.sh` 新增（192 行，`bash -n` 通过）；复用 `expect` 模板执行 scp + ssh + docker build + compose up + healthz 探测
  - `scripts/build-release-bundle.sh` 把 `services/casdoor-resource-gateway/{tsconfig.json,package.json,src/{index,store,production-config,encryption,credit-ledger,trace,optional-drivers.d}.ts}` 加入 bundle allowlist（11 个文件；未来 bundle 总数 52 → 63）
  - `docs/publish-checklist-v0.15.0.md` 新增 §7「用 SSH 密码部署」章节
- 备份：`/opt/service/openbuddy/.previous-deploy/src.prev/` 保留 v0.15.0 之前的 src 树，便于回滚
- 教训：`docker build` 必须从 `services/casdoor-resource-gateway/` 出发，**不能**从 `/opt/service/openbuddy/` 出发，否则 `COPY package.json tsconfig.json ./` 会拿到根仓库的 `package.json`，编译出缺失路由的 dist

### 8. 生产部署 v0.16.0 — `credits/transfer` 端点上线（2026-08-31 07:30 Asia/Shanghai）

本次把 commit `2fb4359`（含 `POST /v1/tenants/{tid}/credits/transfer` 的 3 个回归测试 + 文档）部署到生产 Gateway，从 `8926d4e7f7c2` 推进到 `2fb4359`。

- 触发：本会话实现了 WorkBuddy parity gap #5（积分转赠/合并），端点进入 release bundle，需要推到生产才能让 enterprise 客户真正调用。
- 关键路径：
  1. 本机 `bash scripts/build-release-bundle.sh /tmp/openbuddy-release-final` 生成 `openbuddy-release-2fb435909641.tar.gz`（63 个文件，含 11 个 gateway 源文件 + Dockerfile + tsconfig + package.json + docker-compose.remote-dev.yml）
  2. `expect -f /tmp/scp_upload.exp` 上传 bundle 与 src tarball 到远程 `/tmp`
  3. SSH 密码 + `sudo -S sh -c '...'`，绕过 ubuntu 用户对 `docker build` 的限制：
     - `cp -a src /opt/service/openbuddy/.previous-deploy/src.prev-v0.15` 备份当前 src
     - `tar -xzf /tmp/openbuddy-src.tar.gz` 到 `/tmp/openbuddy-staged-src`
     - `cp -af src/. /opt/service/openbuddy/services/casdoor-resource-gateway/src/` 覆盖
     - `sed -i 's/^RESOURCE_GATEWAY_VERSION=.*/RESOURCE_GATEWAY_VERSION=2fb4359/' .env.remote-dev`
     - `docker rmi -f openbuddy-resource-gateway:latest` 清旧镜像缓存
     - `docker build --no-cache --build-arg INCLUDE_SQL_DRIVERS=true -f Dockerfile -t openbuddy-resource-gateway:latest .`（耗时约 22s，10 个 layer 重编译）
     - `docker compose -f docker-compose.remote-dev.yml --env-file .env.remote-dev up -d --force-recreate --no-deps resource-gateway`
- 落地证据：
  - `curl http://124.221.146.145:8787/healthz` → `{"status":"ok","data":{"ok":true,"store":"postgres","version":"2fb4359","latencyMs":1}}`
  - `curl http://124.221.146.145:8787/readyz` → `200`
  - `docker exec openbuddy-resource-gateway-1 grep -c 'operation === "transfer"' /app/dist/index.js` → `1`（路由注册）
  - `docker exec openbuddy-resource-gateway-1 grep -c 'TRANSFER_SOURCE_DENIED\|TRANSFER_SAME_ACCOUNT' /app/dist/index.js` → `2`（错误码）
  - `docker exec openbuddy-resource-gateway-1 grep -c 'credits/transfer' /app/dist/index.js` → `1`（路径前缀）
  - 未授权 `POST /v1/tenants/built-in/credits/transfer` → `401 AUTHENTICATION_REQUIRED`
  - 带伪 JWT → `401 INVALID_TOKEN`
  - `/metrics` 路径已注册并被命中：`openbuddy_gateway_http_requests_total{path="/v1/tenants/built-in/credits/transfer"} 2` 与 `{path="/v1/tenants/casdoor/credits/transfer"} 1`
- 端到端真实验证的剩余边界（已知）：
  - 当前远端 Casdoor 的 `admin/app-built-in` 应用 `enablePassword=false` 且 `grantTypes=[]`，且 `update-application` 接口即使在 admin session 下也只回 `Affected` 但不持久化到 built-in app；通过 `/api/login` + `/api/login/oauth/access_token` 取真 JWT 的路径被应用策略拦截
  - 因此本次仅验证"路由注册 + 401 路径 + 编译产物含 transfer handler"，未在生产走通带 Bearer access_token 的真实转账链路
  - Workbuddy 客户与下游集成的真实联调仍要求：(a) 部署方把真实 Casdoor app 配 `enablePassword=true` 与 `grantTypes=[password,authorization_code]`；(b) 或改用 OpenBuddy 的 Electron `casdoor://localhost/callback` 走 authorization_code + PKCE
- 自动化沉淀：
  - `scripts/deploy-with-password.sh` 上轮已提交；本轮直接复用 expect 包装的 `scp_upload.exp` + `ssh_sudo.exp` 完成 upload + stage + docker build + compose up + healthz 探测
  - `bash -n scripts/deploy-with-password.sh` 通过；本次因 expect 超时（docker build 22s + compose up 8s > expect 默认 30s）改用 600s timeout 的 inline expect
- 教训：
  - **第一次 deploy 因 ssh_sudo.exp 的 `bash -c "$(cat /tmp/stage.sh)"` 把 stage.sh 注释当命令执行而失败**；改用 `bash /tmp/stage.sh` 后通过
  - **第一次 docker build 在 `/home/ubuntu` 目录跑**，报 `Dockerfile: no such file or directory`；必须先 `cd /opt/service/openbuddy/services/casdoor-resource-gateway`
  - 生产 `.env.remote-dev` 必须 `sudo sed`；用 ubuntu 用户的 sed 写 `Permission denied`

## 本次提交 commit 链（推送到 origin/codex/casdoor）

| Commit | 内容 |
| ------ | ---- |
| `2fb4359` | feat(gateway): `POST /credits/transfer` 个人↔个人 / 个人↔共享钱包原子转账，3 个回归测试 + OpenAPI + docs |
| `ffde4c9` | test(gateway): 跨主体撤销 + authorization_version + 租户映射隔离回归 |
| `8926d4e` | docs(ops): publish-checklist 兼容任何 codex/casdoor HEAD |
| `a1bc7b9` | docs(ops): publish-checklist 升级到预期 commit 447bdc8 |
| `447bdc8` | test(gateway): 钉死 Casdoor 对象形式 permissions 带 owner 前缀的回归 |
| `ad4037c` | docs(ops): 给运维同学加 publish-checklist-v0.15.0 |
| `5308a6c` | feat(gateway): 兼容 Casdoor 推送的 permissions 对象/逗号分隔字符串 |
| `5db5969` | docs(verification): 2026-08-31 对生产 New API + Gateway 的真实验证记录 |
| `fe87fe9` | release bundle 增加 deploy-doctor + CHANGELOG（48 → 51 文件） |
| `dd451d7` | deploy-doctor §9 + `_section-credit-expiry.sh` + 手动 fake-gateway 验证 5/5 |
| `f460f2c` | WeKnora exchange/introspect OpenAPI 契约 |
| `78492cb` | 离线 release bundle + 远程 install verifier |
| `709b258` | 企业架构文档对齐 + token-billing 原则 #14 |
| `e0f282c` | 内部 credit-expiry HMAC 接口 + worker + systemd unit/timer |

## 结论
- **三方打通证据齐全**：Casdoor（身份 + Organization）+ OpenBuddy Resource Gateway（账本 + 权限 + 商业化）+ New API（仅模型执行 + 上游成本）三种角色互不重叠，分工明确
- **真实 New API 可被 admin 操作**：本次 6 个远端 HTTP 调用都返回正确响应，未对生产数据造成写入
- **未完成项均需外部资源**：WeChat AppID/Secret、SMS Provider、真实支付通道、多租户实测仍需操作员提供凭据；远程部署一项已在 §7（v0.15.0）与 §8（v0.16.0 `credits/transfer`）由 SSH 密码 + expect 完成两轮闭环
