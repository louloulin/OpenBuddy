# OpenBuddy Casdoor 企业身份配置

OpenBuddy follows the Casdoor Electron desktop pattern: the system browser opens Casdoor, Casdoor redirects to the registered `casdoor://` protocol, and the Electron main process exchanges the one-time authorization code. The renderer never receives an access token or refresh token.

## 0. OpenBuddy 用户入口

Use the normal OpenBuddy user flow; do not open Casdoor manually as the first step:

1. Start the desktop app with `pnpm dev`.
2. In the OpenBuddy left sidebar, click `企业登录` (after authentication this label becomes the Casdoor display name).
3. OpenBuddy opens the `账户管理` section. Click `企业账号登录`.
4. OpenBuddy's Electron main process opens the system browser at Casdoor's authorization endpoint.
5. Complete authentication in Casdoor. Casdoor redirects to the exact `casdoor://localhost/callback` URI.
6. The OpenBuddy main process validates the callback and exchanges the code; the renderer receives only the sanitized session view.

The sidebar user button is the canonical entry point. `设置 → 账户管理` exposes the same flow plus SMS, WeChat, tenant selection, session refresh/logout, audit and Casdoor administration. A failed or unconfigured Provider is shown as a diagnostic error; OpenBuddy never reports a login success before the callback and token validation complete.

Development uses an isolated Electron user-data directory (`OpenBuddy-dev`) so an older packaged OpenBuddy instance cannot take the single-instance lock or consume the `casdoor://` callback. Set `OPENBUDDY_DEV_USER_DATA` when a test needs a disposable explicit directory.

## 1. Create a dedicated Casdoor application

Do not reuse `admin/app-built-in` for OpenBuddy. The target instance currently exposes that application's client ID but has no registered redirect URI and has no WeChat Provider binding. Create a dedicated application under the organization that owns OpenBuddy, then configure:

- Redirect URI: `casdoor://localhost/callback` for the current desktop build. Register the exact URI; scheme, host and path are checked by the main process.
- Response type: `code`.
- Scope: `openid profile email phone offline_access`.
- PKCE: enable/use `S256`.
- Sign-in method: enable `Verification code` for SMS login.
- Provider: bind the Casdoor `Wechat` OAuth Provider for WeChat login. `WeChat` and `WeCom` are different providers.
- Logout: enable the OIDC/RP-initiated logout endpoint when available.

Casdoor's OIDC discovery must be available at:

```text
https://<casdoor-host>/.well-known/openid-configuration
```

The target development instance is currently `http://124.221.146.145:8000`; use HTTPS for production deployments.

## 2. Configure OpenBuddy

The preferred deployment configuration is environment-only:

```text
OPENBUDDY_CASDOOR_ISSUER=https://<casdoor-host>
OPENBUDDY_CASDOOR_CLIENT_ID=<dedicated-application-client-id>
OPENBUDDY_CASDOOR_REDIRECT_URI=casdoor://localhost/callback
OPENBUDDY_CASDOOR_SCOPE=openid profile email phone offline_access
OPENBUDDY_CASDOOR_SMS_HINT=Verification code
OPENBUDDY_CASDOOR_WECHAT_HINT=Wechat
OPENBUDDY_CASDOOR_MANAGEMENT_URL=https://<casdoor-host>/
# Optional: enable Casdoor Casbin resource/action enforcement in the main process
OPENBUDDY_CASDOOR_ENFORCER_ID=<casbin-enforcer-id>
# Keep this value in the Electron main-process environment only
OPENBUDDY_CASDOOR_CLIENT_SECRET=<confidential-client-secret>
```

The current development deployment has a public client ID `005d6839fe25abd6696f`; OpenBuddy uses that ID by default. Production deployments should override it with a dedicated client ID through `OPENBUDDY_CASDOOR_CLIENT_ID`.

If the deployment requires a confidential client, set `OPENBUDDY_CASDOOR_CLIENT_SECRET` only in the Electron main-process environment. Never put it in renderer code, a checked-in `.env` file, or Casdoor config saved from the renderer.

When both `OPENBUDDY_CASDOOR_CLIENT_SECRET` and `OPENBUDDY_CASDOOR_ENFORCER_ID` are set, protected resource checks call Casdoor `POST /api/enforce` with Basic Auth and `[subject, resourceId || resource, action]`. Cross-tenant, malformed, denied, unavailable, or expired-session requests fail closed before a protected resource is accessed. If either variable is absent, OpenBuddy uses its local declared-permission fallback; sensitive cloud resources should keep the variables configured and enforce the same decision at their backend boundary.

The account settings view can save non-secret issuer/client/redirect/provider-hint values to the Electron user-data directory. Environment variables take precedence over those values.

## 3. Login behavior

- **企业账号登录** opens the standard Casdoor authorization page and is available independently of SMS or WeChat Provider setup. This is the fallback for password, SSO, and any other provider enabled by the Casdoor application.
- **短信登录** sends `signinMethod=Verification code` only after the main process confirms that the application flag, sign-in rule, and sign-in-capable SMS Provider are configured. Casdoor owns phone verification, SMS provider credentials, rate limiting and MFA.
- **微信登录** sends `provider_hint=<bound-provider-name>` after the main process confirms a credentialed, sign-in-capable WeChat OAuth Provider. Casdoor owns the WeChat OAuth credentials, account linking and provider callback.
- Both flows use Authorization Code + PKCE `S256`, state and nonce.
- The main process validates callback address, state, issuer, audience, nonce, token time claims and the Casdoor JWKS signature. An `openid` session without an ID token is rejected.
- Refresh tokens are encrypted with Electron `safeStorage`; if OS encryption is unavailable, the session is memory-only.

## 4. Permission model

Casdoor is the source of identity and organization/role/permission claims. OpenBuddy accepts string, array, and Casdoor object-shaped claims (`{ owner, name }`) and normalizes explicit claims into these capabilities:

`team.workspace`, `cloud.sync`, `protected.resources`, `admin.portal`, `billing.read`, `audit.read`.

Missing or unknown claims default to deny. Team workspace IPC and the Casdoor management button are enforced again in the Electron main process, not only hidden in React. Remote APIs must independently validate the Casdoor token; renderer visibility is not a security boundary.

When an ID token is present, its signed identity and authorization claims are authoritative. `userinfo` may enrich profile fields, but cannot replace the signed subject, organization, roles, groups, permissions, or capabilities. The normalized identity also keeps all declared organizations so a tenant-aware UI does not silently collapse a multi-organization account to one value.

Session-linked resources use the same main-process boundary. OpenBuddy persists a local `sessionId -> { tenantId, subject }` index at `~/.pi/agent/openbuddy-session-tenants.json`; session list, workspace list, load, prompt, abort, inspect, usage, rename, delete, fork, rewind, tasks, and plan-mode operations are checked against the active tenant. Regular users see only their own sessions; tenant/platform administrators may inspect sessions in their current tenant, never another tenant. Legacy tenant-only bindings are not treated as owned by a user until explicitly rebound, and the renderer cannot provide a tenant ID or subject to override this decision.

## 5. Verification checklist

1. Open Account settings and confirm the issuer/client ID state.
2. Start SMS login and confirm Casdoor shows the `Verification code` method.
3. Start WeChat login and confirm Casdoor resolves the configured `Wechat` Provider.
4. Complete login and verify profile, organization, roles and capabilities appear without tokens.
5. Restart OpenBuddy and verify encrypted refresh restores the session when the OS keychain is available.
6. Sign out and verify local session data is removed and Casdoor logout opens.
7. Remove the `admin.portal` claim and verify the management action is rejected by IPC.

## 6. Management API and tenant bootstrap

The account settings management panel uses Casdoor's authenticated management APIs. Read operations use the deployed Casdoor contract (`GET /api/get-*` with `owner`, `p`, `pageSize`, `field`, and `value`). Administrative writes stay in the Electron main process and require the `admin.portal` capability:

- `POST /api/update-user`: enable or forbid a user account.
- `POST /api/add-user`, `POST /api/delete-user`: create or remove a user; the built-in administrator is protected.
- `POST /api/add-role`, `POST /api/update-role`, `POST /api/delete-role`: maintain role membership.
- `POST /api/add-permission`, `POST /api/update-permission`, `POST /api/delete-permission`: maintain Casbin-backed resource/action permissions.

The renderer receives only sanitized summaries and never receives the access token. The write surface intentionally does not expose password, provider secret, application secret, or arbitrary Casdoor object mutation.


## 5. 企业组织、角色、权限、规则管理

已登录且具备当前租户最小管理权限的账户在账户设置页面会显示「Casdoor 组织、角色、权限与规则」面板，通过下列管理 API 拉取当前租户数据：

- `GET /api/get-organizations`
- `GET /api/get-users`
- `GET /api/get-roles`
- `GET /api/get-permissions`
- `GET /api/get-groups`
- `GET /api/get-rules`

受保护的最小写操作包括：

- `POST /api/add|update|delete-user`
- `POST /api/add|update|delete-organization`
- `POST /api/add|update|delete-group`
- `POST /api/add|update|delete-role`
- `POST /api/add|update|delete-permission`
- `POST /api/add|update|delete-rule`

调用由主进程统一执行，access token 永远保留在主进程内存中；renderer 只接收脱敏摘要，不接收 token。读取和写入分别要求 `tenant.*.read/write` 最小租户权限；内置管理员、内置组织、关键内置权限/角色和全局规则不能从 OpenBuddy 删除。当前 Casdoor 实例的 `/rules` 页面为空，因此面板会在规则区域显示「Casdoor 当前未返回任何规则（目标实例 `/rules` 页面同样为 'No data'）。规则由 Casdoor 权威维护，OpenBuddy 不在本地复制规则状态」。

未授予当前租户管理权限的账户看到权限提示，无法调用对应管理 IPC；renderer 隐藏按钮不是安全边界。

## 7. 当前目标实例审计结果

## 8. 多租户授权与审计进度

OpenBuddy 将 Casdoor Organization 映射为租户边界，并在主进程维护当前租户上下文：

- 单租户账户自动选择唯一租户；多租户账户必须在账户设置中显式选择当前租户。
- `tenantMemberships` 按 Casdoor organization/owner 隔离角色、权限、分组和 capability。
- 主进程广播脱敏的 `casdoor://lifecycle` 事件，覆盖登录、刷新、注销、租户切换、会话失效和配置变更；事件只携带生命周期类型、scope 代次和租户标识，不携带 access token 或 refresh token。
- scope 发生变化时主进程先销毁旧 Agent/插件/会话上下文，再按新租户和主体初始化；renderer 清空旧会话、工作区和草稿后重新加载，避免旧租户数据闪现。普通 token refresh 不打断正在执行的 Agent，只使 renderer 缓存重新验证。

## 9. 企业智能体工作台能力矩阵

OpenBuddy 不复制 Codex 或 WorkBuddy 的闭源实现，而是将可复用的产品能力映射到 Pi + Cordis + Electron 主进程：

| 工作台能力 | OpenBuddy 现有实现 | 企业治理边界 |
| --- | --- | --- |
| 对话、上下文、模型切换 | Pi `AgentSession`、上下文用量、BYOK provider | 主进程模型配置门禁，API key 不进入 renderer |
| 专家、技能、插件 | agent markdown、skills、Cordis plugin host、marketplace | 主进程统一读写授权，项目资源绑定 cwd |
| MCP/连接器 | MCP stdio/HTTP、OAuth 状态、CLI connector | 配置读取和认证操作经 MCP/agent 能力门禁，秘密只在主进程 |
| 任务、计划、子 agent、团队 | task/plan capability、Pi subagent、team package | session tenant binding、team.workspace、任务取消和计划批准均受保护 |
| 自动化和后台执行 | automation capability、运行记录、通知 | 创建者/租户授权上下文，执行/删除/归档分别审计 |
| 记忆、知识库和项目 | memory、knowledge base、enterprise resources | subject/tenant 分区；生产内容由 resource gateway 承载 |
| 账户与管理 | Casdoor OIDC、组织/角色/组/权限/规则管理 | `tenant.*` 最小权限和 `admin.portal` 门禁；未知 claim 默认拒绝 |
| 租户治理 | 租户状态、资源配额、集中式租户审计、软归档恢复 | `tenant.policy.read/write`、`tenant.lifecycle.write`、`tenant.audit.read`；暂停租户拒绝访问，归档租户保留只读审计 |

当前工作台的安全边界是 Electron main process：renderer 只看到脱敏摘要和稳定拒绝错误。未配置或未登录 Casdoor 时，原有本地/BYOK 工作流继续可用；企业会话、租户共享资源和管理操作仍要求有效身份。

## 10. 后续生产路线

1. **身份与 Provider**：在 Casdoor 注册精确 `casdoor://localhost/callback`，启用真实 SMS Provider，并绑定 WeChat OAuth Provider；用临时测试账号完成真实登录验收。
2. **集中资源服务**：部署 `OPENBUDDY_CASDOOR_RESOURCE_API_URL` 后端，服务端再次验证 `sub`、`tenantId`、`resource`、`action`，持久化项目/知识/存储内容和不可变审计事件。
3. **租户生命周期**：把邀请、停用、删除、成员离职、权限版本和缓存失效交给 Casdoor/资源服务；OpenBuddy 不猜测未验证的 Casdoor 管理端点。
4. **运行治理**：在现有租户状态/资源配额基础上，继续增加租户级模型白名单、MCP allowlist、模型用量配额、数据保留/导出和管理员 kill switch，并沿用现有主进程审计入口。
5. **交付验证**：每次发布执行 focused tests、TypeScript、生产 build、Electron smoke 和真实 Provider 测试；没有外部凭据时明确标记为 degraded，而不伪造通过。

本轮已补充资源网关的租户治理闭环：`tenant.policy.read/write` 可读取和更新租户 `active/suspended/archived` 状态、资源上限、模型/MCP 白名单、kill switch 和每日 token 配额；策略带单调递增 `version`，更新携带 `expectedVersion`，过期版本返回 `TENANT_POLICY_VERSION_CONFLICT`，防止多管理员覆盖；暂停租户的资源读写返回 `TENANT_SUSPENDED`，归档租户进入软删除状态、保留资源只读并对写入返回 `TENANT_ARCHIVED`，归档和恢复要求 `tenant.lifecycle.write` 或全局管理员；超过上限返回 `TENANT_QUOTA_EXCEEDED`，达到运行配额返回 `CASDOOR_TOKEN_QUOTA_EXCEEDED`；`tenant.audit.read` 可读取当前租户的集中式脱敏审计。桌面端通过 `casdoor:tenant-policy-get`、`casdoor:tenant-policy-update`、`casdoor:runtime-policy-get` 和 `casdoor:tenant-audit-list` 调用，可信主进程记录普通 Prompt、自动化和团队子 agent 的 token 用量；未配置资源网关时本地元数据 fallback 也执行相同的状态和配额约束。
- 所有 Casdoor 管理读取/写入 API 都要求当前租户权限，并将查询 owner 限制到当前租户；平台管理员才可跨租户查看。
- 团队 IPC 和管理入口不再只依赖全局 `admin.portal`，会校验当前租户上下文；团队创建、读取、删除还会以 `team + resourceId + action` 调用主进程资源授权，配置 Casbin Enforcer 时由 Casdoor 做最终决策。
- 会话和会话关联资源已完成租户及主体边界：会话索引持久化 `sessionId -> { tenantId, subject }`，提示词、搜索、任务、计划、分叉、回溯和会话管理均复用主进程 `session + action + resourceId` 门禁；普通用户仅访问自己的会话，租户管理员仅可访问当前租户。
- 主进程提供 `authorize` 决策和 `tenant-select` IPC；renderer 只能看到脱敏的租户上下文。
- 登录、登出、租户切换、授权允许/拒绝会写入本地 JSONL 审计事件；审计记录不包含任何 token、密码或 Provider secret。

当前仍需继续完成：

1. 将真实项目、知识库和云同步内容接入服务端数据模型；当前主进程注册表只保存受保护的元数据，本地记忆、MCP、Agent 配置和本地文件仍属于设备级资源。
2. 生产部署必须将共享资源在后端/网关重复校验；当前主进程已支持通过环境变量 `OPENBUDDY_CASDOOR_CLIENT_SECRET` 和 `OPENBUDDY_CASDOOR_ENFORCER_ID` 调用 Casdoor `/api/enforce`。未配置 secret 时仅使用本地声明权限，生产环境应视为未完成部署。
3. 完善租户生命周期：暂停/删除、成员邀请、权限版本、缓存失效和集中式审计保留策略。
4. 为管理 API 增加集中式错误码、跨设备幂等键和组织/成员变更审计，避免仅依赖本地 JSONL。

截至 2026-08-28，对 `http://124.221.146.145:8000` 的管理员审计结果如下：

- `admin/openbuddy` 已存在，client ID 为 `005d6839fe25abd6696f`；应用标题显示 `casdoor://localhost/callback`，但实测 `redirectUris` 为空，必须在应用 Redirect URIs 中登记完全一致的回调地址。
- 应用的 `signinMethods` 列表包含 `Verification code`，但当前 `enableCodeSignin=false`，因此短信登录实际上未启用。
- 应用当前只绑定 `provider_captcha_default`，没有可登录的 WeChat OAuth Provider；因此微信入口已实现，但在绑定真实 Casdoor WeChat Provider 前不能完成真实微信登录。
- 当前应用没有可登录的 SMS Provider，也没有可用短信网关或 WeChat Provider。
- `built-in` 当前没有业务角色，只有内置权限 `permission-built-in`；规则接口返回空列表，和 `/rules` 页面一致。

真实短信和微信登录必须补充平台凭据：微信开放平台 AppID/AppSecret，以及阿里云、腾讯云、Twilio 等短信网关配置。未提供这些凭据前，OpenBuddy 保持可诊断失败，不写入伪造 Provider。

## 9. 企业共享资源边界

OpenBuddy 现在提供一个主进程维护的租户资源注册表 `casdoor-tenant-resources.json`，用于保存企业项目、知识库和存储连接的**元数据**。它不是云文件后端，也不会把密码、Access Token、Refresh Token、私钥或其它 secret 写入资源 metadata。

- `casdoor:resource-list/get/create/update/delete` 全部只在主进程执行，并要求已登录、已选择租户以及 `resource + action + resourceId` 授权。
- 资源记录包含 `tenantId`、创建主体、版本号和更新时间；更新/删除必须带 `expectedVersion`，避免并发覆盖。
- 创建支持受限的 `idempotencyKey`，重复请求不会产生重复资源；持久化采用临时文件写入后 rename，避免半写入状态。
- renderer 的项目缓存按 `tenantId + subject` 分区。当前登录用户创建企业项目时可以明确选择“企业共享项目”；未选择时仍是本机 local 项目。
- 本地 `StorageProvider`、本地知识库、MCP、Agent 配置和文件系统仍然是设备资源，不会被误标记为跨租户共享。真正的云文件内容必须由 WebDAV/S3/业务 API 后端再次校验 Casdoor 权限，不能只依赖本地 Electron。
- 配置 `OPENBUDDY_CASDOOR_RESOURCE_API_URL=https://<gateway>` 后，资源 CRUD 改走企业资源网关：主进程携带短期 access token，网关按 `sub + tenantId + resource + action` 重复授权，并用 `If-Match` 做版本控制。未配置该地址时才使用本机元数据注册表，适合开发/离线索引，不等于生产云存储。

仓库同时提供可独立部署的 `services/casdoor-resource-gateway`：它验证 Casdoor OIDC access token 的 issuer、audience、expiry、JWKS 签名和租户 membership，再执行资源 ACL；服务端持久化资源、幂等键、版本号和脱敏审计事件。生产部署必须使用 HTTPS Casdoor issuer、持久化 `RESOURCE_GATEWAY_DATA_DIR`、TLS/内网反向代理，并按环境设置 `CASDOOR_AUDIENCE`、`RESOURCE_GATEWAY_MAX_RESOURCES`、`RESOURCE_GATEWAY_AUDIT_MAX_BYTES` 等配额；该服务不接收或保存 client secret、refresh token 或资源 secret。

建议后续接入真实后端时保持同一资源模型：服务端保存内容与 ACL，使用 Casdoor organization 作为租户边界，服务端在每次读写校验 `sub + tenantId + resource + action`，并将审计事件集中写入不可篡改的日志系统。客户端资源注册表只作为离线元数据索引，不能替代服务端授权。

## 10. 审计与授权错误契约

- `casdoor:authorize-decision` 返回 `allowed`、`reason` 和稳定 `code`，例如 `CASDOOR_TENANT_REQUIRED`、`CASDOOR_PERMISSION_DENIED`、`CASDOOR_USER_FORBIDDEN`；主进程抛出的授权异常也以 `code` 属性和 `[CASDOOR_*]` 消息前缀保留相同契约，业务界面不应依赖中文错误文本判断权限。
- 审计事件仍由主进程写入，包含租户、主体、资源、动作和结果，不包含 Token 或密码。写入采用串行队列、临时文件 rename，并按 `OPENBUDDY_CASDOOR_AUDIT_MAX_EVENTS`（默认 500，允许 50–10000）和 2 MiB 文件大小上限保留最近事件。
- 本地审计适合作为桌面诊断与短期缓存；生产环境仍应由资源网关或集中式 SIEM 接收不可篡改、可检索、按租户保留的审计事件。

## 11. 企业项目成员管理

企业项目的「邀请」按钮不会把成员写入 OpenBuddy 本地缓存，也不会伪造邀请链接。它通过主进程 `casdoor:open-membership-management` 打开 Casdoor 控制台，并要求当前租户具备 `tenant.users.write` 或 `tenant.groups.write` 之一；成员、群组、角色和组织关系仍由 Casdoor 权威维护。没有这些权限时，操作会被主进程拒绝。

## 12. Refresh 与成员变更安全边界

刷新 Token 时，如果 Casdoor 没有返回新的 ID Token，OpenBuddy 保留上一次已验证的 `sub`、组织、租户、角色、组和 capability，仅允许当前 userinfo 补充头像、邮箱等 profile 字段；`isForbidden`/`isDeleted` 仍可触发立即失效。这样可以避免不带签名的 userinfo 在刷新阶段提升跨租户或管理员权限。

Casdoor 成员、群组、角色或组织发生变化后，下一次刷新会重新获取 userinfo，并通过主进程状态事件使项目缓存和权限 UI 重新计算。每次 Casdoor 管理写入成功后，OpenBuddy 还会在主进程使用 refresh token 立即重验证当前会话；若当前账户已被禁用或删除，立即清理会话和工作台上下文。OpenBuddy 不在本地复制 Casdoor 邀请、成员离职或组织目录；这些权威关系仍由 Casdoor 管理控制台维护。资源网关提供租户级 `active/suspended/archived` 软生命周期和可审计 member deny-list：暂停会阻止运行和写入，归档保留只读资源用于审计/导出，成员撤销会在 JWT 仍未过期时立即阻止资源和策略访问；撤销名单仅对 `tenant.lifecycle.write` 管理员返回，平台全局管理员保留紧急恢复通道；恢复和归档要求全局管理员或 `tenant.lifecycle.write`，不会对资源执行不可逆物理删除。资源网关在撤销当前会话用户时会同步调用 `casdoorAuth.handleExternalRevocation` 立即清理本地会话，主进程发送 `casdoor://member-revocation` 广播事件，渲染层收到后立即重渲染并展示提示。

## 13. SMS 与 WeChat Provider 自检

登录能力由 `deriveCasdoorLoginCapabilities` 在主进程启动或配置变更时探测，结果通过 `casdoor:capabilities` 暴露给 renderer。判定条件：

- 企业账号：要求应用登记精确回调 URI `casdoor://localhost/callback`，并启用 `openid profile email phone offline_access` scopes；任一缺失 `enterprise.enabled=false` 并描述具体缺口。
- 短信：要求 `enableCodeSignin=true` 且 `signinMethods` 中存在可用的 `Verification code` 规则；同时要求存在 `category=SMS` 且非 `Default`/`Mock SMS` 的 Provider，并填写了 `accessKey/accessKeySecret/signName/templateCode` 等短信网关字段；否则 `sms.enabled=false` 并说明缺失的 Provider 类型或凭据。
- 微信：要求存在 `category=OAuth && type=WeChat` 的 Provider，且 `clientId` 与 `clientSecret` 均已配置；否则 `wechat.enabled=false` 并说明需要在 Casdoor 控制台配置微信开放平台 AppID/AppSecret。

管理员在 Casdoor 完成上述配置前，OpenBuddy 会在「账户」面板明确提示 SMS / 微信 Provider 缺失的具体原因，按钮被禁用并不会发起请求。开发者也可以在 `pnpm vitest run src/lib/__tests__/casdoor-auth.test.ts` 中跑同一份探测逻辑以保证配置契约。
## 14. Webhook 双向同步与 OpenAPI 契约

主进程 `electron/main/casdoor-resource-backend.ts` 通过 `POST /v1/webhooks/casdoor` 接收 Casdoor 推送，HMAC-SHA256 签名校验，缺省密钥返回 `503 WEBHOOK_DISABLED`，签名错误返回 `401 WEBHOOK_SIGNATURE_INVALID/MISSING`。同时主进程也具备向 Casdoor 投递 webhook 的能力：`casdoor:webhook-deliver` IPC 读取 `OPENBUDDY_CASDOOR_WEBHOOK_SECRET`，使用同套 HMAC 算法签名后调用 Casdoor webhook URL。Settings 面板的「模拟 Casdoor webhook」按钮即触发该通道，便于本地演练与回归测试。

事件载荷（`CasdoorWebhookEvent`）覆盖：

- `user / organization / group / role / permission` × `update / delete / add-user / remove-user / add-role / remove-role`
- `organization` 必填（=租户/组织），其他字段按事件类型携带

收到后主进程广播 `casdoor://casdoor-webhook` 给所有 BrowserWindow；Renderer 在 `AccountSettingsPanel` 中订阅并刷新视图；如发现本地缓存被影响则触发 `casdoorAuth.refresh()`。

`services/casdoor-resource-gateway/openapi.yaml`（OpenAPI 3.1）暴露完整契约：

- 路径：`/v1/tenants/{tenantId}/resources`、`/v1/tenants/{tenantId}/policy`、`/v1/tenants/{tenantId}/runtime-policy`、`/v1/tenants/{tenantId}/runtime-usage`、`/v1/tenants/{tenantId}/audit`、`/v1/tenants/{tenantId}/audit-export`、`/v1/tenants/{tenantId}/audit-archive`、`/v1/tenants/{tenantId}/member-revocations`、`/v1/tenants/{tenantId}/member-revocations/{subject}`、`/v1/tenants/{tenantId}/health`、`/v1/webhooks/casdoor`
- 鉴权：`bearerAuth`（Casdoor OIDC access token，前端不接触，仅主进程持有）
- 错误码契约：`WEBHOOK_DISABLED / WEBHOOK_SIGNATURE_INVALID / WEBHOOK_SIGNATURE_MISSING / TENANT_NOT_FOUND / TENANT_REVOKED / TENANT_ARCHIVED / POLICY_RATE_LIMITED`

企业可在 Swagger UI / Redoc / Stoplight 直接渲染契约，作为多语言 SDK 生成与外部治理集成的输入。

## 15. Casdoor 可继续集成的空间（未实现，按优先级排序）

本节列出 Casdoor 已提供但 OpenBuddy 尚未对接的能力。每一项都标注"接入点 / 价值 / 代码改动估算"，便于后续规划。本节仅作为路线图，不承诺实现。

### Tier A —直接接 Casdoor API，立竿见影

#### A1. Account linking（多 Provider 绑定同一用户）
Casdoor 一个 user 可绑定手机号 / 微信 / GitHub / 邮箱 / 密码等多个 Provider 凭据。OpenBuddy 当前 `userinfo` 只读主 Provider。
- **接入点**：登录后 `GET /api/get-account-linking-options` 拉用户已绑定凭据；Settings面板「账户」新增标签页展示已绑定 Provider + 解绑入口。
- **价值**：用户能管理多登录方式；离线工作台仍可走本地 BYOK；租户审计能看到同一用户的多种登录方式。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `electron/main/casdoor-management.ts` 新增 `CasdoorAccountLinkingOption` / `CasdoorAccountLinkingInput` 类型 + `listCasdoorAccountLinking(owner, name)` + `unlinkCasdoorAccount(input)`。前者用 `callCasdoorApi` 拉取后做 `name / user / userName / identifier` 字段匹配过滤；后者用 `writeCasdoorApi` 触发 `delete-account-linking-option`，自动走 15s 超时 + bearer token + 变更后会话再校验。
  - `electron/main/ipc/index.ts` 新增白名单频道 `casdoor:list-account-linking` 与 `casdoor:unlink-account` + handler。
  - `electron/preload/index.ts` 把新频道加进 invoke 频道白名单。
  - `src/lib/casdoor-client.ts` 暴露 `casdoorListAccountLinking()` 与 `casdoorUnlinkAccount()` + 类型。
  - `src/components/SettingsSections.tsx` 新增「账户绑定（已登录 Provider 列表）」面板：调用 `get-account-linking-options` 列出当前用户已绑定的手机号 / 微信 / GitHub / 邮箱 / 密码等凭据，每条带「解绑」按钮（带 `window.confirm` 二次确认），走 `delete-account-linking-option` 解绑。
  - `src/lib/__tests__/casdoor-account-linking.test.ts` 新单测：3 case 覆盖 list 转发、unlink 转发、IPC 错误传播。
  - `electron/main/casdoor-management.test.ts` 追加 `get-account-linking-options` + `delete-account-linking-option` 端点的 operation 映射断言。
- **代码改动**：~80 行（IPC + UI 标签页 + 单测）。

#### A2. Backchannel logout（Casdoor → 全客户端踢下线）
Casdoor 支持 OIDC Back-Channel Logout：用户在 Casdoor 控制台主动注销，或管理员封号，会通过 BackchannelLogoutURL 异步通知所有客户端。
- **接入点**：Casdoor `application.BackchannelLogoutURL` → 网关或主进程接收 → 触发 `casdoorAuth.handleExternalRevocation` → `casdoor://auth` 广播。
- **价值**：管理员封号即时生效，无需等 JWT 过期（最长 1 小时）。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `services/casdoor-resource-gateway/src/index.ts` 新增 `/v1/backchannel-logout/casdoor` 路由 + `verifyBackchannelLogoutToken()`（HS256 签名 + iss/aud/events/exp 校验）+ `readFormUrlEncodedBody()`。新增 `RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET` 环境变量（缺省回退到 `RESOURCE_GATEWAY_WEBHOOK_SECRET`）。
  - `services/casdoor-resource-gateway/src/backchannel.test.ts` 新单测：8 个 case 覆盖成功路径 / 错误签名 / 错误 iss / 错误 aud / 缺事件 / 过期 / 错误 content-type / 错误 method。
  - `services/casdoor-resource-gateway/openapi.yaml` 新增 `/v1/backchannel-logout/casdoor` 路径与 schema 定义（401/400/405/415/503 错误响应）。
  - 主进程无需新增代码：现有 `casdoor-resources.setMemberRevocation()` 路径已经会调 `casdoorAuth.handleExternalRevocation()`，backchannel 写入 store 后下一次 polling 自动闭环。
- **代码改动**：~50 行（gateway 新增路由 + 主进程订阅 + 单测）。

#### A3. Impersonation（管理员代理登录用户）
Casdoor 支持 `isAdmin` 用户通过 `clientId+clientSecret+adminUser+adminPassword+user` 临时以另一 user 身份登录（Casdoor 内置审计 `isImplicit` 字段）。
- **接入点**：主进程 IPC `casdoor:impersonate` 给管理员用；UI 二次确认弹窗 + 顶部红色横条明示代理身份。
- **价值**：企业支持团队「以客户身份调试」时无需索取客户密码。
- **代码改动**：~60 行（IPC + 审计 + UI 弹窗 + 单测）。

#### A4. Invitation link（邀请新成员加入租户）
Casdoor 支持 `POST /api/invite-user` 生成临时链接，新用户点击后自动加入 Organization。
- **接入点**：Settings面板「邀请成员」按钮 → 表单（邮箱 + 角色 + 分组） → 主进程 IPC `casdoor:invite-user` → 网关 audit。
- **价值**：替代当前 `casdoor:open-membership-management` 跳转 Casdoor 控制台的方式；UX 大幅提升。
- **代码改动**：~40 行（IPC + 按钮 + 表单 + 单测）。**本节最高优先级**。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `electron/main/casdoor-management.ts` 新增 `CasdoorUserInvite` / `CasdoorUserInviteResult` 类型 + `inviteCasdoorUser()`（email 正则校验 + owner scope 校验 + audit 记录 + `managementOperation("/api/invite-user")` 归类为 `user/create`）。
  - `electron/main/ipc/index.ts` 新增白名单频道 `casdoor:user-invite` 与 handler。
  - `electron/preload/index.ts` 在 invoke 频道列表里加上 `casdoor:user-invite`。
  - `src/lib/casdoor-client.ts` 暴露 `casdoorInviteUser()` 包装 + 类型。
  - `src/components/SettingsSections.tsx` 新增「邀请成员（Casdoor 临时链接）」面板：邮箱 / 默认角色 / 默认分组 / 有效期 + 最近一次邀请的链接 / token / 过期时间展示。
  - `src/lib/__tests__/casdoor-invite.test.ts` 新单测：IPC 转发 / 字段省略 / 错误传播。
  - `electron/main/casdoor-management.test.ts` 追加 `invite-user` 端点的 operation 映射断言。

#### A5. Adaptive MFA / Risk-based authentication
Casdoor 支持基于地理位置、IP、登录频次的风险评分，自动要求 MFA。
- **接入点**：登录失败率高于阈值时，主进程自动调 Casdoor `/api/get-mfa-config` 触发二次验证；UI 显示 OTP / WebAuthn 二步。
- **价值**：BYOK 场景下桌面端被滥用时自动防御。
- **代码改动**：~120 行（风险评分器 + UI 二步验证）。

### Tier B —需要 Casbin 模型迁移，工作量中等

#### B1. Resource 双向同步
Casdoor Resource 是 Casbin 模型里的核心实体（不只 project / knowledge_base / storage_connection）。OpenBuddy 资源注册表仅 `CasdoorResourceType`，未与 Casdoor Resource 双向同步。
- **接入点**：网关 `/v1/tenants/{id}/resources` 同时写本地 JSON + Casdoor `/api/add-resource`；UI 显示 Casdoor 资源列表 + 本地注册表合并视图。
- **价值**：资源授权可跨多服务（不只是 OpenBuddy），其他服务也能基于 Casdoor Resource 做 ACL。
- **代码改动**：~200 行（资源 + UI + 同步 + 单测）。

#### B2. Rule 可视化调试器
Casdoor Rule 是 Casbin 表达式（`r.sub == p.sub && r.obj == p.obj && r.act == p.act`）。当前 OpenBuddy `list-rules` 只读不展示语义。
- **接入点**：Settings面板 Rule 列表 → 「模拟匹配」输入 `(subject, object, action)` → 调用 `casdoorAuth.authorizeResourceRemotely` 看是否通过。
- **价值**：租户管理员自助调试权限问题，无需联系 OpenBuddy 工程师。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `src/components/SettingsSections.tsx` 新增「规则模拟匹配（Casbin 调试器）」面板：`(subject, object, action)` 三元组表单 + 「运行模拟匹配」按钮 + 「重置」按钮，结果卡片显示 `data-testid="casdoor-rule-simulator-allow"` / `-deny` 徽章。直接调用已存在的 `casdoorAuthorizeResource` wrapper（走主进程 `authorizeResourceRemotely` 走 Casdoor Enforcer，本地 + 远程双重判定）。
  - `src/lib/__tests__/casdoor-rule-simulator.test.ts` 新单测：3 case 覆盖转发 / 拒绝 / 错误传播。
- **代码改动**：~100 行（UI + 模拟器 + 单测）。

#### B3. Sync adapter 元数据共享
Casdoor 支持把 LDAP / AD / SQL 数据库 用户同步进 Organization。
- **接入点**：Casdoor `/api/get-sync-providers` → 主进程显示已配置的 sync 源 → UI 提供「立即同步」按钮。
- **价值**：企业 AD/LDAP 改组后，OpenBuddy 自动跟随。
- **代码改动**：~60 行。

### Tier C —文档/配置驱动，零代码或少量代码

#### C1. Plan / Pricing（计费分层）
Casdoor 支持按 Organization 设置 plan（免费 / 团队 / 企业版），每个 plan 有不同的资源上限。OpenBuddy 网关 policy 已经按 `maxResources` / `maxTokensPerDay` 限制，但没与 Casdoor plan 字段打通。
- **接入点**：网关 `tenantContext` 初始化时拉 Casdoor `/api/get-organization-plan`，把 plan 字段作为治理元数据返回。
- **价值**：企业版租户可看到「你的 plan 等级 + 已用配额」。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `src/lib/casdoor-permissions.ts` `CasdoorTenantMembership` 加 `plan?: string`；新增 `extractCasdoorPlans()` helper，从 Casdoor OIDC `properties[tenantId].plan`（每租户方案）或顶层 `plan` 声明里推导。
  - `src/lib/casdoor-authorization.ts` `CasdoorTenantContext` 加 `plan?` + `plansByTenantId?`；`buildCasdoorTenantContext()` 聚合 active 租户方案 + 全部租户方案映射。
  - `src/components/SettingsSections.tsx` 在租户能力提示行下加「租户计费方案」行，未配置时显示提示，已配置时显示 `settings-tag` 徽章（`data-testid="casdoor-tenant-plan"`）+ 多租户时的方案列表。
  - `src/lib/__tests__/casdoor-auth.test.ts` 新增 describe 块：properties map 解析、顶层 plan 兜底、per-tenant 优先、active 上下文聚合、缺省情况、非字符串 plan 过滤，共 6 个 case。
- **代码改动**：~40 行（fetch + 类型扩展）。

#### C2. Public Key / Cert 公开加密
Casdoor 支持为每个 Organization 上传公钥，加密敏感 metadata。
- **接入点**：网关接收资源创建时若 `metadata.encryptedBy === "casdoor"`，用 Casdoor 公开公钥加密敏感字段。
- **价值**：合规要求「静态加密」的场景下，OpenBuddy 资源网关可承担加密责任。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `services/casdoor-resource-gateway/src/encryption.ts` 新模块：RSA-OAEP-SHA256 包裹 AES-256-GCM 会话密钥，支持任意长度 payload；wire 格式 `casdoor:v1:<wrapped-key>:<iv>:<auth-tag>:<ciphertext>`（全部 base64）；`loadEncryptionContext()` 验证 PEM，`encryptMetadata()` 跳过 `encryptedBy` 与非字符串值。
  - `services/casdoor-resource-gateway/src/index.ts` 启动时读 `RESOURCE_GATEWAY_CASDOOR_PUBLIC_KEY` 构建 `EncryptionContext`（PEM 无效则启动失败并打印错误）；resource create / update / read / list 全部 hook `encryptMetadata` + `summarizeEncryption`；create / update 审计事件附加 `encrypted_fields=<n>` 标签，方便 SIEM 跟踪。
  - `services/casdoor-resource-gateway/src/encryption.test.ts` 新单测：7 case 覆盖 RSA-OAEP 往返、解密后字节级一致、跳过非字符串、context 缺失时无操作、幂等（已加密不再加密）、summary、坏 PEM 抛错。
  - `src/components/ProjectsPanel.tsx` 表单新增「加密存储」checkbox（`data-testid="casdoor-encrypt-toggle"`），勾选后 metadata 携带 `encryptedBy: "casdoor"`，网关自动加密其他字符串字段。
- **代码改动**：~80 行（密钥获取 + 加密适配器）。

#### C3. Device flow（IoT / CLI 设备登录）
Casdoor 支持 OAuth Device Authorization Grant（CLI 输入设备码登录）。OpenBuddy 当前没有 CLI / IoT 入口。
- **接入点**：未来如果提供 `openbuddy-cli` 命令行工具，需要走 device flow。
- **价值**：无头服务器、自动化 agent 用设备码登录。
- **代码改动**：暂不需要（无 CLI 入口）。

#### C4. Custom signup fields（自定义注册字段）
Casdoor 支持 Organization 级别自定义字段（公司名、工号等）。当前 OpenBuddy `userDraft` 只采集 name/displayName/email/phone。
- **接入点**：登录后从 `userinfo.customFields` 读取 → 渲染到 Settings面板。
- **价值**：企业收集租户专属字段（部门、职级、试用期）。

- **状态（本次实现）**：✅ 已落地。改动文件：
  - `src/lib/casdoor-permissions.ts` `CasdoorIdentity` 加 `customFields?: Record<string, string | number | boolean>`；新增 `extractCasdoorCustomFields()` helper，仅接受 string / finite number / boolean 值，丢弃空字符串 / null / array / NaN / Infinity。
  - `src/components/SettingsSections.tsx` 在「租户计费方案」行下加「组织自定义字段」行（`data-testid="casdoor-custom-fields-hint"`），显示 Casdoor 端 Application → Custom signup fields 启用的字段（部门 / 工号 / 试用期等），未配置时显示提示。
  - `src/lib/__tests__/casdoor-auth.test.ts` 新增 describe 块：4 case 覆盖基础提取、空 properties 时省略字段、非标量值过滤、与 C1 plan 提取共存。
- **代码改动**：~60 行（fetch + UI）。

### 优先级矩阵

| 优先级 | 项 | 代码量 | 凭据依赖 | 战略价值 |
| --- | --- | --- | --- | --- |
| **1** | A4 Invitation link | ~40 行 | 无 | 高（UX 立竿见影） |
| **2** | A2 Backchannel logout | ~50 行 | 无（需 Casdoor 配置 BackchannelLogoutURL） | 高（安全闭环） |
| **3** | A3 Impersonation | ~60 行 | 需 Casdoor `clientSecret` | 中（企业支持流） |
| **4** | A1 Account linking | ~80 行 | 无 | 中（多 Provider 体验） |
| **5** | C1 Plan/Pricing | ~40 行 | 无 | 中（合规可见性） |
| **6** | B2 Rule 调试器 | ~100 行 | 无 | 中（租户自助） |
| **7** | B1 Resource 双向同步 | ~200 行 | 需 Casdoor `clientSecret` | 高（跨服务授权） |
| 8 | B3 Sync adapter | ~60 行 | 需 LDAP/AD 配置 | 中（企业 AD 同步） |
| 9 | C2 Public Key 加密 | ~80 行 | 无 | 低（合规可选） |
| 10 | A5 Adaptive MFA | ~120 行 | 需 WebAuthn 配置 | 中（自动防御） |
| 11 | C4 Custom signup fields | ~60 行 | 需 Organization 配置 | 低（垂直场景） |
| 12 | C3 Device flow | 暂不需要 | 无 CLI 入口 | 低（未来入口） |

### 推进原则

- **不下载依赖、不动 Casdoor 服务端**：所有 Tier A / B / C 项都是 OpenBuddy 客户端通过 Casdoor Management API / OIDC endpoint 调用实现，不涉及 Casdoor 源码修改。
- **代码改动按 Tier A → B → C 顺序**：A 立竿见影；B 涉及 Casbin 模型迁移；C 是配置/文档驱动。
- **凭据缺失项项不阻塞开发**：A1 / A2 / A4 / C1 / C2 / C4 不需要任何 Casdoor 凭据，开发与单测可独立进行；A3 / B1 / B3 需要 Casdoor 客户端 secret，集成测试时再启用。

### 本轮已落地
- ✅ **A2 Backchannel logout**：Gateway 新增 `/v1/backchannel-logout/casdoor`，完整实现 OIDC Back-Channel Logout 1.0 规范（HS256 签名 + iss/aud/events/exp 校验）。Casdoor 控制台踢人后，gateway 立即写入 `memberRevocations` 存储；主进程下一次 polling 自动调 `casdoorAuth.handleExternalRevocation()` 完成全员踢下线。Tier 1 第二项闭环，下一优先项是 A3 Impersonation（需 Casdoor `clientSecret`）。

- ✅ **A4 Invitation link**：OpenBuddy 客户端已闭环。`/api/invite-user` 经 `casdoorAuth.getAccessToken()` 调用，UI 端可生成邀请链接 / token 并在面板展示。Casdoor 服务端是否实际发送邮件仍依赖 `app.SmtpServer` / `app.SmtpPort` / `app.SmtpUser` 等配置。Tier 1 第一项闭环，下一优先项是 A2 Backchannel logout。
- ✅ **C1 Plan / Pricing**：从 Casdoor OIDC `properties[tenantId].plan` 提取每租户计费方案，Settings 面板显示 `data-testid="casdoor-tenant-plan"` 徽章，租户上下文返回 `plan` + `plansByTenantId` 给上层调用。Tier 1 第三项闭环，下一优先项是 A1 Account linking（让 Settings 面板能展示用户已绑定的多个登录方式）。
- ✅ **A1 Account linking**：Settings 面板新增「账户绑定」面板，调用 Casdoor `get-account-linking-options` 列出当前用户已绑定的多 Provider 凭据，每条带「解绑」按钮（走 `delete-account-linking-option`）。直接呼应原始 objective 中的「支持微信登录」——用户登录后能在 UI 里看到自己微信绑定状态并自助解绑。Tier 1 第四项闭环，下一优先项是 B2 Rule 可视化调试器（让租户管理员自助调试权限）。
- ✅ **B2 Rule 可视化调试器**：Settings 面板新增「规则模拟匹配（Casbin 调试器）」，输入 `(subject, object, action)` 直接调主进程 `authorizeResourceRemotely`，结果带 `data-testid="casdoor-rule-simulator-allow"/"-deny"` 徽章。租户管理员无需联系 OpenBuddy 工程师即可自助验证权限规则。Tier 2 第一项闭环，下一优先项是 A3 Impersonation（需 Casdoor `clientSecret`）。
- ✅ **C4 Custom signup fields**：从 Casdoor OIDC `claims.properties` 提取企业自定义字段（部门 / 工号 / 试用期等），Settings 面板显示「组织自定义字段」hint 徽章 + 全部键值对。Tier C 第三项闭环，路线图 12 项已落地 6 项（A4 / A2 / C1 / A1 / B2 / C4）。剩余 6 项全部需要 Casdoor 服务端凭据（clientSecret / WebAuthn / LDAP / Org 配置）才能联调。
- ✅ **C2 Public Key 加密**：`services/casdoor-resource-gateway/src/encryption.ts` 新模块实现 RSA-OAEP-SHA256 包裹 AES-256-GCM；`RESOURCE_GATEWAY_CASDOOR_PUBLIC_KEY` 环境变量（Casdoor 颁发的 PEM 公钥）启用后，resource create / update 自动加密 metadata 字符串字段，read / list 响应附 `encryption: { enabled, encryptedFields }` 摘要。`ProjectsPanel` 表单加「加密存储」checkbox（`data-testid="casdoor-encrypt-toggle"`），勾选后 metadata 携带 `encryptedBy: "casdoor"`。Tier C 第二项闭环，路线图 12 项已落地 7 项。

- ✅ **5.2 Active Session 列表**：Settings 面板新增「活跃 Session 列表」面板，调用 Casdoor `/api/get-sessions` 列出当前用户的所有 OIDC 会话（不同应用 / 设备 / refresh token），每条带「强制下线」按钮（走 `/api/delete-session`），并提供「下线全部 Session」（逐条撤销、返回成功/失败计数）。查询按用户名过滤且不再跨用户回退显示；与 A2 Backchannel logout 互补——A2 是管理员踢人，本项是用户自助撤销；权限仍走 `requireTenantPermission("tenant.users.write")`。新机会清单第一项闭环。

- ✅ **账号安全中心**：Settings 将账户绑定、活跃 Session、批量下线与 Token Introspection 统一放入「账号安全中心」，提供一键刷新全部安全状态和 `data-testid="casdoor-security-summary"` 摘要；底层仍复用既有 IPC 权限门，不在 renderer 保存 token。

- ✅ **5.3 Token Introspection（RFC 7662）**：Settings 面板按 Casdoor OIDC Discovery 返回的 `introspection_endpoint` 校验 access_token / refresh_token 的 `active` 状态并返回 sub/exp/iat/scope/client_id 等元数据。不能硬编码 `/api/introspect`，因为不同 Casdoor 版本可能返回 `/api/login/oauth/introspect`。适合排查 admin 踢人后本地缓存是否仍误判有效（与 A2 互补：A2 是事件驱动，本项是手动核查）。

- ✅ **5.4 Webhook Subscription**：Settings 面板新增按事件类型订阅配置（user / organization / group / role / permission 的更新、删除及成员变化），IPC 订阅表默认全量兼容，显式配置后由主进程在 `casdoor://casdoor-webhook` 广播前过滤；配置以 `0600` 权限原子写入主进程 `userData/casdoor-webhook-subscriptions.json`，键包含 Casdoor issuer + tenant，重启后恢复；租户读取/写入分别受 `tenant.settings.read` / `tenant.settings.write` 与 `assertOwnerScope` 保护。新机会清单第三项闭环。

- ✅ **New API Provider 预设**：OpenBuddy 模型设置新增 `New API（OpenAI 兼容网关）`，默认 `bearer + chat_completions`，用户填写自托管 New API 的 `/v1` Base URL 和 Token 后即可拉取 `/v1/models` 并调用模型。三方职责、Casdoor Group 到 New API Group 映射、Token 模式和 Resource Gateway 生产方案见 `docs/new-api-casdoor-openbuddy.md`。
