# OpenBuddy 企业三方真实验收记录（2026-08-30）

本记录是对 2026-08-29 验收材料的增量复核，区分本地代码证据、远端只读证据和真实写入验收。任何无法由当前运行时证明的项目均保持未完成，不以单元测试替代生产证据。

## 2026-08-30 能力快照刷新

- 新增 `openbuddy-new-api-capability-snapshot.service` 与 `.timer`，独立于成本 Worker 每小时读取 New API 管理面并原子刷新脱敏快照；预期库存漂移时不会覆盖最后一份有效快照。
- 使用管理员短期会话完成一次真实只读快照：版本 `v1.0.0-rc.22`、`quotaPerUnit=500000`、Group `default/vip/svip`、渠道 `1/2`、模型 `MiniMax-M3/deepseek-v4-flash/deepseek-v4-pro`、日志统计键 `quota/rpm/tpm`；Token、Cookie 和响应正文未写入仓库。
- 新增 `scripts/validate-capability-snapshot-install.sh`，检查 HTTPS、凭据强度、`0600` 环境文件、快照路径和 systemd 沙箱；能力快照、Worker 和 Gateway 回归均通过。

## 2026-08-30 当前复核（13:47 Asia/Shanghai）

- 远端只读核验：New API `/api/status` 返回 `200`，版本 `v1.0.0-rc.22`、`quota_per_unit=500000`，且当前 `oidc_enabled=false`、`wechat_login=false`、`password_login_enabled=true`；这意味着 New API 管理台登录能力不能替代 Casdoor 的企业登录与微信 Provider。
- Gateway `/healthz` 与 `/readyz` 均返回 `200`，运行存储为 PostgreSQL，当前远端 HTTP 开发联调版本为 `7bd1ad7`；该版本已从本地最新源码重新构建并重建容器。
- 桌面端用量入口已明确拆分：localStorage 里的 token 统计和提醒仅是本地诊断；个人账户或共享钱包的余额、预留、累计消费、订单和对账必须读取 Resource Gateway 服务端账本，禁止用本地估算费用作为财务数据。
- 修复本地诊断记录的模型归属：完成事件现在使用当前模型引用，而不是误用 session ID；相关 UI、纯函数测试和类型检查已通过。
- 本轮没有修改 Casdoor、New API 或 Redis，也没有创建/删除 Token、支付订单或写入远端账本；远端仅更新 Gateway 源码镜像并将非机密的 `RESOURCE_GATEWAY_VERSION` 同步为 `7bd1ad7`。

## 2026-08-30 能力快照写入门禁复核（13:56 Asia/Shanghai）

- New API 对账 Worker 的写入模式现在强制依赖脱敏能力快照和能力目录文件；导入前校验快照新鲜度、Group/模型/渠道漂移、已支持能力的 `usage=required` 证据，以及快照 `quotaPerUnit` 与实时 `/api/status.data.quota_per_unit` 一致。
- `scripts/validate-reconciliation-worker-install.sh` 在写入模式下同时检查快照/能力目录文件存在，并拒绝 group/other 可写权限；缺少任一文件或权限不安全时 fail-closed，不会推进 checkpoint 或导入成本。
- 本地验证：对账 Worker 定向测试 `21/21` 通过；根测试命令按项目脚本正确透传后通过；Shell 语法和 `git diff --check` 通过。该门禁是生产写入前条件，不代表当前远端开发环境已经完成生产调度验收。

## 2026-08-30 计费边界复核（14:09 Asia/Shanghai）

- 修复共享钱包订单的权益边界：带 `walletId` 的支付订单只增加钱包积分，不创建或替换租户级订阅，不改变整个租户的模型白名单、每日预算或 New API Group；个人账户订单仍可授予租户级订阅权益。
- 新增 Gateway 回归覆盖共享钱包订单支付、钱包余额入账和租户订阅保持为空；Gateway 类型检查、商业模型审计和全量测试命令均通过。
- OpenAPI 已补齐 Casdoor webhook 与 OIDC Back-Channel Logout 入口，明确签名、租户撤销和 Content-Type 契约；这不等于目标主机已完成真实 Casdoor webhook/支付 Provider 验收。

## 2026-08-30 Worker 安装门禁复核（13:52 Asia/Shanghai）

- 新增 `scripts/validate-reconciliation-worker-install.sh`：安装前只检查 Worker env/map 权限、HTTPS、占位符、凭据最小长度、HMAC、租户映射、checkpoint 路径和 systemd 沙箱，不访问 New API/Gateway，也不输出秘密。
- Worker systemd unit 新增 `PrivateDevices`、`ProtectKernelTunables`、`ProtectControlGroups`、`ProtectClock`、`ProtectHostname`、`LockPersonality`、地址族和 syscall 架构限制；写权限仍仅限 `/var/lib/openbuddy`。
- 通过/拒绝夹具均已验证：env `0600` 和有效映射通过，env 权限变为 `0644` 时 fail-closed；Shell 语法、类型检查、Gateway 构建和 Worker/能力快照定向测试通过。
- 一次全量 Gateway 测试出现已有 SSE 首帧 70ms 阈值的偶发环境抖动（289ms），随后单独重跑该用例通过；未修改 SSE 逻辑或放宽阈值。

## 2026-08-30 最新发布复核（当前轮次）

- 本地 Gateway 最新修复提交为 `7bd1ad7`：共享钱包订单只增加钱包积分，不创建或替换租户级订阅；此前个人账户消费记录的 `walletId` 隔离修复和能力快照写入门禁也包含在发布历史中。
- 本地验证：Gateway `122/122`、New API 对账 Worker `21/21`、根 TypeScript 检查、Gateway 构建和商业模型审计均通过；`git diff --check` 通过。
- 远端 `/opt/service/openbuddy` 已使用当前源码重新构建 `resource-gateway`，容器状态为 `healthy`，启动日志确认 `store=postgres`；本次部署保留 `.env.remote-dev`、Postgres 数据、Casdoor 和 New API 容器不变。
- 当前公网探针：Gateway `/healthz` 与 `/readyz` 返回 `200`，响应显示 `store=postgres`、`ok=true`、`version=7bd1ad7`。New API `/api/status` 返回 `200`、版本 `v1.0.0-rc.22`、`quota_per_unit=500000`。
- GitHub `codex/casdoor` 已通过 Data API 发布；远端分支 ref `494ef6ee9937f45648ae8bc65348beebb97158d9` 与文件内容是发布状态的权威证据，包含 `7bd1ad7` 的源码、Compose 与验收记录更新。
- 这仍是 HTTP 开发联调栈，不是生产发布：Casdoor callback/scopes、SMS/WeChat Provider、HTTPS/Caddy、Secret Manager、真实支付、生产 Worker 调度和多租户普通成员矩阵仍未验收。

## 当前代码轮次（2026-08-30）

- 生产 Gateway 现在要求显式设置 `CASDOOR_AUDIENCE`，并拒绝缺失、默认 `openbuddy`、占位或示例值；不再允许生产环境通过 `CASDOOR_CLIENT_ID` 回退掩盖 audience 配置错误。运行时门禁、生产 Compose 校验和部署文档已统一。
- 新增 `scripts/preflight-production-config.sh`。该脚本只读取 `.env.production`，输出脱敏 JSON，检查 HTTPS issuer/上游、Casdoor client ID、密钥强度、New API Group→Token 映射以及 capability/usage 验证元数据，不连接远端、不创建 Token、不产生模型费用。
- 本轮验证：Gateway 全量 Vitest `6` 个文件、`99/99` 通过；预检脚本有效配置夹具通过、缺失配置返回 `blocked`；Shell 语法和 `git diff --check` 通过。根仓库 TypeScript 检查仍受当前工作区失效的 `@types/node` 链接阻塞，未下载依赖。
- 这轮改动不代表远端 Casdoor SMS/WeChat Provider、生产 HTTPS、支付渠道、普通成员跨租户矩阵或财务成本定义已完成；这些仍按后续计划验收。

## 当前协议能力轮次（2026-08-30）

- 对照 New API 官方文档 API 目录，确认存在 Moderations 接口；OpenBuddy Gateway 已新增租户隔离的非流式 `/v1/tenants/{tenantId}/ai/moderations` 代理、能力目录协议枚举、Electron/Main 类型和 OpenAPI 契约。
- Moderations 按输入 usage 结算积分；真实 usage 缺失时返回 `NEW_API_USAGE_REQUIRED` 并释放 reservation。目标 MiniMax channel 尚未完成 Moderations 真实验收，因此能力矩阵仍标记为“待验收/不可商业售卖”，不会因代码路由存在而误售卖。
- 本轮验证：Gateway `6` 个测试文件、`101/101` 通过；Casdoor backend 与工作台相关测试 `15/15` 通过；OpenAPI YAML、Shell 语法和 `git diff --check` 通过。

## 2026-08-30 完成度审计（05:08 Asia/Shanghai）

- 远端只读事实：New API `http://124.221.146.145:3000/api/status` 返回 HTTP `200`、版本 `v1.0.0-rc.22`、`quota_per_unit=500000`；Casdoor OIDC Discovery 返回 HTTP `200`；Resource Gateway `http://124.221.146.145:8787/healthz` 与 `/readyz` 当前均返回 HTTP `200`，未授权模型接口返回 `401 AUTHENTICATION_REQUIRED`。
- 官方文档复核：New API 同时提供 AI Model APIs（Models、Chat、Completions、Embeddings、Rerank、Moderations、Audio、Realtime、Images、Video）和 Management APIs（认证、用户、2FA、OAuth、渠道、模型、Token、兑换码、支付、日志、统计、任务、Groups、供应商和安全验证）。这些是平台能力目录，不等于目标实例的每个渠道都已支持，更不等于 OpenBuddy 已将其纳入计费。
- OpenBuddy 本地代码已覆盖 Casdoor OIDC/PKCE、Organization 租户、JWT/JWKS、成员撤销、权限/策略、Webhook、会话、Resource Gateway、New API Group→专用 Token、模型能力门禁、整数积分预扣/结算/释放、订单/退款/支付回调、对账和审计。OpenAPI 当前声明 28 个路径；该结论是代码与测试证据，不是公网部署证据。
- 本地最新 Gateway 定向回归为 `6` 个测试文件、`89/89` 通过；覆盖非流式与 SSE usage、实时首帧透传、`[DONE]`/分帧流、上游错误释放、客户端断开 abort、幂等并发、余额不足、租户 Group 隔离和成员权限边界。主仓库全量回归此前为 `129` 个测试文件、`1351 passed`、`1 skipped`。
- 追加修复：能力目录中的 `streaming=false` 现在由 Gateway 在积分预扣前强制执行，返回稳定错误 `AI_STREAM_UNSUPPORTED`，不会产生 reservation；Gateway 定向回归当前为 `88/88`，脚本语法与差异检查通过。
- 追加收紧：生产环境只有能力目录明确写入 `streaming=true` 的协议才允许流式请求；Gateway 始终向 New API 注入 `stream_options.include_usage=true`，并以真实终端 usage 结算。未完成公网 SSE 验收前，目标实例不能把该能力标为生产可售。
- 当前不能宣称“所有功能真实完成”：Gateway 公网可达但仍是开发 HTTP 栈，远端上游 Token/能力目录为空；Casdoor 应用仍缺精确 callback/scopes，短信登录与微信 Provider 未配置；公网 SSE 和 Casdoor JWT→Gateway→New API→OpenBuddy 积分链路没有当前周期的生产证据。
- 当前完成度按证据而非代码行估算：核心代码与本地回归约 `85%`；New API 独立 Chat/Token 真实闭环约 `90%`；完整企业生产交付约 `65%`。Gateway 公网部署已验证，但仍受 Provider、远端上游 Token/能力目录、真实身份登录、支付/对账和生产 HTTPS 阻塞，不能用本地测试替代。

## 2026-08-30 远端 Gateway 开发栈复核（05:22 Asia/Shanghai）

- 远端 `/opt/service/openbuddy` 的开发/集成栈已启动，容器 `openbuddy-postgres-1` 和 `openbuddy-resource-gateway-1` 均为运行状态，Gateway 健康状态为 `healthy`，日志确认监听 `0.0.0.0:8787` 且使用 `postgres` 存储。
- 在目标主机内访问 `http://127.0.0.1:8787/healthz` 与 `/readyz` 均返回 HTTP `200`，未携带 Bearer 访问租户模型接口返回稳定 `401 AUTHENTICATION_REQUIRED`。这证明网关进程、SQL 持久化和未授权门禁正常。
- 目标主机内端口映射为 `0.0.0.0:8787`，但外部访问 `http://124.221.146.145:8787/healthz` 超时；UFW 未启用，主机端口已监听，剩余阻断位于云厂商安全组/上游防火墙。未直接修改云防火墙规则，也未将该开发端口当作生产入口。
- 由于目标云主机已确认放行 `8787` 入站，开发/集成栈恢复使用 `8787:8787` 绑定以支持当前联调；该编排仍只适合开发验证，生产必须使用 `docker-compose.production.yml` 的 Caddy HTTPS 入口并关闭直接暴露的 `8787`。
- 本次未取得有效 New API 管理会话或 Casdoor 用户 JWT，因此没有执行 Token 创建、模型调用、积分结算或三方端到端写入；此前远端容器健康证据不等于完整商业闭环完成。

## 2026-08-30 公网 Gateway 复核（05:25 Asia/Shanghai）

- 按云主机已放行 `8787` 的前提重新创建远端开发/集成栈，公网 `http://124.221.146.145:8787/healthz` 与 `/readyz` 均返回 HTTP `200`；主机内日志确认 Gateway 使用 PostgreSQL，容器状态为 `running/healthy`。
- 公网未携带 Bearer 访问 `/v1/tenants/demo/ai/models` 返回 HTTP `401`、错误码 `AUTHENTICATION_REQUIRED`，说明公网路由已到达 Gateway 且认证门禁生效。
- 远端 `.env.remote-dev` 中 `NEW_API_TOKEN`、`NEW_API_GROUP_TOKENS_JSON` 和 `NEW_API_CAPABILITIES_JSON` 均为空，因此当前实例只能做健康/认证验收，不能进行模型发现或积分结算；没有把任何上游密钥写入仓库或日志。
- 使用一次受控管理员登录尝试获取临时 New API Token 时，目标实例返回 HTTP `429 AUTH_SESSION_ISSUANCE_LIMIT`；脚本未重试、未创建 Token、未调用模型，也未产生远端残留。需要管理员稍后提供短期会话或解除登录会话限流后，才能继续三方闭环。
- 证据更新后的估算为：核心代码与本地回归约 `85%`；New API 独立能力约 `90%`；完整企业生产交付约 `65%`。公网 Gateway 部署已从阻塞项移出，但 Casdoor callback/scopes、短信/微信 Provider、New API 专用 Group Token/能力目录、真实 Casdoor JWT 和支付/对账生产配置仍未验收。

## 2026-08-30 最新只读审计（05:36 Asia/Shanghai）

- New API `/api/status` 返回 HTTP `200`，版本 `v1.0.0-rc.22`，`quota_per_unit=500000`；无 Bearer 请求 `/v1/models` 仍返回 HTTP `401`。
- Casdoor Discovery/JWKS 返回 HTTP `200`；`scripts/diagnose-casdoor-app.sh` 诊断 OpenBuddy 应用仍为 `callback=missing; scopes=missing; verification_code=disabled; sms=none; wechat=none`。
- 公网 Gateway `/healthz` 与 `/readyz` 均返回 HTTP `200`；企业审计脚本确认 Gateway health/ready 通过，未授权租户模型接口门禁通过。
- 远端开发环境的 `NEW_API_TOKEN`、`NEW_API_GROUP_TOKENS_JSON`、`NEW_API_CAPABILITIES_JSON` 仍为空；因此不能将历史 Token `id=30` 的独立 New API 证据表述为当前 Gateway 三方闭环。

## 2026-08-30 追加复核（05:01 Asia/Shanghai）

- New API 管理会话限流已恢复。本次只执行一轮受控写入验收：创建短期低额度 Token `id=30`，发现 `MiniMax-M3`，执行非流式 Chat Completions，响应包含真实 usage（prompt `181`、completion `8`、total `189`）。
- 同一轮对 Completions、Responses、Embeddings、Rerank 分别执行验证，目标 MiniMax channel 均返回稳定的“不支持”错误（HTTP `500`，分别包含 `unsupported relay mode: 2`、`not implemented`、`unsupported relay mode: 3`、`unsupported relay mode: 32`）；脚本按能力矩阵将其判定为预期不支持，不进入商业计费目录。
- Token usage 查询返回 `total_granted=99969`、`total_available=99969`；New API 当前版本的 `total_used` 仍为 `0`，不能单独作为财务凭证，真实 usage 和 quota 变化才是本轮证据。
- 脚本退出清理阶段删除 Token `id=30`，并在 Token 列表中复核不存在；没有残留测试 Token。上游密钥、管理员 access token 和 Cookie 均未写入仓库或日志。
- 这只证明 New API 独立 Token → MiniMax-M3 Chat/usage → 删除闭环当前通过；由于远端 Gateway 尚未配置 Token/能力目录、Casdoor Application 仍缺 callback/scopes/SMS/WeChat，本轮不能升级为 Casdoor → Gateway → New API → OpenBuddy 积分的三方生产闭环。
- 随后尝试用同一受控脚本补验 SSE `include_usage`，目标 New API 再次返回 `HTTP 429 AUTH_SESSION_ISSUANCE_LIMIT`；脚本未重试、未创建 Token、未调用模型、未产生残留。因此当前周期的 SSE 仍不能标记为公网新证据，脚本能力已加入仓库并通过 shell 语法校验。

## 2026-08-30 追加复核（02:05 Asia/Shanghai）

- New API 管理登录再次只执行一次，返回 `HTTP 429 AUTH_SESSION_ISSUANCE_LIMIT`；未重试、未创建 Token、未调用模型、未产生远端残留。
- 只读审计仍为：New API `/api/status` `200`（`v1.0.0-rc.22`，`quota_per_unit=500000`），未授权 `/v1/models` `401`，Casdoor OIDC discovery/JWKS `200`；Casdoor Application 前置条件仍为 `callback=false; scopes=false; verification_code=disabled; sms=0; wechat=0`。
- Resource Gateway `http://124.221.146.145:8787/healthz` 与 `/readyz` 已可达并返回 `200`，但远端未配置 New API Token/能力目录，因此当前周期仍不能新增公网 Casdoor JWT → Gateway → New API → 积分闭环证据。
- 本地新增 MiniMax 提供商预设（`https://api.minimaxi.com/v1`、`MiniMax-M3`）并修复 `minimax-*` 配置重载后的类型识别；TypeScript 检查通过，Gateway/Electron/Worker 定向测试 `64/64` 通过。对应提交：`d9afe38`、`6ad6b0f`。
- 官方 New API 文档已复核：管理面登录支持 Session 或 Access Token；多节点部署以共享数据库为权威，Redis 只负责会话/限流传播，不能替代数据库。OpenBuddy 继续不接入 Redis adapter。

## 继续复核（本周期此前状态）

- New API `/api/status` 仍为 `HTTP 200`，版本为 `v1.0.0-rc.22`；未授权 `/v1/models` 仍为 `HTTP 401`。
- Casdoor Discovery 仍为 `HTTP 200`，JWKS 与 OIDC scopes 可读取；应用诊断仍未满足 callback、scopes、短信和微信 Provider 前置条件。
- Gateway `124.221.146.145:8787/healthz` 与 `/readyz` 连接超时。
- 管理登录在 05:01 之前曾返回 `HTTP 429 AUTH_SESSION_ISSUANCE_LIMIT`；当时没有重试、写入或残留。
- 05:01 后限流窗口恢复，当前周期的独立 Token 创建 → `MiniMax-M3` usage → 删除证据已补录在本文“当前周期 New API 闭环”章节；该证据仍不包含 Gateway 积分结算。

## 代码审计追加

- 复核 Gateway 计费主体边界：普通 `reserve`、`settle`、`release` 和 AI 代理均使用已验签 Casdoor JWT 的 `sub`；只有受保护的积分/账单管理员接口可以为其他主体发放或创建订单，未发现客户端可通过请求体伪造普通调用主体的路径。
- 修复 New API 对账 Worker 的管理身份头：不再发送硬编码的 `new-api-user: 1`，生产运行必须提供当前管理员的 `NEW_API_ADMIN_USER_ID`，并可配合短期 `NEW_API_ADMIN_SESSION_ID` 使用。Worker 回归测试现为 `7/7`，相关定向回归为 `65/65`。
- 代码提交：`7d8b8f6`（验收脚本）与 `e53b3e5`（对账 Worker）。这些提交改善了真实验收可靠性，但不改变远端 Gateway、Casdoor Provider 和 New API 会话限流的未完成状态。
- 新增 Gateway 计费主体隔离回归：普通成员只能读取自己的余额，读取其他成员余额、为其他主体发放积分和创建他人订单均返回 `403 CREDIT_PERMISSION_DENIED`；相关 Gateway 定向回归现为 `49/49`，本轮 Gateway 全套回归合计 `88/88`。
- 使用临时占位环境变量执行生产 Compose 静态渲染验证，`scripts/validate-production-compose.sh` 通过且未启动容器、未连接真实数据库或远端服务；仓库没有提交 `.env.production`，因此这不是目标服务器部署证据。
- 增强生产 Compose 门禁：现在拒绝缺失默认 Group、占位 Group Token（`replace-with`/`placeholder`/`example`）和能力目录日期占位符；正向临时配置通过，三组负向配置均以非零状态拒绝。
- 进一步要求 Token 映射与能力目录的 Group 集合完全一致，并拒绝长度不足 32 的 HMAC/数据库密钥；正向配置、Group mismatch 和短密钥负向场景均已验证。
- 将同等门禁下沉至 Gateway 运行时：生产拒绝 HTTP New API 上游、弱/占位 Group Token、Group 集合不一致和弱签名密钥；因此目标实例当前使用的 HTTP 地址只能用于只读诊断，不能作为生产 Gateway 配置。

## 本轮代码变更

- Gateway 租户策略写入未配置的 New API Group 时返回 `400 NEW_API_GROUP_NOT_CONFIGURED`，避免首次 AI 请求才暴露配置错误。
- 积分 `grant`、显式 `reserve`、`settle/release` 和 AI 内部预扣对幂等键执行参数一致性校验；同一幂等键复用到不同金额、模型或 token 参数时返回 `409 CREDIT_IDEMPOTENCY_CONFLICT`。
- 支付回调的 `paid` 状态现在必须携带支付流水号和支付渠道；同一渠道中的流水号不能归属多个订单，避免跨订单重放导致重复入账。新增 `BILLING_PAYMENT_ID_REQUIRED`、`BILLING_PAYMENT_CHANNEL_REQUIRED` 与 `BILLING_PAYMENT_REPLAY_CONFLICT` 回归覆盖。
- Gateway 全量测试 `80/80` 通过；严格 TypeScript 检查、Worker/验收脚本语法检查和 `git diff --check` 通过。

## 本次继续核验

- 官方 New API 文档索引 `https://docs2.newapi.pro/en/llms-full.txt` 可访问，明确区分 AI Model APIs 与 Management APIs；管理面包含 User、Channel、Model、Token、Payment、Logs、Statistics、Tasks、Groups，AI 面包含 Models、Chat、Completions、Embeddings、Rerank、Moderations、Audio、Realtime、Images 和 Video。OpenBuddy 只把已验证且有真实 usage 的协议纳入可计费能力目录。
- `http://124.221.146.145:3000/api/status` 仍返回 HTTP `200`，实例版本 `v1.0.0-rc.22`、`quota_per_unit=500000`、`oidc_enabled=false`、`wechat_login=false`、`password_login_enabled=true`；无 Bearer 的 `/v1/models` 仍返回 HTTP `401`，证明模型面要求 Token。
- 使用用户提供的管理员账号执行一次受控闭环脚本时，登录接口曾返回 HTTP `429 AUTH_SESSION_ISSUANCE_LIMIT`。该次脚本未重试、未创建 Token、未调用模型、未留下远端临时资源；随后限流恢复并完成了下方 05:01 的当前周期闭环。
- 企业闭环脚本已支持注入短期 `NEW_API_ADMIN_ACCESS_TOKEN` + `NEW_API_ADMIN_SESSION_ID` 复用既有管理员会话；复用路径仍强制 `VERIFY_NEW_API_WRITE=1`，不会主动注销或泄露会话，也不会再次触发登录限流。当前本机没有仍有效的管理员会话可复用，历史 Cookie 只读探针返回 `401 AUTH_UNAUTHORIZED`。
- 使用本地隔离 mock 服务验证了脚本复用会话路径的完整顺序：创建临时 Token → 获取 key → `MiniMax-M3` 模型发现 → Gateway Chat 返回真实 usage 形状 → 积分消费与对账 → 删除 Token → 列表确认不存在。该结果只证明验收脚本和协议编排，不计入公网生产闭环通过数。
- `http://124.221.146.145:8787/healthz`、`/readyz` 及根域 `/healthz` 仍不可连接，无法证明公网 Casdoor JWT → OpenBuddy Gateway → New API → 积分账本生产闭环。
- 新增只读审计脚本 `scripts/audit-enterprise-closed-loop.sh`：输出机器可读 JSON，检查 New API 状态/未授权模型面、Casdoor discovery/JWKS/Application 前置条件和 Gateway health/ready；不携带密码、不创建 Token、不修改远端配置。本次运行结果为 New API 状态与鉴权、Casdoor discovery/JWKS 通过，Casdoor Application 前置条件和 Gateway 两个探针阻塞。
- 审计脚本默认使用当前 OpenBuddy 应用真实公开 `clientId=005d6839fe25abd6696f`；传入错误的 `openbuddy` 会得到 Casdoor `Invalid client_id`，不能据此判断应用配置缺失。

## 远端只读验证

目标 New API：`http://124.221.146.145:3000`

- `/api/status` 返回 HTTP `200`。
- 当前版本：`v1.0.0-rc.22`。
- `quota_per_unit=500000`。
- `oidc_enabled=false`、`wechat_login=false`、`password_login_enabled=true`。
- 未携带 Token 请求 `/v1/models` 返回 HTTP `401 Invalid token`，说明 API 鉴权仍生效。

历史只读审计（使用真实 OpenBuddy client ID）曾显示 Gateway 不可达；该状态已被 05:25 后的公网复核取代。当前 Casdoor 应用诊断仍为 `callback=false; scopes=false; verification_code=disabled; sms=0; wechat=0`，目标主机的 `80/443` 仍不是已验收的 OpenBuddy HTTPS 入口。

目标 Resource Gateway：`http://124.221.146.145:8787`

- `/healthz` 与 `/readyz` 当前均返回 HTTP `200`；未授权模型接口返回 HTTP `401 AUTHENTICATION_REQUIRED`，已确认公网 Gateway 实例存在。
- 因远端未配置 New API Token/能力目录且没有有效 Casdoor 用户 JWT，本轮不能进行 Casdoor JWT → Gateway → New API → OpenBuddy 积分的生产端到端验收。
- 使用真实目标地址运行 `scripts/deploy-doctor.sh` 的历史结果仍保留为部署前基线；本次公网复核直接验证 Gateway `/healthz`、`/readyz` 和未授权模型接口，结果分别为 `200`、`200`、`401`。Prometheus、租户健康面和生产 HTTPS 尚未验收。

## 真实写入验收结果

### 当前周期 New API 闭环（05:01）

本轮真实执行结果为：

```text
Temporary token: created (id=30)
Models: discovered (selected=MiniMax-M3)
Chat: HTTP 200, usage=present, prompt_tokens=181, completion_tokens=8, total_tokens=189
Completions: expected unsupported relay mode: 2
Responses: expected not implemented
Embeddings: expected unsupported relay mode: 3
Rerank: expected unsupported relay mode: 32
Cleanup: deleted and verified absent (id=30)
```

上述 Token 创建、模型调用、usage、能力边界和删除均来自同一轮运行；该证据不包含任何凭据。

本轮使用用户提供的 New API 管理凭据执行一次受控登录，目标是创建短期测试 Token、调用 `MiniMax-M3`、读取真实 usage、删除 Token 并复核列表。登录接口返回：

```text
HTTP 429 AUTH_SESSION_ISSUANCE_LIMIT
```

脚本未重试、未创建 Token、未产生远端残留。由于没有取得短期管理员会话，本轮不能把 Token 创建/删除闭环标记为新近通过；此前 2026-08-29 的 Token `29` 创建、Chat/usage、删除和列表复核证据仍保留在 `docs/enterprise-live-verification-2026-08-29.md`。

本次继续执行同一验证脚本后仍返回 `HTTP 429 AUTH_SESSION_ISSUANCE_LIMIT`；脚本没有重试、没有创建 Token、没有调用模型，也没有产生远端残留。

## 当前结论

## 2026-08-30 最新复核（05:40 Asia/Shanghai）

- 只读企业审计再次确认：New API `/api/status`、Casdoor Discovery/JWKS、Gateway `/healthz` 和 `/readyz` 均通过；Gateway 未授权租户模型请求继续返回 `401`。
- Casdoor OpenBuddy 应用仍缺 callback、OIDC scopes、Verification Code、SMS Provider 和 WeChat Provider；本轮未修改 Casdoor 服务端。
- 浏览器没有可复用的 New API 管理会话；本轮没有再次提交登录请求、创建 Token 或调用模型，远端 `.env.remote-dev` 的三个 New API 上游变量继续为空。

- New API 独立服务：公开状态与鉴权可验证；历史受控 Token `id=30` 的创建、MiniMax-M3 usage、能力边界和删除验收通过，但当前管理员会话仍受 `AUTH_SESSION_ISSUANCE_LIMIT` 限制，当前远端 Gateway 尚未配置专用 Token。
- OpenBuddy Gateway 代码：积分账本、幂等预扣/结算/释放、订单支付回调、退款、租户 Group 隔离和成本对账代码已通过本地测试。
- Casdoor + Gateway + New API 生产闭环：未完成；公网 Gateway 已可达且认证门禁通过，但远端未配置 New API 专用 Token/能力目录，且尚未取得 Casdoor 用户 JWT 和有效 New API 管理会话。
- Casdoor 短信/微信/OIDC Electron callback：仍需远端 Application callback、scopes、Verification code、SMS Provider 和 WeChat Provider 配置，不能由仓库代码单独证明完成。

## 继续验收前置条件

1. 将开发栈替换为生产 HTTPS Caddy 入口，保留 PostgreSQL 持久化并关闭直接暴露的 `8787`。
2. 在 New API 创建按 Group 隔离的专用 Token，生成并安装已真实验证的 `NEW_API_CAPABILITIES_JSON`，再验证模型发现、真实 Chat usage 和删除/轮换流程。
3. 取得 Casdoor 短期测试用户 JWT，验证租户策略、余额不足、SSE 结算、上游失败释放、成员撤销和对账导入。
4. 配置 Casdoor 精确 callback/scopes、SMS Provider、WeChat Provider；生产 Worker 先 dry-run，再用 HMAC 导入真实 New API 日志成本。

## 当前工作区验证补充

- Gateway 全套 Vitest：`6` 个测试文件、`88/88` 通过；Worker 测试 `7/7` 通过；Casdoor/Electron 定向测试 `27/27` 通过。
- Gateway 计费安全回归新增客户端断开场景：下游连接销毁后上游请求收到 abort，reservation 释放，账户 `reserved=0` 且没有 `consume` 流水；这只证明本地服务行为，不替代公网 Gateway 验收。
- Gateway Docker 默认镜像和 `INCLUDE_SQL_DRIVERS=true` 的 PostgreSQL/MySQL 生产变体均已真实构建通过；默认镜像启动后 `/healthz` 与 `/readyz` 均返回 HTTP `200`。这证明独立容器构建链路可用，但不等于公网实例已部署。
- 使用显式 `linux/amd64` 隔离栈启动 PostgreSQL 16 与 SQL Gateway，Gateway 日志确认 `store=postgres`，`/healthz` 和 `/readyz` 均返回 HTTP `200`；这证明生产 SQL 适配器可初始化，但不等于目标公网主机已部署。
- `pnpm test` 仍有两个既有 `packages/renderer/openbuddy-renderer-host/src/index.test.ts` 失败（分组子依赖加载、增量依赖加载），与本轮支付/积分/对账改动无关；本轮未修改该模块。
- 直接执行 Gateway `pnpm build` 在当前工作树仍因 `services/casdoor-resource-gateway/node_modules/@types/node` 链接指向失效路径而失败；网关严格 TypeScript 检查使用仓库内实际 Node 类型路径后通过。Docker 使用独立 npm 安装依赖，因此生产构建不受该本地链接问题影响。

## 2026-08-30 最新真实复核（New API / Casdoor JWT / 公网 Gateway）

- New API `http://124.221.146.145:3000` 本轮重新完成一次受控独立闭环：临时 Token `id=31` 创建并列出确认，`MiniMax-M3` 非流式 Chat 返回 HTTP `200` 和完整 usage `181/8/189`，SSE Chat 返回 HTTP `200` 和完整 usage `181/8/189`；Completions、Responses、Embeddings、Rerank 分别返回当前渠道已知的 `unsupported relay mode: 2`、`not implemented`、`unsupported relay mode: 3`、`unsupported relay mode: 32`；Token `31` 已删除并复核列表中不存在。
- 本轮还创建过临时 Token `32`、`33`、`34`、`38`、`39`、`40` 用于能力目录生成、远端注入和清理演练；所有这些临时 Token 均已在退出清理或显式删除后复核不存在。它们没有被计入公网积分 Chat 成功证据：部分尝试在 Gateway 请求前因远端配置传输/环境恢复失败退出。
- Casdoor password grant 本轮真实取得短期 JWT；JWT 的 `iss=http://124.221.146.145:8000`、`aud=[005d6839fe25abd6696f]`、`sub` 和 `owner=built-in` 可解析，JWKS 签名链路可用。首次公网 Gateway 请求返回 `INVALID_TOKEN` 的根因是远端 `CASDOOR_AUDIENCE` 仍为默认 `openbuddy`，与真实 client ID 不一致；将 audience 改为 `005d6839fe25abd6696f` 后，Gateway `/v1/tenants/built-in/credits` 返回 HTTP `200`，证明 Casdoor JWT → Gateway 的 audience 配置问题已定位并修复。
- 为防止同类错配，`scripts/configure-gateway-remote-dev.sh` 现在要求显式提供 `CASDOOR_AUDIENCE`，并与短期 New API Token、能力目录一起原子写入远端环境；`docs/deployment-guide.md` 已明确禁止使用默认 `openbuddy` 代替实际 Casdoor client ID。
- 远端开发 Gateway 在配置演练期间曾因手工环境传输错误短暂重启；已恢复 Postgres 用户密码、`CASDOOR_ISSUER`、正确 `CASDOOR_AUDIENCE` 和空的 New API 上游配置。恢复后的公网 `/healthz` 与 `/readyz` 均返回 HTTP `200`，当前没有把已删除 Token 留在远端配置中。
- **本轮仍不能宣称完整三方商业闭环完成**：没有一条当前轮次的证据同时证明“公网 Gateway 使用真实 Casdoor JWT → 发现 MiniMax-M3 → Chat 返回 usage → OpenBuddy 积分 reserve/settle → ledger/reconciliation 成功”。失败尝试均已清理 Token，不能用健康检查或本地 `88/88` 测试替代该证据。
- Casdoor Application 的 `casdoor://localhost/callback`、OIDC scopes、Verification Code、SMS Provider、WeChat Provider 仍未配置；短信、微信和 Electron OIDC 回调仍未完成真实端到端验收。New API 生产 Token/能力目录也已清空，公网 Gateway 当前只能做健康和认证门禁检查。

## 2026-08-30 最新公网闭环（06:48 Asia/Shanghai）

- New API 临时 Token `id=53` 已真实创建、列表确认并取回 key；使用 `MiniMax-M3` 生成能力目录，Gateway 远端配置脚本原子写入并等待 `/readyz` 就绪。
- 使用真实 Casdoor password-grant JWT（`iss`、`aud`、`sub` 经过校验）调用公网 Gateway：租户 `built-in` 积分发放 `5000`、模型发现、Chat usage `prompt=181 / completion=8 / total=189`、预扣、结算、账本消费和 reconciliation 均通过；最终 `lifetimeConsumed=2`、`reconciliationRequests=1`、New API request id 已落账。
- 真实 Token `id=53` 已删除，并通过 New API Token 列表复核不存在；远端 Gateway 上游 Token、Group Token JSON 和能力目录已清空，重启后 `/healthz` 与 `/readyz` 均返回 `200`，临时 SSH 公钥计数为 `0`。
- 本轮闭环证明 Casdoor JWT → Resource Gateway → New API → OpenBuddy 积分 reserve/settle/ledger/reconciliation 已真实打通；它不证明短信/微信 Provider、生产 HTTPS、支付渠道和外部成本 Worker 已完成。
- 当前证据完成度更新为：核心代码与本地回归约 `85%`；New API 独立能力约 `95%`；公网三方核心闭环 `100%`（当前验证租户/模型范围）；企业生产商业化约 `75%`。短信/微信、Casdoor callback/scopes、支付实接、HTTPS 和多租户生产验收仍是上线门槛。

## 2026-08-30 服务 Token 持续部署与再次闭环（07:15 Asia/Shanghai）

- 修复 `scripts/configure-gateway-remote-dev.sh` 的远端参数传递缺陷：原实现向 Python 传入了多余的 `--`，随后又因列表推导变量作用域错误无法更新 `.env.remote-dev`；现改为按现有变量名显式替换，保留标准输入传输和原子文件替换。
- 在 New API `v1.0.0-rc.22` 创建 Gateway 专用服务 Token `id=57`，TTL 约 30 天；仅将 key 注入远端 Gateway `.env.remote-dev`，文件权限 `0600`，未写入仓库、日志或桌面端。该服务 Token 不作为临时删除验收对象，生产上线前仍应迁移到 Secret Manager 并轮换。
- 使用真实 Casdoor OIDC password-grant JWT（`aud=005d6839fe25abd6696f`、`owner=built-in`、`openbuddy-admin`）再次验证公网 Gateway：模型发现、非流式 Chat、SSE Chat、真实 usage、积分 reservation/settle、ledger 和 reconciliation 均通过；结果为 SSE HTTP `200`、`reserved=0`、`lifetimeConsumed=10`、本轮闭环输出 `lifetimeConsumed=8`、`reconciliationRequests=4`。
- Gateway 远端配置复核：`CASDOOR_AUDIENCE`、Group、Token 和能力目录均已写入；不输出秘密，仅确认 Token 长度和能力目录存在。临时 SSH 公钥已从 `authorized_keys` 撤销，本地私钥已移出工作路径。
- 本轮仍不等于生产完成：远端仍是 HTTP 开发栈；Casdoor callback/scopes、短信/微信 Provider、多租户生产矩阵、支付、429/超时/取消失败演练、Secret Manager 与 HTTPS 仍未验收。New API 专用服务 Token `id=57` 也需在正式上线前轮换。

## 2026-08-30 最新源码公网复核（07:14 Asia/Shanghai）

- Gateway 已使用包含实时 SSE 透传修复的最新源码重建；本地延迟分帧回归由 `88/88` 增至 `89/89`，证明已验证 `streaming=true` 的能力会先发送首帧，再等待末帧 usage 完成结算；未验证流式能力仍安全缓冲并拒绝无 usage 响应。
- 真实 Casdoor JWT 的模型发现和能力目录再次通过：`built-in/default` 返回 `deepseek-v4-flash`、`deepseek-v4-pro`、`MiniMax-M3`，`healthz/readyz` 均为 `200`。
- 使用现有 Gateway 服务 Token `id=57`（未创建新 Token）完成最终公网 Chat/SSE 闭环：MiniMax-M3 usage `prompt=181`、`completion=8`、`total=189`，SSE HTTP `200`，`reserved=0`，本轮输出 `lifetimeConsumed=12`，`reconciliationRequests=6`；New API request id 已写入账本。服务 Token 仍留在远端开发环境供联调，正式生产必须迁移 Secret Manager 并轮换。
- 本轮一次性部署 SSH 公钥已撤销，本地私钥已清理；未输出任何 Token、密码或上游密钥。

## 2026-08-30 当前轮次复核（07:30 Asia/Shanghai）

- 只读企业审计再次通过 New API `/api/status`、未授权 `/v1/models`、Casdoor OIDC Discovery/JWKS 和 Gateway `healthz/readyz`；Casdoor Application 仍为 `callback=false; scopes=false; verification_code=disabled; sms=0; wechat=0`。
- New API 独立受控验收使用临时 Token `id=58`：真实创建、模型发现、MiniMax-M3 非流式 Chat usage `181/8/189`、SSE usage `181/8/189`、Completions/Responses/Embeddings/Rerank 已确认当前渠道不支持，随后删除并复核不存在。
- 企业闭环使用临时 Token `id=59`：真实 Casdoor password-grant JWT（全局管理员、`owner=built-in`）调用公网 Gateway，模型发现、非流式 Chat、SSE Chat、真实 usage、积分 reservation/settlement、`reserved=0`、ledger 中的 New API request id 和 Token 删除确认均通过。本轮 Gateway 输出 `lifetimeConsumed=16`，SSE 后为 `18`；不记录 Token、密码或 JWT。
- 真实商业接口验收通过：Free 套餐查询、订单创建、订单显式过期收敛；对已知未支持的 Responses 请求返回 `501 NEW_API_PROTOCOL_UNSUPPORTED`，未将其计入消费。
- New API 对账 Worker 真实 dry-run 读取 `/api/log/` `6` 条记录，解析 `quotaPerUnit=500000`，映射 `1` 个 `built-in` 租户，输出 `imported=0`、`duplicates=0`，没有执行 Gateway 写入。远端开发 `.env.remote-dev` 的 `RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET` 当前缺失，因此 Gateway 报告仍为 `external.source=not-imported`；外部成本导入/匹配不计为完成。
- 加强验收可靠性：Gateway 对账报告新增 `external.matchedRequestIds`；`VERIFY_EXTERNAL_RECONCILIATION=1` 现在必须匹配本次 `newApiRequestId`，不能用历史外部记录数量冒充当前请求成本对账。
- 由于本轮 Casdoor JWT 是全局管理员，公网结果不能证明普通成员的跨租户隔离；真实 Organization/普通成员矩阵、成员撤销和多副本故障演练仍未完成。

## 2026-08-30 外部成本导入闭环（当前开发集成，07:45 Asia/Shanghai）

- 为远端开发 Gateway 生成一次性随机 `RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET`，通过一次性 SSH 公钥写入 `/opt/service/openbuddy/.env.remote-dev`，容器以当前源码重建；一次性公钥随后已撤销，密钥值未输出、未写入仓库。
- Worker 使用真实 New API 管理会话读取 `/api/log/`，解析 `quotaPerUnit=500000`，映射 `built-in` 租户并以 `NEW_API_RECONCILIATION_WRITE=1` 导入 `6` 条记录，`duplicates=0`。
- Gateway 对账报告真实返回 `external.source=new-api-import`、`records=6`、`provider-reported-quota=6`、`totalCost=0.000372`、`matchedRecords=2`、`unmatchedRecords=4`，并返回 `matchedRequestIds` 数组；因此当前开发集成的 New API usage→成本→OpenBuddy ledger 对账链路通过。
- 该结果不等于生产财务完成：当前成本来自 New API `quota` 按实例 `quota_per_unit` 转换，仍需生产 Secret Manager、正式 USD/CNY 成本定义、持续 Worker 调度、财务系统对账和多租户成本映射。

> 07:30 条目记录的是 HMAC 尚未配置时的状态；07:45 的开发集成复核已完成 HMAC 写入、源码重建和成本导入，后者是当前状态。

## 2026-08-30 New API 日志读取兼容性修复（当前轮次）

- 对照 New API 当前公开源码，`GET /api/log/` 的分页参数使用 `p` + `page_size`；Worker 已从旧的 `size` 参数切换为 `page_size`，并保留最多 100 条的服务端限制。
- Worker 对非 2xx 响应保留脱敏的 JSON 错误摘要；不会输出 access token、session、Cookie、prompt 或上游密钥。启用会话校验的实例必须注入登录响应 `data.session.sid` 到 `NEW_API_ADMIN_SESSION_ID`。
- 使用目标实例短期管理员会话执行只读 dry-run：滚动 60 分钟窗口读取成功，`fetched=0`、`writeEnabled=false`、`quotaPerUnit=500000`；历史窗口 `2026-08-29T00:00:00Z` 至 `2026-08-30T00:00:00Z` 读取 `75` 条、全部解析、映射 `1` 个租户，仍未写入 Gateway。
- 本轮本地验证：Worker 定向测试 `8/8`，全量 Vitest `130` 个文件、`1369` 个测试通过（`1` 个跳过），Gateway TypeScript 检查和 OpenAPI 解析通过；未执行生产写入。

## 当前轮次：AI 幂等与计费安全修复

- Gateway 不再把显式提供但格式错误的 `idempotency-key` 静默降级为随机 request ID；`idempotency-key` 与兼容头 `x-idempotency-key` 同时出现不同值，或任一值不符合 8-160 位约束时，统一返回 `400 INVALID_AI_IDEMPOTENCY_KEY`。
- 新增回归验证：非法/冲突幂等键在预扣前被拒绝，账户 `reserved=0`、`lifetimeConsumed` 不变，且不会向 New API 发起请求；合法幂等键的并发合并与重复响应行为保持不变。
- 本轮验证：Gateway 全量 `7` 个测试文件、`124/124` 通过；Gateway TypeScript 检查、OpenAPI 解析、`git diff --check` 和商业模型审计通过。提交 `9ac802d` 已部署到 `/opt/service/openbuddy` 的 HTTP 开发联调栈，公网 `/healthz` 返回 `version=9ac802d`、`store=postgres`，`/readyz` 返回 `200`；生产 HTTPS、Secret Manager、Casdoor Provider 和普通成员多租户矩阵仍未验收。

## 当前轮次：共享钱包过期计费修复

- 修复 AI 预扣路径：共享钱包现在与个人账户一样，在检查可用积分前执行 FIFO 过期收敛；已过期团队积分会返回 `402 INSUFFICIENT_CREDITS`，不会调用 New API。
- 修复账本归属：共享钱包产生的 `expire` 流水现在保留 `walletId`，钱包余额、钱包账本和账期对账保持一致。
- 新增真实服务回归：共享钱包积分过期后 AI 请求不产生 reservation/consume 或上游请求，并验证 `lifetimeExpired` 与钱包 `expire` 流水；定向 Gateway 测试 `80/80`、全量 Gateway 测试 `125/125` 通过。提交 `891dc14` 已部署到 `/opt/service/openbuddy` HTTP 开发联调栈，公网 `/healthz` 返回 `version=891dc14`、`store=postgres`，`/readyz` 返回 `200`；生产 HTTPS、Secret Manager、Casdoor Provider 和普通成员多租户矩阵仍未验收。
