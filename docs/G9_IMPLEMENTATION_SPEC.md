# G9 实现规格：loadProjectContextFiles 接管 include.ts

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase E + backlog G9
>
> **状态**：**PR 1 已落地**（2026-09-11 Round 12 + **4th spec audit correction**）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件（**实际**） | `packages/runtime/openbuddy-plugin-host/src/include.ts`（**128 LOC** — Cordis harness plugin entry loader；**不是** context file loader） |
| pi 接入文件 | `packages/runtime/openbuddy-plugin-host/src/resource-pi.ts`（**新增 55 LOC**） |
| 涉及 pi API | `DefaultResourceLoader` + `loadProjectContextFiles` + 6 个类型 |
| Owner | runtime team |
| 估时 | 1 周 |
| 阻塞 | 独立任务（typed facade 模式）|
| 风险等级 | 低（facade additive，include.ts **不动**）|

> ⚠️ **Spec audit (Round 12)**：本 spec 同时错估 OpenBuddy 实际代码 + pi 上游 API——详见 §9。第 4 个连续 spec audit 失败；根因是写作 spec 时没核对 `wc -l include.ts` + 读 `node_modules/.../resource-loader.d.ts`。

---

## 1. 当前实现盘点（**修正后**）

```
include.ts: 自实现 Cordis harness plugin entry loader   [spec 说错——本不是 context loader]
- load / refresh plugin entry descriptors    (~80 LOC)
- YAML / JSON / JS file parsing               (~30 LOC)
- 错误处理 + 类型导出                          (~18 LOC)
- 总计                                       128 LOC
```

**真实规模 128 LOC**（不是 spec 的 350 LOC）。

`loadProjectContextFiles` 在 OpenBuddy **完全没有使用**（plugin-host 也未 import）。本 G9 PR 1 不替换任何现有代码——只是新增 facade，让 plugin-host 内部（以及未来 pi-runtime-coordinator / renderer）能以 typed 方式拿到 pi 的项目上下文加载能力，**不必直接依赖** `@earendil-works/pi-coding-agent`。

## 2. 目标实现（**修正后**）

```typescript
// packages/runtime/openbuddy-plugin-host/src/resource-pi.ts（新增 55 LOC）
import {
  DefaultResourceLoader,
  loadProjectContextFiles as piLoadProjectContextFiles,
  type ResourceLoader, type PathMetadata, type ResolvedPaths,
  type ResolvedResource, type ResourceCollision, type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";

export {
  DefaultResourceLoader,
  type ResourceLoader, type PathMetadata, type ResolvedPaths,
  type ResolvedResource, type ResourceCollision, type ResourceDiagnostic,
};

// Named-arg adapter: spec 友好的 (projectRoot, agentDir) → pi 的 { cwd, agentDir }
export async function loadProjectContextFiles(
  projectRoot: string,
  agentDir: string,
): Promise<Array<{ path: string; content: string }>> {
  return piLoadProjectContextFiles({ cwd: projectRoot, agentDir });
}
```

**目标 LOC 估算**：facade 新增 55 LOC；include.ts 0 LOC 改动。

## 3. 迁移步骤（2 PR）

### PR 1 — ✅ loadProjectContextFiles 接入（**已完成 2026-09-11**）
1. ✅ 新增 `resource-pi.ts` typed facade（55 LOC）
2. ✅ barrel 6 个 re-export + `loadProjectContextFiles` adapter
3. ✅ `__tests__/resource-pi.test.ts` 3 个 vitest 用例（mock pi，验证 spec 名 → pi 名翻译 + 构造函数签名）
4. ✅ tsc 0 error；vitest 3/3 通过

### PR 2 — renderer / pi-runtime-coordinator 接入 resource-pi.ts
1. `pi-runtime-coordinator.ts` 在多 session 启动时调用 `loadProjectContextFiles(projectRoot, agentDir)` 把 pi 的 AGENTS.md / CLAUDE.md 内容塞进 session 上下文
2. 跑 vitest：session 启动 → context files 注入验证
3. 跑 e2e：plugin 安装后自动加载 project context

## 4. 测试策略

- 单元：`__tests__/resource-pi.test.ts`（PR 1 已落地，3/3 通过）
- 集成：`tests/electron/session-context-injection-e2e.spec.ts`（**PR 2 待写**）

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 pi 默认 gitignore 规则与 OpenBuddy 不同 | 漏文件 | .openbuddyignore 未识别 | **pi 上游无 `respectGitignore` 选项**；由 pi `DefaultResourceLoader` 内部决定；facade 不假装支持 |
| R2 token budget 算法差异 | 超预算 | pi 默认按 word count | **pi 上游无 `tokenBudget` 选项**；facade 不暴露 |
| R3 二进制文件过滤缺失 | 渲染崩溃 | pi 默认仅按扩展名 | 由 pi 上游决定；adapter 不二次实现 |

## 6. 验收命令（PR 1 已落地）

```bash
npx tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit   # exit 0 ✅
npx vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/resource-pi.test.ts   # 3/3 ✅
bash scripts/audit/pi-upstream-coverage.sh --json | jq '.unusedByDomain.resource'   # 走查
```

## 7. 与其他 G-gap 关系

- 依赖 G3（profile-manager 落地，include.ts 是其下游）— **独立**
- 解锁 G8（29 canonical e2e 验证 context 加载）— **PR 2**

## 8. 进度更新

`plan4.1.md §3 Phase E` / `docs/PI_INTEGRATION_BACKLOG.md §2 G9` 状态联动；`pi-upstream-coverage.sh` unusedByDomain.resource 自动反映。

## 9. Spec audit（Round 12，第 4 次连续失败）

| Spec 假设 | 实际 | 应对 |
|---|---|---|
| include.ts 是 350 LOC context file loader | **128 LOC Cordis harness plugin entry loader**（不同概念） | facade 新增，不动 include.ts |
| `loadProjectContextFiles(projectRoot, patterns, options)` 异步 + 接收 patterns | `loadProjectContextFiles({ cwd, agentDir }): Array<{path, content}>` 同步 + 单 options bag | facade named-arg adapter `(projectRoot, agentDir)` |
| `respectGitignore` / `tokenBudget` / `onError` 可选参数 | pi 上游**无**这些参数 | facade **不假装**支持 |
| 自实现删除 ~300 LOC | include.ts 不是 context loader；删除的是 facade 不需要删除的代码 | 0 LOC 删除，新增 55 LOC |

**根因总结**：spec 是 backlog "假设性重构"模板写的，**没有动手前 grep `wc -l include.ts`** + **读 `node_modules/.../resource-loader.d.ts`**。补救策略：**未来所有 G-gap 实施前，第一动作必须是 `wc -l <file>` + `cat node_modules/.../d.ts | grep '<symbol>'`**。