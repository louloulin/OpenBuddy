# OpenBuddy 企业三方真实验收记录（2026-08-29）

## 验收范围

本记录区分四类证据：代码测试、New API 独立真实闭环、Casdoor 独立真实登录、OpenBuddy → Resource Gateway → New API 三方闭环。只有最后一项能够证明企业工作台生产链路真正贯通。

## 已通过

### 2026-08-29 实时复核

- New API `/api/status` 返回 HTTP `200`，版本仍为 `v1.0.0-rc.22`。
- 一次性临时 Token `29` 已完成创建、`MiniMax-M3` `/v1/models`、Chat HTTP `200` 与真实 usage、Completions/Responses/Embeddings/Rerank 预期不支持验证；脚本已删除 Token 并复核列表中不存在。
- 官方文档入口仍明确区分 AI 模型接口与管理接口，当前实例的 MiniMax-M3 生产计费范围仍限于真实可用的 Chat Completions。

### New API 独立闭环

- 实例：`http://124.221.146.145:3000`，版本 `v1.0.0-rc.22`。
- 管理员登录成功，临时 Token `20` 创建成功、列表可见、明文 Key 可取回。
- `MiniMax-M3` `/v1/models` 成功，Chat Completions 返回 HTTP `200` 和真实 usage：`prompt_tokens=181`、`completion_tokens=8`、`total_tokens=189`。
- Completions、Responses、Embeddings、Rerank 分别被确认是当前 MiniMax channel 的不支持协议：`unsupported relay mode: 2/3/32`、`not implemented`。
- 临时 Token `20` 已删除，并在列表复核中确认不存在。
- New API `/api/usage/token/` 的 `total_used` 当前返回 `0`，服务端标记为不支持；财务对账不能只依赖该字段。
- 本轮重新使用一次受控管理员会话创建临时 Token `22`：`MiniMax-M3` Chat 返回 HTTP `200` 和真实 usage（`181/8/189`），Completions/Responses/Embeddings/Rerank 分别返回当前 MiniMax channel 的不支持错误；Token `22` 已由脚本删除并确认列表不存在。
- 随后再次使用受控管理员会话创建临时 Token `29`，结果与 Token `22` 一致；Token `29` 已删除并复核不存在。当前实例管理员登录接口随后进入短期限流（HTTP `429`），在限流窗口恢复前不重复登录或创建 Token。

### Casdoor 独立登录

- 实例：`http://124.221.146.145:8000`。
- OIDC discovery 和 JWKS 均返回 HTTP `200`。
- 使用受控 Casdoor 测试账号的 OAuth password grant 成功取得短期 access token；账号凭据未输出、未写入仓库。
- JWT 的 `iss`、`aud`、`sub`、`owner=built-in`、管理员角色和 OpenBuddy 权限 claims 可被解析。
- 本轮再次使用一次短期 password-grant token 验证：Casdoor JWKS 签名校验通过；`built-in`、`admin` 和 `tenant-a` 请求租户均可被全局管理员 claims 认证，本地 Gateway 返回积分账户。
- 本轮只读诊断仍返回 `redirectUris=[]`、`scopes=[]`、`enableCodeSignin=false`，且仅有不可登录 Captcha provider；没有修改 Casdoor 远端配置。

## 未通过或无法完成

### Casdoor 应用前置条件

只读 `get-app-login` 诊断确认 `admin/openbuddy` 当前仍缺：

- `casdoor://localhost/callback` 未登记到实际 `redirectUris`。
- OpenBuddy 要求的 OIDC application scopes 未完整配置。
- `enableCodeSignin=false`，短信验证码登录未启用。
- 没有可登录的 SMS Provider。
- 没有可登录的 WeChat OAuth Provider。

因此不能声称短信登录、微信登录或 Electron OIDC callback 已完成真实闭环。本轮遵守“不修改 Casdoor 服务端”的约束，没有伪造 Provider 或远程写入配置。

2026-08-29 实时只读诊断再次确认：`redirectUris=[]`、`scopes=[]`、`enableCodeSignin=false`、可登录 SMS Provider=none、可登录 WeChat Provider=none。

### OpenBuddy → Gateway → New API

本机探测 `124.221.146.145`：

- `8787/healthz` 连接超时，未发现公网 Resource Gateway。
- `80/443` 无可用 Gateway。
- `8080` 返回另一套“导师选择平台”，不是 OpenBuddy Resource Gateway。

2026-08-29 实时探测结果未改变：`8787/healthz` 和 `8787/readyz` 连接超时，80/443 没有 OpenBuddy Gateway 响应；因此不能执行公网企业闭环脚本。

仓库中的 Gateway 已通过本地 Gateway 全套 `69/69`、对账路径 `48/48`、前端对账/IPC `5/5` 和 TypeScript 检查；但当前没有已部署公网 Gateway，因此不能把本地测试当成三方生产验收。对账 Worker 已用本地 HTTP mock 验证 `/api/log/` 读取、租户映射、成本依据和默认 dry-run；仓库现在还提供了 systemd service/timer、滚动时间窗和生产 Secret 注入模板，但尚未在生产机启用并连接公网 Gateway 写入真实账本。

本地同构 Gateway 的 Casdoor JWT 验签、租户认证、积分发放、模型发现、Chat usage、预扣/结算、账本和对账路径均由测试覆盖；此前使用临时 Token `23` 的三方闭环证据仍有效。当前再次尝试复验时，New API 管理登录先后受到 HTTP `429` 限流，未能在本轮重新取得临时 Token，因此不把本轮脚本中止视为新的三方生产验收证据。已有临时 Token `23` 已删除并在列表中确认不存在。

本轮运行了对账 Worker 的真实 New API `/api/log/` 读取，并通过当时验证的实例 `QuotaPerUnit` 显式换算为美元后导入。`provider-reported-quota` 是独立的 `costBasis`：仅当 `other` 显式给出 USD 成本时记为 `provider-reported`，当只有 `quota` 时记为 `provider-reported-quota`，不会静默伪装成直接供应商 USD；没有日志或价格时仍为 `configured-pricing`。后续实时探测发现当前 `/api/status.data.quota_per_unit=500000`，Worker 已改为运行时读取该字段或使用显式 `NEW_API_QUOTA_PER_UNIT` 覆盖，禁止继续硬编码旧换算因子。

本轮真实导入 `fetched=2, eligible=2, skipped=0, imported=2, duplicates=0`，本地同构 Gateway 返回 `externalNewApiCostFetched=true`，证明 Worker 已真实读取上游日志、按官方换算生成 USD 成本并通过 HMAC 签名写入积分账本；不再是 mock。

## 结论

当前真实完成范围是：**New API Chat + usage + 临时 Token 删除闭环通过；Casdoor OIDC 基础可达、password grant/JWKS 验签可用；Casdoor JWT → 本地同构 Gateway → New API → OpenBuddy 积分预扣/结算的三方 Chat 闭环已真实通过。**

当前未完成范围是：**Casdoor 短信/微信登录、正式 Electron callback、公网 Resource Gateway、Worker 生产启用、provider-reported 外部成本的生产导入，以及其他 New API 协议/多媒体能力。** Gateway 代码现已具备 SQL CAS 请求租约和最终响应重放，Worker 也已具备可部署模板，但公网部署与多副本真实演练仍未完成。因此 Chat 产品路径已验收，但整体企业商业化仍不能标记为“全部完成”。

## 后续验收门槛

1. 在 Casdoor 绑定精确 callback、scopes、SMS Provider 和 WeChat Provider；用真实测试账号分别完成登录、刷新、注销、撤销。
2. 部署 Resource Gateway，使用 PostgreSQL/MySQL、TLS、Secret Manager，并注入 `NEW_API_GROUP_TOKENS_JSON`；禁止生产只配置单一共享 Token。
3. 用 Casdoor access token 调用 `/v1/tenants/{tenantId}/ai/models` 和 Chat，核对真实 usage、积分 consume、`reserved=0`、审计和 New API request id。
4. 用第二个租户重复调用，验证 Group/Token/模型白名单/账本隔离；再撤销成员并确认请求立即拒绝。
5. 将上述输出保存为部署工单证据后，才能把企业交付状态从“未通过”改为“已验收”。
6. 外部成本导入必须至少出现一条 `provider-reported` 记录；仅 `configured-pricing` 只能作为透明推导，不能把 `externalNewApiCostFetched` 标成真实供应商账单已获取。

## 可复用验收命令

部署 Gateway 后，使用短期 Casdoor access token 和短期 New API token 执行：

```bash
OPENBUDDY_GATEWAY_URL=https://gateway.example.com \
CASDOOR_ACCESS_TOKEN='<short-lived Casdoor access token>' \
OPENBUDDY_TENANT_ID=tenant-a \
NEW_API_BASE_URL=https://new-api.example.com \
NEW_API_EXISTING_TOKEN_KEY='<short-lived New API token>' \
bash scripts/verify-enterprise-closed-loop.sh
```

在独立 Worker 已导入供应商成本后，额外设置 `VERIFY_EXTERNAL_RECONCILIATION=1`，脚本会要求对账报告出现 `provider-reported` 外部成本；默认值 `0` 只验证本地积分结算、New API request id 和本地对账请求数。

如果需要由脚本创建和删除 New API 临时 Token，改为提供 `NEW_API_ADMIN_USER`、`NEW_API_ADMIN_PASSWORD` 并显式设置 `VERIFY_NEW_API_WRITE=1`。当前脚本在 HTTP 429 时读取 `Retry-After` 后停止，不会反复登录撞击生产实例。
脚本对 OpenBuddy 积分账本默认只读；只有显式设置 `OPENBUDDY_BILLING_WRITE=1` 才会发放测试积分。生产验收应优先使用预充值的隔离测试租户，避免把测试额度写入真实客户账本。
