# G1 实现规格：apply-patch.ts 替换为 pi-tool-factories

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase B + backlog G1
>
> 本文档是 **Phase B 入口**，把 `electron/main/agent/extensions/apply-patch.ts` 的自实现
> `apply_patch` + `apply_command` 用 pi 上游 `createBashTool / createReadTool / createWriteTool /
> createEditTool` 替换的**详细迁移规格**。
>
> **状态**：规格已落地（2026-09-11 Round 7）。代码改动需 dev-env + pi 0.85.x 安装后才可执行。
> **关联 audit**：`scripts/audit/extensions-inventory.sh`（Round 6 第 5 个 audit）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `electron/main/agent/extensions/apply-patch.ts`（228 LOC）|
| 当前 LOC | 228（GA gate: `< 100`，差距 -128）|
| 测试文件 | `electron/main/agent/extensions/__tests__/apply-patch.test.ts` + `apply-patch-r2.test.ts` |
| 替换目标 | `electron/main/agent/extensions/pi-tool-factories.ts`（新建） |
| 涉及 pi API | `createBashTool / createReadTool / createWriteTool / createEditTool / createGrepTool / createFindTool / createLsTool` |
| Owner | runtime team |
| 估时 | 3 周 |
| 阻塞 | 需 `pnpm install` + pi 0.85.x 安装 |
| 风险等级 | 中（apply_patch 是第三方模型 schema 兼容层） |

---

## 1. 当前实现盘点（apply-patch.ts）

来源：`grep -nE "^(export|function|interface|type)" apply-patch.ts`

```
29  interface ParsedHunk
36  interface ParsedDiff
43  function parseUnifiedDiff(filePath, patch)   : ParsedDiff       // ~30 LOC
74  function applyHunks(original, parsed)        : string           // ~25 LOC
95  export interface OpenBuddyApplyPatchConfig
100 export default function openBuddyApplyPatch  // ~125 LOC，包含 apply_patch + apply_command 工具 schema
```

**当前覆盖的工具**：
1. `apply_patch` — unified diff 格式 patch 应用（自实现）
2. `apply_command` — shell 命令执行（绕开 pi bash tool，直接 `child_process.execFile`）

**缺失的工具**（renderer 端从未可用）：
- `grep` / `find` / `ls`（grepTool/findTool/lsTool）
- `read` / `write` / `edit`（readTool/writeTool/editTool 单文件版）

## 2. 目标实现（pi-tool-factories.ts 蓝图）

```typescript
// electron/main/agent/extensions/pi-tool-factories.ts (新文件)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBashTool, createReadTool, createWriteTool, createEditTool,
  createGrepTool, createFindTool, createLsTool,
} from "@earendil-works/pi-coding-agent";

import { openBuddyFolderTrustAdapter } from "../host-modules/folder-trust-adapter";
import { openBuddyPermissionAdapter } from "../host-modules/permission-adapter";
import { openBuddyAuditLogAdapter } from "../host-modules/audit-log-adapter";
import { openBuddyShellConfigAdapter } from "../host-modules/shell-config-adapter";

export interface OpenBuddyToolFactoryOptions {
  folderTrust: ReturnType<typeof openBuddyFolderTrustAdapter>;
  permission: ReturnType<typeof openBuddyPermissionAdapter>;
  auditLog: ReturnType<typeof openBuddyAuditLogAdapter>;
}

export function registerOpenBuddyPiTools(pi: ExtensionAPI, opts: OpenBuddyToolFactoryOptions): void {
  // 1. bash — 替换 apply_command
  pi.registerTool(createBashTool({
    shellConfig: openBuddyShellConfigAdapter(opts),
    permission: opts.permission,
    auditLog: opts.auditLog,
  }));

  // 2. read / write / edit — 替换 apply_patch 的文件读写部分
  pi.registerTool(createReadTool({
    folderTrust: opts.folderTrust,
    permission: opts.permission,
    auditLog: opts.auditLog,
  }));
  pi.registerTool(createWriteTool({ /* 同上 */ }));
  pi.registerTool(createEditTool({ /* 同上 */ }));

  // 3. grep / find / ls — 之前缺失，pi 直接补齐
  pi.registerTool(createGrepTool({ /* 同上 */ }));
  pi.registerTool(createFindTool({ /* 同上 */ }));
  pi.registerTool(createLsTool({ /* 同上 */ }));
}
```

**目标 LOC 估算**：注册代码 ≤ 80 LOC + 4 个 adapter 文件各 ≤ 30 LOC = 总计 ≤ 200 LOC（包含 4 个 adapter），但 `apply-patch.ts` 本身可缩到 ≤ 50 LOC 作为**第三方模型 schema 兼容 shim**（仅在 `apply_patch` schema 仍被模型识别时保留）。

**GA gate 满足**：apply-patch.ts 保留 ≤ 50 LOC（兼容 shim）or 0 LOC（完全删除）。

## 3. 迁移步骤（按 PR 拆分）

### PR 1 — adapter 抽取（基础设施）
1. 新建 `electron/main/agent/host-modules/folder-trust-adapter.ts`（≤ 30 LOC）— 把 `apply-patch.ts` 的 folder-trust 检查抽出来
2. 新建 `permission-adapter.ts` / `audit-log-adapter.ts` / `shell-config-adapter.ts`（同样）
3. `apply-patch.ts` 改用 adapter（**不删除 apply_patch**，仅做依赖抽取）
4. 跑 audit：`hotspots.applyPatch` 不变（仍是 228），但 `apply-patch.ts` 已可独立测试

### PR 2 — 新增 pi-tool-factories.ts（并行实现）
1. 新建 `pi-tool-factories.ts`（≤ 80 LOC，含 `registerOpenBuddyPiTools`）
2. 新建 `pi-tool-factories.test.ts`：7 个工具各 3 个 case = 21 个 vitest
3. `pi-extensions.ts:968` 的 `builtinPiExtensionFactories` record 加 `"openbuddy-pi-tools": (emit, config, options) => (pi) => registerOpenBuddyPiTools(pi, { folderTrust, permission, auditLog })`
4. 跑 audit：`extensions-inventory.builtinExtensionNames.count` 应该从 10 → 11
5. **不删除** `apply-patch.ts`，**不删除** `openbuddy-apply-patch` builtin（双轨并行 1 周）

### PR 3 — apply_patch → bash+edit 工具组合（迁移）
1. 修改第三方模型工具定义 schema 适配层：`apply_patch` 改为"组合调用 bash + edit"，或**直接删除**（取决于第三方模型是否还识别 apply_patch schema）
2. `openbuddy-apply-patch` builtin 从 record 删除
3. `apply-patch.ts` 删除（或保留 ≤ 50 LOC 作为 fallback）
4. 跑 audit：`hotspots.applyPatch` 必须 ≤ 100（GA gate）
5. 跑 vitest：所有 31 个 `extensions/__tests__/apply-patch*.test.ts` 必须通过（已迁移到 `pi-tool-factories.test.ts`）

### PR 4 — GA gate 收口
1. 删除 `parseUnifiedDiff` / `applyHunks` 自实现（除非有第三方模型硬依赖）
2. 跑 `bash scripts/audit/extensions-inventory.sh`：`hotspots.applyPatch < 100` ✅
3. 跑 `pnpm typecheck`：0 error
4. 跑 `pnpm workspace:test`：542 / 5517 全过
5. 跑 `pnpm test:electron:agent-workbench-core`：Electron smoke 全过

## 4. 测试策略

| 测试类型 | 文件 | 数量 |
|---|---|---|
| 单元（PR 2 新增） | `pi-tool-factories.test.ts` | 21（7 tool × 3 case）|
| 迁移（PR 3）| `extensions/__tests__/apply-patch*.test.ts` → `pi-tool-factories.test.ts` | 31 → 21（去重）|
| 集成（PR 4）| `tests/electron/agent-workbench-core.spec.ts` | 现有 + 新增 apply_patch → bash+edit round-trip |
| 性能（PR 4）| `tests/electron/perf-streaming-burst.spec.ts` | 验证工具延迟不变 |

**测试目标**：`pnpm workspace:test` 通过率 ≥ 99.5%（容忍环境偶发 timeout）。

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 pi 0.86.x 升级破坏 createBashTool API | 7 个工具全部需重写 | pi 升级 | PR 1 adapter 抽象隔离 pi API |
| R2 第三方模型硬依赖 apply_patch schema | 删除后模型调用失败 | 评测脚本跑出 | PR 3 保留 50 LOC fallback |
| R3 31 个 apply-patch 测试迁移成本 | 工期 +1 周 | 测试结构差异大 | PR 2 平行实现，PR 3 渐进迁移 |
| R4 bash tool 沙箱未实现 | 任意命令执行风险 | security audit 失败 | openBuddyFolderTrustAdapter 接 G15 PKCE 已落地的 keychain |
| R5 audit log adapter 性能 | 每次工具调用写盘，IO 瓶颈 | Electron smoke 慢 | 异步批写 + 自定义 level filter |

## 6. 验收命令（自动）

```bash
# 1. 静态 audit
bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.applyPatch < 100'   # → true
bash scripts/audit/extensions-inventory.sh --json | jq '.builtinExtensionNames.count == 11'  # → true（PR 2+）

# 2. 单元测试
pnpm workspace:test -- extensions/pi-tool-factories.test.ts  # 21 通过

# 3. 类型检查
pnpm typecheck  # 0 error

# 4. 集成 smoke
pnpm test:electron:agent-workbench-core  # 全过

# 5. GA gate (plan4.1 §5)
bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.applyPatch < 100'   # true
```

## 7. 与其他 G-gap 的关系

- **依赖 G2**（SettingsManager 落地）：bash tool 的 sandbox / permission 配置项需要 typed settings；G2 先落地才能给 bash tool 注入。
- **依赖 G7**（shell config）：`openBuddyShellConfigAdapter` 是 G7 的产物。
- **解锁 G11**（manifest parseFrontmatter）：apply_patch 删除后，plugin manifest 解析可以更彻底地走 pi `parseFrontmatter`（之前受 apply-patch 残留牵制）。

## 8. 进度更新

实施完成时按以下顺序更新 plan4.1.md：

1. `plan4.1.md §3 Phase B` 状态：`⬜ → 🟡 → ✅`
2. `docs/PI_INTEGRATION_BACKLOG.md §1 G1` 状态：`⬜ → 🟡 → ✅`
3. `docs/PI_NATIVE_AUDIT_BASELINE.md §0` GA gate 行：`apply-patch LOC ❌ → ✅`
4. `scripts/audit/extensions-inventory.sh` 的 GA gate `hotspots.applyPatch` 字段自动反映
5. 本规格 §0 状态：`规格已落地 → 实施完成 → 合并`