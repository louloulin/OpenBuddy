# G8 实现规格：29 个 CANONICAL_PI_PACKAGES e2e 全覆盖

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase E + backlog G8
>
> **状态**：规格已落地（2026-09-11 Round 8）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前 e2e 覆盖 | 0 / 29 |
| 涉及 pi 包 | 29 个（详见 `docs/PI_NATIVE_AUDIT_BASELINE.md` §1.3）|
| Owner | runtime + QA team |
| 估时 | 3 周 |
| 阻塞 | 需创建 `tests/integration/` 目录 + dev-env + 网络 |
| 风险等级 | 中（每个 pi 包 install / 启动 / 卸载路径可能不稳）|

---

## 1. 当前实现盘点

```
tests/integration/    : 不存在（v3.2 audit 发现）
tests/unit/           : 不存在
tests/electron/       : 27 .spec.ts（OpenBuddy 自己的 e2e）
electron/main/agent/pi-extension-discovery.ts:20-50  : 29 个 CANONICAL_PI_PACKAGES 列表
```

29 个 missing package（来自 `scripts/audit/canonical-packages-e2e.sh`）：

```
pi-hermes-memory, @remnic/plugin-pi, @juicesharp/rpiv-todo, @anthropic/pi-todo,
pi-web-access, @diegopetrucci/pi-web-access, pi-mcp-adapter,
pi-plan-mode, @narumitw/pi-plan-mode, @arvoretech/pi-plan-mode, @plannotator/pi-extension,
pi-permission-system,
pi-folder-trust, @anthropic/pi-folder-trust,
pi-notification, @anthropic/pi-notification,
pi-goal, pi-goal-x, @narumitw/pi-goal,
pi-automation, pi-workflow, pi-cron, pi-schedule, @anthropic/pi-automation,
pi-subagents,
pi-lens, pi-simplify, pi-hashline, pi-worktree
```

## 2. 目标实现

**核心策略**：1 包 1 e2e 文件，统一模板。

```typescript
// tests/integration/real-pi-package-pi-mcp-adapter.test.ts (示例)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("pi-mcp-adapter real install", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "pi-e2e-"));
    execSync("pnpm add pi-mcp-adapter", { cwd: tmp, stdio: "inherit" });
  });
  afterAll(() => rmSync(tmp, { recursive: true }));

  it("installs without errors", () => {
    expect(() => execSync("node -e \"require('pi-mcp-adapter')\"", { cwd: tmp })).not.toThrow();
  });

  it("exposes main entry", () => {
    const pkg = require(join(tmp, "node_modules/pi-mcp-adapter/package.json"));
    expect(pkg.main).toBeDefined();
  });
});
```

**目标**：29 个 e2e 文件，每个 20-40 LOC，总计 ~700 LOC。

## 3. 迁移步骤（4 PR）

### PR 1 — 创建 tests/integration 目录 + 模板
1. 新建 `tests/integration/__helpers__/real-pi-package-template.ts`（含 install / load / 校验函数）
2. 新建 5 个 e2e 文件（pi-mcp-adapter / pi-plan-mode / pi-folder-trust / pi-notification / pi-goal），跑通
3. 跑 vitest 验证模板可复用

### PR 2 — 9 个 e2e（automation / workflow / cron / subagents / etc.）
1. 按 missing 列表生成 9 个 e2e
2. 跑 vitest 全部通过

### PR 3 — 10 个 e2e（plan-mode / todo / web-access / etc.）
1. 按 missing 列表生成 10 个 e2e
2. 跑 vitest 全部通过

### PR 4 — 收口 + GA gate
1. 5 个剩余 e2e
2. 跑 audit：`bash scripts/audit/canonical-packages-e2e.sh --json | jq '.covered == 29'` ✅
3. 跑 CI：每次 PR 必跑这 29 个 e2e

## 4. 测试策略

| 测试类型 | 文件 | 数量 |
|---|---|---|
| 集成（29 个）| `tests/integration/real-pi-package-*.test.ts` | 29 |
| 模板 | `tests/integration/__helpers__/real-pi-package-template.ts` | 1 |

**测试目标**：29 个 e2e 全过；CI 必跑项；`covered == 29` 自动断言。

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 第三方 pi 包 npm registry 不可达 | e2e 失败 | 网络 / 包下架 | 提供 mock install 模式 |
| R2 pi 包依赖冲突 | pnpm add 失败 | 包间 peer dep | pnpm overrides |
| R3 第三方 pi 包 API 破坏 | OpenBuddy 集成崩 | pi 升级 | 锁定 pi 版本 |
| R4 安装时间过长 | CI 慢 | 29 个串行 install | 并行 + cache |

## 6. 验收命令

```bash
# 1. 静态 audit
bash scripts/audit/canonical-packages-e2e.sh --json | jq '.covered == 29'   # true

# 2. 集成测试
pnpm workspace:test -- tests/integration   # 全过（29 个）

# 3. CI 集成
pnpm verify:plan:tests  # 必跑
```

## 7. 与其他 G-gap 关系

- 依赖 G3（profile-manager 接管 pi 包 install）
- 解锁 G14（harness server 接入 pi RPC）

## 8. 进度更新

`plan4.1.md §3 Phase E` / `docs/PI_INTEGRATION_BACKLOG.md §2 G8` 状态联动；`scripts/audit/canonical-packages-e2e.sh` 的 covered 字段自动反映。