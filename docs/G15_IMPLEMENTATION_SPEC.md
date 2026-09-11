# G15 实现规格：AuthStorage PKCE 接管 deepseek-generic auth

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase F + backlog G15
>
> **状态**：规格已落地（2026-09-11 Round 8）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前实现 | `electron/main/deepseek-generic.ts` 自有 CredentialStore + OS Keychain |
| 自实现规模 | ~200 LOC |
| 涉及 pi API | `AuthStorage / readStoredCredential / runtime-credentials` |
| Owner | runtime team |
| 估时 | 1 周 |
| 阻塞 | **依赖 G2**（settings 接入 auth 配置）|
| 风险等级 | 高（auth 是安全关键）|

---

## 1. 当前实现盘点

```
electron/main/deepseek-generic.ts: 自有 CredentialStore
- 自实现 OAuth PKCE flow（~80 LOC）
- 自实现 token 存储（OS Keychain wrapper）（~60 LOC）
- 自实现 refresh logic（~40 LOC）
- 自实现 auth UI 事件（~20 LOC）
```

## 2. 目标实现

```typescript
// electron/main/deepseek-generic.ts (重写)
import { AuthStorage, readStoredCredential } from "@earendil-works/pi-coding-agent";

// 1. 用 pi 的 AuthStorage 替代自实现 CredentialStore
const auth = AuthStorage.create({
  provider: "deepseek-generic",
  pkce: { enabled: true, ... },
  keychain: { service: "openbuddy-deepseek" },
});

// 2. typed facade 保留
export async function login(options: LoginOptions): Promise<LoginResult> {
  return auth.login(options);
}

export async function logout(): Promise<void> {
  return auth.logout();
}

export async function getValidToken(): Promise<string> {
  const cred = await readStoredCredential({ provider: "deepseek-generic" });
  if (cred.expired) await auth.refresh();
  return cred.accessToken;
}
```

**目标 LOC 估算**：~200 LOC → ~50 LOC（typed facade）。

## 3. 迁移步骤（3 PR）

### PR 1 — AuthStorage 接入（保留 facade）
1. 改 `login/logout/getValidToken` 内部用 pi API
2. 自实现 OAuth PKCE ~80 LOC 删除
3. 跑 vitest + Electron smoke

### PR 2 — token 存储 + refresh
1. 删自实现 keychain wrapper ~60 LOC
2. 删自实现 refresh ~40 LOC
3. 跑 e2e：token 过期自动刷新

### PR 3 — 安全审计
1. 加 security review checklist
2. 跑 `pnpm test:electron:provider-anthropic-probe-ipc`
3. **强制 2 人 review**（auth 是关键路径）

## 4. 测试策略

- 单元：`deepseek-generic.test.ts`（existing + pi 适配层）
- 集成：`tests/electron/provider-anthropic-probe-ipc.spec.ts`
- 安全：手工 token 泄漏测试

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 pi AuthStorage 不支持 OpenBuddy 的 provider 类型 | auth 失败 | provider schema 不匹配 | adapter 层 schema 转换 |
| R2 token 迁移数据丢失 | 用户被强制重新登录 | keychain key 不一致 | migration script 保留旧 token |
| R3 PKCE flow 安全漏洞 | token 被截获 | 现有自实现安全假设 | pi PKCE 已审计；2 人 review |
| R4 keychain 权限变化 | macOS 提示反复弹 | OS Keychain ACL | typed facade 提供 consent UI |

## 6. 验收命令

```bash
pnpm workspace:test -- deepseek-generic.test.ts                 # 全过
pnpm test:electron:provider-anthropic-probe-ipc                  # 全过
bash scripts/audit/pi-upstream-coverage.sh --json | jq '.unusedByDomain.auth'   # 3 → 1
```

## 7. 与其他 G-gap 关系

- 依赖 G2（settings 接入 auth 配置）
- 解锁 G8（29 canonical e2e 中 auth 相关的包）

## 8. 进度更新

`plan4.1.md §3 Phase F` / `docs/PI_INTEGRATION_BACKLOG.md §2 G15` 状态联动；`pi-upstream-coverage.sh` unusedByDomain.auth 自动反映。