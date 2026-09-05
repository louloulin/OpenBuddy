# WorkBuddy 风格积分体系 · OpenBuddy 对标

本文对照 WorkBuddy 的"额度 + 套餐 + 共享预算"心智模型，逐项说明 OpenBuddy Resource Gateway 已经覆盖的部分、刻意不同的地方，以及仍未实现的部分。它不是 WorkBuddy 的复制说明，而是把当前实现映射到 WorkBuddy 用户预期上，帮助产品和销售在不引入新事实源前提下落地商业化。

> Casdoor 是身份与 Organization 的事实源；OpenBuddy Resource Gateway 是积分账本、订单、钱包和租户权限的事实源；New API 仅是模型执行与上游成本证据。三者绝不互相替换。

## 1. WorkBuddy 心智模型 → OpenBuddy 映射

| WorkBuddy 行为 | OpenBuddy 当前实现 | 是否一致 |
| --- | --- | --- |
| 注册即得免费 `额度`，过期失效 | `POST /v1/tenants/{tid}/credits/welcome` + 自动发放在审计中，遵循活动 `free` 套餐的 `points`/`pointsValidDays`；幂等键由组织 + 主体派生 | 一致 |
| 团队/企业购买套餐 → 共享额度池 | `POST /v1/tenants/{tid}/wallets` 创建 `walletId`，成员角色 `owner/spender/viewer`，AI 请求带 `x-openbuddy-wallet` 时按钱包余额扣费；套餐的 `points` 通过 `POST /v1/billing/callback` 入账时可指定 `walletId` | 一致 |
| 积分过期 → 未消费余额清除 | `POST /v1/tenants/{tid}/credits/expire?all=true`（用户 Token）+ `POST /internal/v1/credits/expire`（HMAC Worker），只过期 `balance - reserved` 的 FIFO 批次，写入 `expire` 账本并记录 `sourceLedgerId` | 一致 |
| 模型请求实时扣额度 | `POST /credits/reserve` → `POST /credits/settle` 原子化；缺 usage 时强制释放预扣并返回 `NEW_API_USAGE_REQUIRED` | 一致 |
| Token 配额（每日） | `maxTokensPerDay` + `maxPointsPerDay` 双预算，`runtimeUsage` 同时冻结 token 与 points | 更严格 |
| 套餐过期自动降级 | `expireBillingEntitlements` 在每日读/预扣/过期时收敛；存在替换订单时回滚策略版本 | 一致 |
| 退款 | `POST /v1/billing/orders/{orderNo}/refund` 校验批次完整性，只退还未消费的购买批次，避免现金与积分脱钩 | 一致 |
| 积分转赠/合并 | `POST /v1/tenants/{tid}/credits/transfer` 在个人账户与共享钱包之间做原子转账，幂等、源侧 access check、ledger 互链 | 一致 |
| 个人额度 + 团队额度并存 | 个人账户 `tenantId::subject` 与共享钱包 `tenantId::wallet:<id>` 同存；钱包成员角色矩阵 `viewer < spender < owner` | 一致 |
| 组织/团队成员管理 | Casdoor Organization/RBAC + Gateway `memberRevocations` + Webhook 实时撤销；新成员不自动续继承往积分 | 一致 |
| 多租户模型隔离 | `tenantPolicy.modelAllowlist`、`mcpAllowlist`、`newApiGroup`、`killSwitch`、Shared Wallet 成员门禁 | 更严格（明确 kill switch） |

## 2. 刻意不同的地方

- **不使用 Redis Adapter 当登录**：WorkBuddy 通过 SaaS 平台账号登录；OpenBuddy 通过 Casdoor OIDC/PKCE、微信、短信直接登录用户。Redis adapter 仅在 Casdoor 集群横向扩展时作为可选状态共享层，从不参与商业账本或身份核验。
- **不使用 New API 钱包**：WorkBuddy 通常把供应商额度与产品额度合并到同一钱包；OpenBuddy 把 New API `quota` 视为内部计量单位（`quota_per_unit=500000`），由 Worker 通过 HMAC 导入 `provider-reported-quota`，从不直接显示为 OpenBuddy 积分。
- **服务端注入 New API Token**：WorkBuddy 客户端持有供应商 Token；OpenBuddy 桌面端永不接触 New API Token，Gateway 在服务端按 `tenantId -> newApiGroup` 注入 Group Token。
- **真实 usage 强制**：WorkBuddy 允许估算计费；OpenBuddy 在生产环境默认 `NEW_API_ALLOW_ESTIMATED_USAGE=0`，缺 usage 直接拒绝结算并释放预扣。
- **退款必须整批**：WorkBuddy 允许部分退款；OpenBuddy 只接受"批次未消费部分"的整批退款，避免出现退款超出剩余积分的情况。

## 3. 仍未实现或需外部资源

1. **真实微信/短信登录闭环**：依赖 Casdoor `Provider` 凭据与短信网关；当前只完成入口探测与状态显示。生产前必须补齐 Provider AppID/AppSecret 与 SMS 通道。
2. **真实支付网关**：当前使用平台无关的 HMAC 支付回调契约，需要对接 WeChat Pay / Stripe / Alipay 等，并把真实通道号写入 `paymentChannel`。
3. **财务总账**：Gateway `commerce` 与 `economics` 只做运营核对，不替代财务系统的税费、汇率和总账；多币种结算需要 Finance 服务按统一汇率处理。
4. **多租户 SLA / 合同额度**：`enterprise` SKU 当前仅依赖共享钱包 + 模型白名单 + Group；尚未引入合同级 SLA、限额、违约处理。
5. ✅ **积分转赠/合并（已闭环）**：`POST /v1/tenants/{tid}/credits/transfer` 在同一租户内对个人账户与共享钱包之间做原子转账；源侧扣费需要本人或租户管理员（或钱包 owner），目标侧允许任意租户成员向他人账户转账；幂等键跨重试安全；ledger 写入两条 `adjustment` 流水并通过 `sourceLedgerId` 互链；3 个新增回归测试覆盖个人→个人、个人↔钱包和参数校验。
6. **Webhook 失败回放队列**：当前 webhook 由 Casdoor 推送，幂等但不持久化重试队列；生产应增加 outbox 与指数回退。
7. **SIEM/SLO 告警闭环**：Prometheus 指标已经暴露，但告警路由、值班与值班升级流程未对接 PagerDuty / 钉钉。

## 4. 推荐落地路径

1. 把当前 3 个 active SKU（`free` / `team` / `enterprise`）作为最低商业上线门槛：每个 SKU 至少绑定 1 个已验证能力目录、1 个已验证价格/成本定价、1 条生产支付通道。
2. 用 `scripts/verify-tenant-boundaries.sh` 在 ≥ 2 个真实普通成员租户上跑 `tenant:boundary-audit`，得到非管理员 Token 的多租户矩阵证据；该证据必须出现在发布门禁中。
3. 用 `scripts/audit-enterprise-release.mjs` 在 CI 中强制要求 capability snapshot 存在、能力新鲜且渠道/模型/Group 未漂移，否则拒绝部署。
4. 把 `scripts/credit-expiry-worker.mjs` 的 systemd unit 与 `openbuddy-new-api-reconciliation-worker.timer` 错峰运行（建议每日 03:15 / 03:30），错开数据库写入高峰。
5. 商业化上线前必须把 §3 列出的真实第三方凭据与告警闭环补齐，避免演示能力被误当成生产能力。

## 5. 度量与监控

- `GET /metrics` 暴露 `openbuddy_gateway_uptime_seconds`、`openbuddy_gateway_http_requests_total{path,outcome}`、`openbuddy_gateway_rate_limited_total`、`openbuddy_gateway_webhook_*`、`openbuddy_gateway_new_api_circuit_*`；这些指标直接对应 WorkBuddy 后端的"每秒额度请求/被拒数"。
- `GET /v1/tenants/{tid}/credits/integrity` 在每日对账前运行，结果作为 `succeeded | backfillable | invalid` 三态记录到 ops 看板；任何 `invalid` 必须阻塞当日的商业对账。
- `scripts/new-api-reconciliation-worker.mjs` 的 watchdog 状态文件是商务/财务/审计共同的事实源；任何 26h 内未 `succeeded` 的运行必须告警并冻结当日商业结算。
