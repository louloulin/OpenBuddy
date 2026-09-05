# New API × Casdoor × OpenBuddy 集成方案

更新时间：2026-08-30（实时复核）

## 官方文档能力核对（2026-08-30）

官方文档索引 `https://docs2.newapi.pro/en/llms-full.txt` 将 New API 分为两类：AI Model APIs（模型、Chat、Completions、Embeddings、Rerank、Moderations、Audio、Realtime、Images、Video）和 Management APIs（系统、用户认证/管理、2FA、OAuth、渠道、模型、Token、兑换码、支付、日志、统计、任务、分组、供应商、安全验证）。OpenBuddy 的集成边界如下：

1. Casdoor 是身份、Organization/租户、成员和 RBAC 的事实源。
2. OpenBuddy Resource Gateway 是租户策略、产品积分账本、订单状态机和服务端 New API 凭据注入的事实源。
3. New API 是模型路由、渠道、Group、Token、上游 usage 和成本日志的执行层；其管理 API 凭据只交给独立对账 Worker，不能进入 Renderer。
4. 对每个 Group/模型/协议分别登记 `supported`、`streaming` 和 `usage`，没有真实 usage 的协议不能进入生产计费目录；New API 文档中存在的协议不等于当前渠道已实现。
5. 商品毛利按输入和输出 token 方向分别计算保守下限，不使用混合请求的平均值掩盖某一方向的亏损；不可售模型不会生成生产报价、积分 reservation 或 New API 请求。
6. OpenBuddy 每次 AI 请求都可携带 `x-openbuddy-agent`、`x-openbuddy-session` 和可选的 `x-openbuddy-wallet`；Gateway 会校验格式与钱包权限、写入不可变消费流水，并向 New API 追加服务端生成的 `x-openbuddy-tenant`、`x-openbuddy-subject`、`x-openbuddy-actor`、`x-openbuddy-request-id`，以及经过校验的 Agent/会话/钱包归属头。租户、主体、Actor、请求 ID 不接受客户端覆盖。成本对账报告同时按成员、模型、Agent/工作流、会话和共享钱包聚合。Worker 从 New API 日志顶层字段或 `other` 元数据导入同样维度，并在请求 ID 已匹配时校验钱包、发起成员、模型和 usage 一致，避免企业 Agent 或共享钱包成本串账。共享钱包中外部成本记录的 `subject` 必须是实际发起成员，不得填钱包 owner 或任意钱包成员；`walletId`、`subject`、`actorSubject` 三者必须与本地消费流水一致。

成本对账的租户归属也必须 fail-closed：Worker 推荐使用 `groups`、`users`、`subjects`、`tokens` 四层映射。日志中的 `token_id`（如有）优先于用户名解析，Gateway 注入的 subject 元数据必须命中 `subjects` 映射，随后校验 Casdoor `tenantId/subject` 与 New API Group/Actor；任一层冲突、缺失或未知 Group/Subject 都跳过导入并输出脱敏原因。这样 New API 的 Group 只是执行与计费倍率边界，Casdoor Organization 仍是 OpenBuddy 的租户事实源，不会因为用户名重复或 Group 漂移而串账。

生产写入模式还会在拉取日志前调用 New API `GET /api/group/`，校验本地 `groups` 映射中的每个 Group 仍存在；`NEW_API_STRICT_TENANT_MAPPING=1` 缺少命名空间或 `NEW_API_VALIDATE_GROUPS=1` 发现漂移时直接退出，不发送任何导入请求。

仓库还提供只读的 `scripts/new-api-capability-snapshot.mjs`：它使用短期管理访问令牌读取 `/api/status`、`/api/group/`、`/api/channel/`、`/api/models/`，可选读取 `/api/log/stat`，输出脱敏快照并对 `NEW_API_EXPECTED_GROUPS/MODELS/CHANNELS` 做漂移检查。New API `v1.0.0-rc.22` 的模型管理接口可能返回空 `items`，而启用渠道会在 `channel.models` 中以逗号分隔字符串返回模型；快照会优先使用模型管理结果，并在为空时从启用渠道补充模型且标记 `source=channel`，避免把已配置模型误判为不存在。该工具不创建、修改或删除 New API 资源；漂移检查失败返回退出码 `2`，适合部署前门禁或定时监控。

本次官方文档核验没有修改远端配置，也没有把文档页面内容当作目标实例能力证明；实例能力仍以 `/api/status`、管理面能力快照、`/v1/models`、真实模型请求和日志对账为准。2026-08-30 的只读快照确认目标实例有 `default`、`vip`、`svip` 三个 Group，启用渠道 `2`（OpenBuddy MiniMax M3，模型 `MiniMax-M3`）和渠道 `1`（deepseek-v4-flash / deepseek-v4-pro），并可读取日志统计键 `quota`、`rpm`、`tpm`；这不替代真实 usage 和成本日志验收。

2026-08-30 受控短 TTL Token 复核确认：MiniMax-M3 Chat 返回完整 usage；deepseek-v4-flash 和 deepseek-v4-pro 返回 `401 Authentication Fails`。OpenBuddy 因此只把 MiniMax-M3 纳入当前商业基线，DeepSeek 被显式标记为不可售，避免把 New API 的库存发现误当成可用模型。

发布前可运行 `OPENBUDDY_CAPABILITY_SNAPSHOT_FILE=/var/lib/openbuddy/new-api-capability-snapshot.json OPENBUDDY_COMMERCIAL_MODEL_CONFIG=deploy/openbuddy-commercial-model.example.json NEW_API_RECONCILIATION_STATUS_FILE=/var/lib/openbuddy/new-api-reconciliation-status.json OPENBUDDY_EXPECTED_GATEWAY_VERSION=<git-short-sha> OPENBUDDY_RELEASE_MODE=production OPENBUDDY_GATEWAY_URL=https://gateway.example.com NEW_API_BASE_URL=https://new-api.example.com CASDOOR_ISSUER=https://casdoor.example.com node scripts/audit-enterprise-release.mjs`。该审计只读取能力快照、商业模型、对账成功状态和 Gateway `/healthz`，不会创建 Token、修改 New API、调用模型或输出任何凭据；生产模式要求 Gateway health 中的运行版本与 `OPENBUDDY_EXPECTED_GATEWAY_VERSION` 完全一致，避免代码已推送但远端仍运行旧版本；开发模式允许缺失外部证据并明确标记为 `blocked`，生产模式对 HTTPS、健康状态、版本一致性、对账新鲜度、能力新鲜度和毛利审计 fail-closed。

官方文档当前将 New API 管理面明确分为系统、用户认证/管理、2FA、OAuth、渠道、模型、Token、兑换码、支付、日志、统计、任务、分组和安全验证；AI 面覆盖模型列表、Chat、Completions、Embeddings、Rerank、Moderations、Audio、Realtime、Images 和 Video。OpenBuddy 只把 New API 作为执行与成本证据层：Casdoor Organization/RBAC 决定租户和身份，Gateway 决定商品积分、预扣/结算和钱包，Worker 使用短期只读管理会话读取日志并 HMAC 导入成本。New API 的内置支付/充值、用户余额和 `quota` 不直接替代 OpenBuddy 商业账本，避免两套余额和退款状态机互相漂移。

### 目标实例只读快照（2026-08-30 20:33，Asia/Shanghai）

通过短期管理员会话运行 `scripts/new-api-capability-snapshot.mjs`，随后注销会话；本次只读过程没有创建、修改或删除 New API 资源。脱敏结果为：

| 项目 | 结果 |
| --- | --- |
| 版本 / 计量单位 | `v1.0.0-rc.22` / `quota_per_unit=500000` |
| 登录能力 | `oidc_enabled=false`、`wechat_login=false`、密码登录开启 |
| Group | `default`、`vip`、`svip` |
| 渠道 | `2: OpenBuddy MiniMax M3 → MiniMax-M3`；`1: deepseek → deepseek-v4-flash, deepseek-v4-pro` |
| 日志统计键 | `quota`、`rpm`、`tpm` |

这证明目标实例的管理面库存和计量单位，不证明 DeepSeek 两个模型已满足 OpenBuddy 的真实 usage、成本和商业售卖门禁；当前生产目录仍只应把已完成真实验收的协议/模型标记为可售。为避免快照过期后继续发布，部署可设置 `NEW_API_CAPABILITY_SNAPSHOT_FILE`、`NEW_API_CAPABILITY_MAX_AGE_HOURS`，并运行 `scripts/validate-new-api-capability-snapshot.mjs`；校验器会拒绝过期快照、`quotaPerUnit` 缺失/无效以及 Group、模型、渠道漂移。

2026-08-30 后续只读复核目标实例 `/api/status` 仍返回 `version=v1.0.0-rc.22`、`quota_per_unit=500000`、`quota_display_type=USD`、`oidc_enabled=false`、`wechat_login=false`、`password_login_enabled=true`。对账 Worker 现在默认强制将显式 `NEW_API_QUOTA_PER_UNIT` 与该运行时值比较；不一致直接阻止成本导入，只有经审批的迁移窗口设置 `NEW_API_ALLOW_QUOTA_UNIT_OVERRIDE=1` 才能例外，避免历史单位误入财务账本。

## 本轮 MiniMax-M3 接入状态

已在 New API `v1.0.0-rc.22` 创建并启用渠道 `OpenBuddy MiniMax M3`（渠道 ID `2`、分组 `default`、上游地址配置为 `https://api.minimaxi.com`、模型 `MiniMax-M3`）。上游凭据已通过 New API 管理台写入，管理台渠道测试已经成功；`/v1/models` 和模型路由已识别该模型。上游密钥未写入仓库或日志，完成本轮验证后仍应立即轮换已在对话中暴露的密钥。

根据 MiniMax 官方按量计费文档，标准服务档 MiniMax-M3（输入不超过 512k）当前价格为输入 `2.10` 元/百万 tokens、输出 `8.40` 元/百万 tokens。New API 文档定义其配额公式为 `(输入 token + 输出 token × CompletionRatio) × ModelRatio × GroupRatio`，且 `1 美元 = 500,000` 配额点。本实例已核验 `ModelRatio=0.14383561643835618`、`CompletionRatio=4`，`/api/pricing` 返回与该换算一致；不要把官方元/百万 token 价格或 OpenBuddy 商品积分价格直接写入 New API 倍率。

## 0. New API 实例真实核验

本次核验目标实例 `http://124.221.146.145:3000/`，实例响应版本为 `v1.0.0-rc.22`。已真实验证渠道配置、模型价格、管理台 MiniMax-M3 测试，以及临时 Token 的创建、列表确认、删除和删除后不存在。没有修改 Casdoor 服务端、New API Group、充值或支付配置。

### 最新复核记录

2026-08-30 的复核确认 `/api/status` 返回 `200`、响应版本为 `v1.0.0-rc.22`，无 Bearer 的 `/v1/models` 返回 `401`。临时 Token `55` 的创建、列表、`MiniMax-M3` 模型发现、Chat usage、删除和删除后不存在已真实完成；本轮另创建 Gateway 服务 Token `57`（约 30 天 TTL），使用其生成已验证 SSE 能力目录并注入远端开发 Gateway。随后使用真实 Casdoor JWT 在公网 Gateway 完成积分发放、预扣、非流式 Chat 与 SSE Chat usage、结算、账本和 reconciliation，Gateway health/ready 仍为 `200`。该证据覆盖 `built-in` 单租户/`MiniMax-M3` Chat/SSE，不等于多租户生产、短信/微信、支付、Secret Manager 或 HTTPS 全部完成。完整边界见 `docs/enterprise-live-verification-2026-08-30.md`。

同日对 Casdoor `admin/openbuddy`（client id `005d6839fe25abd6696f`）进行只读诊断：`redirectUris=[]`、`scopes=[]`、`enableCodeSignin=false`；应用只绑定 `provider_captcha_default`，其类别为 Captcha 且不可登录，未发现可登录 SMS 或 WeChat Provider。该结果由 `scripts/diagnose-casdoor-app.sh` 复核，短信/微信/OIDC 真实登录仍不能验收。

核验结论：

- `/v1/models` 在没有 Bearer Token 时返回 `401`，说明生产网关必须由服务端注入 New API Token，不能让桌面端匿名直连。
- 管理 API 登录成功后可读取当前用户、用户分组、Token 列表、个人日志统计和系统定价；当前账号为 Root，默认分组包含 `default` 与 `vip`。
- 临时 Token 初始额度为 `100000`，Chat 成功后剩余额度为 `99969`；`/api/usage/token/` 在当前 New API 版本中把 `total_used` 明确实现为“不支持”并返回 `0`，因此真实消耗证据应使用响应 `usage`、剩余额度变化和 New API 日志，不能把 `total_used` 单字段当作财务对账结果。
- 临时 Token `29` 的创建、列表可见、明文 Key 取回、`/v1/models`、Chat 和 usage、删除及删除后不存在均已真实验证；当前管理员登录接口随后出现 HTTP `429` 限流，脚本不会重复撞击接口。
- 渠道 `OpenBuddy MiniMax M3` 已配置凭据且管理台测试成功；此前 `deepseek` 渠道缺 Key 的失败记录只适用于旧的渠道状态，不应作为当前 MiniMax 渠道状态。
- New API 文档将 Group 定义为隔离渠道访问权限和计费倍率的执行单元；OpenBuddy 因此把 `tenantId -> newApiGroup` 固化在 Resource Gateway 租户策略中，客户端不能覆盖。
- 官方 API 文档确认管理面覆盖用户、分组、Token、渠道、模型、日志、统计、支付和充值；AI 面覆盖模型列表、Chat Completions、Responses、Embedding、Rerank、图像、音频和 Realtime。当前 MiniMax channel adaptor 只支持 Chat Completions、图像和 TTS：对同一 `MiniMax-M3` Token 实测 Completions/Embeddings/Rerank 返回 `unsupported relay mode`，Responses 返回 `not implemented`。这属于 New API/MiniMax 能力边界，不是 OpenBuddy 积分结算失败；OpenBuddy 仍只应把实际有上游能力且有真实 usage 的协议纳入生产套餐。

生产集成只使用 Gateway 服务端专用 New API Token；多租户部署应使用 `NEW_API_GROUP_TOKENS_JSON` 为每个 New API Group 绑定独立 Token，不能依赖客户端传入的 Group Header 切换权限。账号密码、Session Cookie、Access Token 和任何管理 Token 不进入仓库、Renderer、账本或日志；管理面同步由独立 Worker 按最小权限执行。

### 真实联调阻塞与处理

当前 MiniMax 渠道凭据和价格已配置，管理台和 OpenAI 兼容 Chat/usage/删除闭环均已成功。不要用 New API 管理员密码、OpenBuddy 积分或 Casdoor Token 代替渠道 Key，也不要在仓库中保存渠道密钥。多协议接入必须按每个 Group/渠道的实际 adaptor 能力单独验收；对 MiniMax-M3，应将 Completions、Responses、Embeddings、Rerank 标记为不支持，而不是估算扣费或伪造成功。 Casdoor `admin/openbuddy` 应用的只读诊断仍显示 callback、OIDC scopes、Verification code、SMS Provider 和 WeChat Provider 全部缺失，因此短信/微信/OIDC 仍未完成真实登录闭环。

仓库提供可重复的验收脚本 `scripts/verify-new-api-closed-loop.sh`。脚本默认拒绝写操作，只有显式设置 `VERIFY_NEW_API_WRITE=1` 才会创建一个短期、低额度、唯一命名的临时 Token；创建响应一返回就记录 Token ID，若响应缺少 ID 或列表存在最终一致性延迟，`trap` 会按唯一名称再次查找并尝试删除，成功删除后还会从 Token 列表核验不存在。设置 `NEW_API_VERIFY_STREAM=1` 时，脚本还会发送 `stream_options.include_usage=true` 的 SSE Chat 请求，并要求最终 usage 块包含完整 token 数。脚本不会打印密码、Cookie、Access Token、API Key 或响应正文。

解除会话限流并取得短期 Token 后，可先运行 `scripts/build-new-api-capabilities.sh` 生成保守能力目录。该脚本真实调用 `/v1/models` 和非流式 `/v1/chat/completions`，要求响应包含完整 `usage`，输出的 JSON 可直接作为 `NEW_API_CAPABILITIES_JSON`；未单独完成 SSE 验证时会将 `streaming` 标为 `false`，避免把未经验证的流式能力售卖给用户。

如果 New API 已达到管理员登录会话上限，脚本支持注入一个由管理员临时取得的 `NEW_API_ADMIN_ACCESS_TOKEN`、对应 `NEW_API_ADMIN_SESSION_ID` 和当前用户 ID `NEW_API_ADMIN_USER_ID` 复用现有会话；复用会话不会由脚本登出。若只需验证 API 面，可注入一次性短期 `NEW_API_EXISTING_TOKEN_KEY`，脚本只调用模型/usage 接口，不创建、删除 Token，也不会要求管理员会话。脚本不会把这些凭证写入仓库。新建会话失败时会明确报告 `AUTH_SESSION_LIMIT`，提示在 New API 的“登录会话”页面退出其他会话。新建登录会话时，脚本从登录响应提取用户 ID，不再硬编码 `New-Api-User: 1`。

New API 当前源码默认的登录会话发行门槛为单用户 24 小时最多 100 个新会话、同时最多 50 个活动会话；对应管理接口是已有浏览器会话下的 `GET /api/user/auth/sessions`、`DELETE /api/user/auth/sessions/:sid` 和 `POST /api/user/auth/sessions/revoke-others`。本次目标实例从本机和目标主机登录均返回 `HTTP 429 AUTH_SESSION_ISSUANCE_LIMIT`，没有通过数据库、Redis 或未授权接口绕过该限制；解除限制后只需取得短期会话或一次性 Token，即可运行 `scripts/verify-enterprise-closed-loop.sh` 完成公网三方验收。

## 1. 三方职责

| 系统 | 企业职责 | 不负责的部分 |
| --- | --- | --- |
| Casdoor | OIDC/PKCE、微信/短信登录、Organization 多租户、用户/角色/权限、登录 Session、审计 | 模型路由、上游 API Key、模型计费 |
| New API | OpenAI/Claude/Gemini 等协议统一网关、模型聚合、渠道权重/重试、Token、分组、限流、额度和用量 | OpenBuddy Agent 权限、企业身份主数据 |
| OpenBuddy | Desktop Agent、Session、工具调用、项目、团队工作区、Casdoor 租户策略与用户体验 | 不复制 Casdoor 用户库，不管理上游模型 Key |

推荐生产链路：

```text
微信/短信/OIDC → Casdoor → OpenBuddy Desktop → Resource Gateway → New API → 合法授权的模型渠道
```

## 2. 最小接入

New API 提供 OpenAI 兼容接口，OpenBuddy 已支持自定义 OpenAI Provider。当前新增了 `New API（OpenAI 兼容网关）` 预设：

```text
Base URL:  https://<new-api-host>/v1
API Key:   New API 为用户或租户签发的 Token
协议:      chat_completions
认证:      bearer
```

OpenBuddy 会通过 `GET /v1/models` 拉取可用模型；默认聊天请求走 New API 的 OpenAI 兼容 `/v1/chat/completions`。Gateway 还提供租户隔离的非流式 `/ai/completions`、`/ai/responses`、`/ai/embeddings`、`/ai/rerank` 和 `/ai/moderations` 代理。Moderations 与 Embeddings/Rerank 一样要求 New API 返回真实输入 usage；没有 usage 时释放预扣并拒绝结算。New API 的音频、图像、视频、Realtime 等协议仍需分别定义 usage、失败退款和流式结算契约后才能接入。

商业售卖使用 `GET /v1/tenants/{tenantId}/ai/catalog`，而不是直接把 `/v1/models` 当作商品目录。Gateway 会合并 New API 模型发现、租户白名单、已验证能力目录、OpenBuddy 积分价格和供应商成本基线，并逐模型返回 `sellable` 与拒绝原因。能力目录未配置、Chat Completions 未验证、真实 usage 非 `required` 或缺少输入/输出成本时均 fail-closed 为不可售；这样可以展示模型但不会把未经验收的能力放入套餐。

## 3. 身份与额度分层

不要让三方各自维护用户身份：

```text
Casdoor Organization = 企业租户
Casdoor User         = 企业成员
Casdoor Role         = 企业角色
Casdoor Permission   = OpenBuddy 功能权限
New API Group        = 模型额度/限流/模型范围
```

建议映射：

| Casdoor 角色 | New API Group | OpenBuddy 能力 |
| --- | --- | --- |
| `owner` | `enterprise` | 全部 Agent、模型和租户管理 |
| `admin` | `team` | 用户、模型、策略和审计管理 |
| `developer` | `developer` | 编程 Agent、代码工具、团队空间 |
| `member` | `standard` | 普通模型和个人会话 |
| `guest` | `limited` | 受限模型和只读 Agent |

最终请求必须同时满足：

```text
Casdoor tenant permission
AND OpenBuddy tenant policy/modelAllowlist
AND New API Token/Group/model policy
```

Casdoor 的 `tenantContext.plan`、成员角色和权限可以作为映射输入；New API 的 Group、Token、quota、模型限制和计费仍由 New API 自己执行。

## 4. Token 模式

### 阶段一：租户 Token

每个租户配置一个 New API Token，适合私有化单企业部署，改造最小，但不能精确统计到个人。

### 阶段二：用户 Token

每个 Casdoor 用户对应一个 New API 用户 Token，按用户统计额度和成本。映射应由主进程或 Resource Gateway 保存：

```text
casdoor issuer + tenantId + subject → newApi userId + tokenId
```

不要把长期 New API Token 放入 React 状态、日志或普通配置。

### 阶段三：Gateway 代理（推荐生产形态）

```text
OpenBuddy → Resource Gateway → New API
```

Gateway 验证 Casdoor JWT、租户成员资格和 OpenBuddy 策略，再选择 New API Token/Group 并代理流式响应。这样桌面端无需持有共享长期 Token，还可以统一记录 `tenantId / subject / sessionId / agent / model / requestId`。

## 5. Casdoor 与 New API OIDC

New API 自身支持 OIDC，可配置 Casdoor 的：

- `client_id`
- `client_secret`
- `well_known`
- `authorization_endpoint`
- `token_endpoint`
- `user_info_endpoint`

推荐让 New API 管理台也使用 Casdoor 登录，但不要假设 New API 会自动理解 Casdoor 的全部租户 Claims。New API OIDC 用户信息主要依赖 `sub`、`email`、`name`、`preferred_username`；租户到 New API Group 的映射应由同步服务或 Resource Gateway 完成。

## 6. 当前代码改动

本次新增 New API Provider 预设，未新增依赖、未修改 Casdoor 服务端：

- `src/lib/agent/pi-client.ts`：新增 `new_api` ProviderKind。
- `src/components/SettingsPanel.tsx`：新增 New API 预设，默认 Bearer + Chat Completions，Base URL 由用户填写。
- `electron/main/agent-host.ts`：识别并回显 `new_api` Provider。

当配置 `OPENBUDDY_CASDOOR_RESOURCE_API_URL` 且 Casdoor 会话已登录时，`new_api` Provider 会由 Electron 主进程自动改写为当前租户的 `/v1/tenants/{tenantId}/ai` 代理地址，并通过 `/models` 与 `/chat/completions` 完成模型发现和调用。模型设置页的 `new_api` “拉取模型”同样只访问租户 Gateway，不接受用户输入 New API 管理 Token；Renderer 不持有 New API 长期 Token，主进程仅将短期 Casdoor access token 注入 Pi 运行时凭据。未登录或未配置 Resource Gateway 时，企业模型发现会失败并提示先完成登录/部署；其他 BYOK Provider 保留原有直连行为。

Resource Gateway 的租户策略可通过 `newApiGroup` 固定 New API Group。该映射由服务端策略决定，客户端请求不能覆盖；没有租户级映射时才回退到网关环境变量 `NEW_API_GROUP`。

当前生效商业权益通过 `GET /v1/tenants/{tenantId}/billing/subscription` 只读返回。响应只包含当前订阅的 `planId/orderNo/status`、套餐权益快照和生效时间，不返回用于退款恢复的内部 `previousPolicy`；订单响应同样保留创建时的 `entitlements` 快照，客户端切换租户或刷新后可审计购买权益与当前生效权益，真正的策略执行仍只发生在 Gateway。

Gateway 提供 `GET /v1/tenants/{tenantId}/credits/reconciliation` 成本对账报告：它聚合本地已结算积分账本和由独立 Worker 导入的 New API 外部成本，并按模型 / 成员拆分。Worker 通过 `POST /v1/tenants/{tenantId}/credits/reconciliation/import` 批量导入 `externalId`、`importKey`、usage、成本和币种；导入记录按 `tenantId:importKey` 幂等，跨租户、权限不足、重复冲突都会拒绝。配置 `RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET` 后，请求体使用 HMAC-SHA256 生成 `X-OpenBuddy-New-Api-Cost-Signature`。对账报告区分 `external.records`、`matchedRecords`、`unmatchedRecords`、`matchedRequestIds` 和 `totalCost`；验收本次请求的外部成本时必须匹配当前 `newApiRequestId`，不能只看历史记录数量。没有导入数据时仍明确返回 `externalNewApiCostFetched=false`，不伪造 New API 管理端账单数据。

同一报告的 `commerce` 提供订单毛订单数、退款订单数、毛/退款/净积分，以及各币种原始 `amountMinor` 的毛额、退款额和净额。它是 Gateway 运营对账摘要，不是财务总账；Gateway 不进行汇率换算，财务系统必须按统一汇率服务处理多币种收入。New API `quota` 仍是内部额度单位，不能直接当成货币。

报告的 `economics` 进一步区分产品收入与模型成本：`verifiedExternalCostByCurrency` 只纳入 New API 日志中的 `provider-reported` 或已核验 `provider-reported-quota`，`unmatchedVerifiedExternalCostByCurrency` 单独列出未命中 OpenBuddy `newApiRequestId` 的成本；只有收入和核验成本币种相同才计算 `contributionMarginMajorByCurrency`。这样可以对标 WorkBuddy 的“额度消耗 + 套餐收入”体验，同时避免把 New API 钱包余额、quota 或美元成本误当成 OpenBuddy 积分。

本次核对的官方 New API 文档能力包括：[API 参考](https://docs.newapi.pro/zh/docs/api)、[API 令牌](https://docs.newapi.pro/zh/docs/guide/console/api-token)、[使用日志](https://docs.newapi.pro/zh/docs/guide/console/usage-log)、[钱包](https://docs.newapi.pro/zh/docs/guide/console/wallet)、[渠道](https://docs.newapi.pro/zh/docs/guide/console/channel-management)、[获取日志统计](https://docs.newapi.pro/zh/docs/api/management/logs/log-stat-get)、[获取所有分组](https://docs.newapi.pro/zh/docs/api/management/groups/group-get)。New API 的钱包/支付和 OpenBuddy 的订单/积分职责必须分离；生产对账使用最小管理员日志读取权限和 Gateway HMAC 导入，不把管理 Token 放进 Electron Renderer。

### 官方能力与 OpenBuddy 接入矩阵

| New API 能力 | 官方能力证据 | OpenBuddy 接入策略 | 当前状态 |
| --- | --- | --- | --- |
| OpenAI-compatible 模型接口 | 模型列表、Chat、Completions、Embeddings、Rerank、Moderation、音频、Realtime、图像、视频 | Gateway 只暴露已配置 capability directory 且有真实 usage 证据的协议；当前 MiniMax-M3 纳入 Chat 与 SSE | Chat/SSE 已验证；其他协议按渠道逐项验收 |
| 渠道与模型管理 | 管理接口中的渠道管理、模型管理、参数覆盖 | New API 管理面维护上游渠道；OpenBuddy 只读取模型能力，不把渠道密钥下发客户端 | 已接入运行时模型发现；管理写操作保留在 New API 管理面 |
| Group / 分组 | `/api/group/` 与分组管理接口 | Casdoor Organization/tenant → Gateway policy.newApiGroup → New API Group；Group 不是身份源 | 已实现租户级固定映射 |
| API Token | Token 创建、查询、删除和 usage 接口 | Gateway/Worker 使用短期或专用服务 Token；Renderer 永不持有长期 Token | Token 生命周期已完成一次性真实闭环 |
| 日志与统计 | `/api/log/`、`/api/log/stat`、个人/令牌日志 | 独立 Worker 以最小管理员权限读取日志，按 Casdoor tenant/subject 映射导入 Gateway | Worker 已实现；生产需配置权限和定时任务 |
| 钱包、兑换码与支付 | New API 用户钱包、兑换码和支付设置 | 不作为 OpenBuddy 产品账本；OpenBuddy 订单、积分、退款由 Gateway 事实源管理 | 已明确隔离，支付渠道仍待生产接入 |
| OIDC / 微信状态 | 实例 `/api/status` 返回 `oidc_enabled`、`wechat_login` | Casdoor 负责 OpenBuddy 身份；不把 New API 登录状态当成 Casdoor 登录 | 当前实例公开状态为 OIDC=false、微信登录=false |

本次对目标实例公开状态接口核验到版本 `v1.0.0-rc.22`、`quota_per_unit=500000`、`oidc_enabled=false`、`wechat_login=false`。这只能证明实例状态和能力开关，不能替代管理员权限下的渠道、日志、支付和多租户生产验收；`quota_per_unit` 只用于 Worker 在明确标记 `provider-reported-quota` 时换算成本，不能直接当作人民币或美元。

## 7. 生产实施顺序

1. 部署人员补充合法的 New API 上游渠道 Key，并先在 New API 管理台完成单渠道健康检查。
2. 使用独立、短期、低额度测试 Token，验证 `/v1/models`、非流式 Chat、流式 Chat、模型切换和限流错误，完成后删除 Token。
3. OpenBuddy 使用 Resource Gateway 预设完成最小调用联调；客户端不直连 New API 管理面。多租户环境先验证 Group→Token 映射和未映射 Group 的 fail-closed 行为。
4. 增加 Casdoor `tenantId/plan/role` 到 New API Group 的映射配置，并验证跨租户模型与积分隔离。
5. 将租户 Token 迁移到 Gateway secret manager，保留轮换、撤销和审计流程。
6. 部署独立 Worker 使用 New API 最小管理员凭据读取 `/api/log/stat` 或导出日志，转换为租户映射后的成本记录并调用对账导入接口；OpenBuddy 记录产品行为审计，New API 记录真实模型成本。生产保持 `NEW_API_ALLOW_ESTIMATED_USAGE=0`，没有真实 usage 就释放预扣而不结算。
7. 完成多租户隔离、成员撤销、Token 撤销、429/5xx、上游 401、超时、流式断线和积分释放验收。
8. 商业权益验收：支付回调后订阅端点、租户 runtime policy、订单权益快照三者一致；新订阅替换旧订阅后，旧订单退款不得回滚新订阅；退款后订阅状态与策略恢复可审计。

### 企业账期与共享钱包

`GET /v1/tenants/{tenantId}/credits/reconciliation` 是租户账期的统一只读口径，支持 `since`、`until` 和可选 `walletId`。未提供 `walletId` 时按租户汇总；提供后，Gateway 要求调用方至少是该共享钱包的 `viewer`，并按钱包消费账本、订单退款和 New API request id 过滤成本。成员通过共享钱包调用时，外部 Worker 即使按成员 subject 导入 New API 日志，也能通过本地 `newApiRequestId` 归属到钱包账期，避免成本漏算或串账。

账期输出同时包含 token、积分、模型、成员、Agent、会话、订单收入、退款、成本证据、匹配率和同币种贡献毛利；它是运营/成本核对口径，不替代财务系统的支付、税费、汇率和总账。

## 8. 许可证与安全

New API 仓库采用 AGPL-3.0。建议作为独立服务部署，通过 OpenAI 兼容 API 与 OpenBuddy 连接，不复制或静态链接 New API 源码。所有上游模型凭据必须是合法授权凭据；不要在 OpenBuddy 日志、Renderer 或提交记录中写入 New API Token。

## 9. 最新只读核验（2026-08-30）

本轮只读访问了官方文档 `https://docs2.newapi.pro/en/llms-full.txt` 及目标实例 `http://124.221.146.145:3000/api/status`，未向 Casdoor 或 New API 写入配置，也未使用或输出任何账号密码、管理 Token 或上游密钥。

- 官方文档将 New API 分为 AI Model APIs 与 Management APIs；前者包括 Chat、Completions、Embeddings、Rerank、Moderations、Audio、Realtime、Images、Video，后者包括用户认证/管理、OAuth、渠道、模型、Token、兑换码、支付、日志、统计、任务、Group、供应商和安全验证。
- 目标实例当前返回 `version=v1.0.0-rc.22`、`quota_per_unit=500000`、`oidc_enabled=false`、`wechat_login=false`、`password_login_enabled=true`。因此 OpenBuddy 身份仍必须由 Casdoor 提供，不能把 New API 本地登录当作企业 SSO；New API 微信/OIDC 也不能据此宣称已启用。
- 目标实例状态接口显示 `quota_display_type=USD`，但 `quota` 仍是 New API 内部计费单位；只有读取并核验当前实例 `quota_per_unit` 后，Worker 才能把日志标记为 `provider-reported-quota`，不能直接折算为 OpenBuddy points。
- 当前可证明的集成边界是：Casdoor 负责身份/Organization/RBAC，Gateway 负责租户策略与 OpenBuddy points，New API 负责 Group/Token/渠道/模型/usage；支付、钱包、兑换码和 New API 管理面不替代 OpenBuddy 商业账本。
