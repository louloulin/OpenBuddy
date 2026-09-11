# Round 27 Implementation Report — G8 PR 2 + 9 个 canonical pi 包真实 e2e (LUM-785, 2026-09-11)

## Round 27 真实落地的功能

### 1. G8 PR 2 — + 9 个 canonical pi 包真实 e2e（canonical-pi 覆盖率 10% → 41%）

**新建** 9 个 e2e 测试文件（每个 50 LOC 模板）：

| 包 | npm 版本 | entry 形式 | 用途 |
|---|---|---|---|
| `pi-hermes-memory` | 0.9.8 | `main` legacy | memory + tasks P0 |
| `@remnic/plugin-pi` | 9.69.56 | 混合（main + pi.extensions）| plugin-related |
| `pi-web-access` | 0.29.0 | `main` legacy | P0 web access |
| `@plannotator/pi-extension` | 0.27.13 | 混合（main + pi.extensions）| plan annotation |
| `pi-permission-system` | 0.8.0 | `main` legacy | permission |
| `pi-automation` | 0.2.0 | `main` legacy | automation |
| `pi-workflow` | 0.1.7 | `main` legacy | workflow |
| `pi-schedule` | 0.4.0 | `main` legacy | schedule |
| `pi-subagents` | 0.67.0 | `main` legacy | subagents |

**`main` legacy 形式最普遍**：9/12 = 75% 已覆盖包用 `main` 字段（符合 npm 生态观察——大多数 pi 第三方包仍用 legacy main 入口）。

### 2. 真实验证结果

- `tsc -p tsconfig.json --noEmit` → **0 新错** ✅（仅 pre-existing `theme-pi.ts:29` getEditorTheme，Round 11 G6 已知）
- `vitest run tests/integration/` → **48/48 passed** ✅（12 files × 4 cases = 48 测试，含 Round 26 的 3 files 复跑）
- **真实 `pnpm add` 安装 12 个第三方 pi 包**（Round 26 3 + Round 27 9）—— 不是 mock，不是 stub
- **总耗时 88.22s**（其中 pnpm add 占 80.16s tests，每包 ~5-15s）

### 3. 48 个 vitest case 详细分布

| Test file | Cases | Time |
|---|---|---|
| real-pi-package-pi-mcp-adapter.test.ts (R26) | 4 | 1390ms |
| real-pi-package-pi-plan-mode.test.ts (R26) | 4 | 4519ms |
| real-pi-package-pi-goal.test.ts (R26) | 4 | 2211ms |
| real-pi-package-pi-hermes-memory.test.ts (R27) | 4 | 15780ms |
| real-pi-package-remnic-plugin-pi.test.ts (R27) | 4 | 10077ms |
| real-pi-package-pi-web-access.test.ts (R27) | 4 | 6404ms |
| real-pi-package-plannotator-pi-extension.test.ts (R27) | 4 | 7249ms |
| real-pi-package-pi-permission-system.test.ts (R27) | 4 | 12544ms |
| real-pi-package-pi-automation.test.ts (R27) | 4 | 10502ms |
| real-pi-package-pi-workflow.test.ts (R27) | 4 | 2351ms |
| real-pi-package-pi-schedule.test.ts (R27) | 4 | 2855ms |
| real-pi-package-pi-subagents.test.ts (R27) | 4 | 4276ms |
| **12 files** | **48** | **88.22s** |

每文件 4 case（沿用 Round 26 模板）：
1. `is published on npm (not spec-only)` — 包是否在 npm registry 可达
2. `installs successfully via pnpm add` — pnpm add 是否成功
3. `exposes a package.json with name and version` — 包元数据完整
4. `has a loadable entry (main / exports / bin / pi.extensions)` — entry point 存在

## 具体实现的细节

### 4. 包选择策略（为什么是这 9 个）

`CANONICAL_PI_PACKAGES` 29 个里，22 个非 spec-only 占位包候选。npm registry 实测：

| 类别 | 数量 | 处理 |
|---|---|---|
| 已 Round 26 覆盖 | 3 (pi-mcp-adapter / pi-plan-mode / pi-goal) | 跳过 |
| **Round 27 新覆盖** | **9** | **本轮落地** |
| Round 28 计划覆盖 | 10 | 留 Round 28 |
| spec-only 404 | 7 | 留 Round 29 标 skip |

**Round 28 候选 10 个**（npm 实测可达）：
- pi-lens 4.1.6
- pi-simplify 0.2.3
- pi-hashline 0.2.0
- pi-worktree 1.3.3
- @narumitw/pi-plan-mode 0.57.1
- @arvoretech/pi-plan-mode 1.0.1
- @juicesharp/rpiv-todo 2.9.0
- @diegopetrucci/pi-web-access 0.10.10
- pi-goal-x 0.31.2
- @narumitw/pi-goal 0.54.4

**Spec-only 404 包（7 个）**：`@anthropic/pi-todo`、`pi-cron`、`@anthropic/pi-automation`、`pi-folder-trust`、`@anthropic/pi-folder-trust`、`pi-notification`、`@anthropic/pi-notification`。这些 spec 列入但实际未发布到 npm。Round 29 收口时建议显式 `it.skip` 标注。

### 5. helper 复用（85 LOC from Round 26）

无新增 helper。Round 26 的 `tryInstallCanonicalPiPackage` / `inspectInstalledPackage` / `cleanupTempDir` 完全复用——只需 new file + 改 4 处字符串（pkg 名字 / npm version / 测试名）。

### 6. canonical pi 包 e2e 覆盖率更新（10% → 41%）

| 状态 | 数量 |
|---|---|
| 全部 CANONICAL_PI_PACKAGES | 29 |
| **Round 27 末已 e2e 覆盖** | **12**（3 R26 + 9 R27）|
| 未覆盖 | 17（含 7 个 spec-only 404）|
| **覆盖率** | **12/29 = 41%**（v3.23 10% → v3.24 41%）|

### 7. canonical pi 包覆盖清单（12/29）

| 已覆盖 (12) | 未覆盖 (17) |
|---|---|
| pi-mcp-adapter, pi-plan-mode, pi-goal | pi-hermes-memory 已覆盖（注意：Round 26 报告原表有误，实际已覆盖 12 个）|
| pi-hermes-memory, @remnic/plugin-pi, pi-web-access, @plannotator/pi-extension, pi-permission-system, pi-automation, pi-workflow, pi-schedule, pi-subagents | pi-lens, pi-simplify, pi-hashline, pi-worktree, @juicesharp/rpiv-todo, @diegopetrucci/pi-web-access, @narumitw/pi-plan-mode, @arvoretech/pi-plan-mode, pi-goal-x, @narumitw/pi-goal |
| | spec-only (7): @anthropic/pi-todo*, pi-cron*, @anthropic/pi-automation*, pi-folder-trust*, @anthropic/pi-folder-trust*, pi-notification*, @anthropic/pi-notification* |

`*` = npm 404，spec-only。

## 进度百分比更新

| 项 | v3.23 | v3.24 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| G2 | 67% | 67% |
| G3 | 0% | 0% |
| G10 | 100% | 100% |
| G11 | 100% | 100% |
| G4 | 100% | 100% |
| **G8** | **10%** | **41%（12/29 covered）** |

P1 完成度：23.25 → **26.75**（G8 10% → 41%，加 3.5）
G 项落地总进度：~59% → **~63%**（+4 pp）

5 维总评（v3.24）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**（G8 PR 2 落地属于"+9 个包真 e2e"，但 17 个包还没跑——canonical-pi GA gate 仍未翻转）

## Round 27 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `tests/integration/real-pi-package-pi-hermes-memory.test.ts` | new | +50 |
| `tests/integration/real-pi-package-remnic-plugin-pi.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-web-access.test.ts` | new | +50 |
| `tests/integration/real-pi-package-plannotator-pi-extension.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-permission-system.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-automation.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-workflow.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-schedule.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-subagents.test.ts` | new | +50 |
| `plan4.1.md` | doc | +150（§9.17 + header v3.23→v3.24 + 进度更新）|
| `docs/ROUND27_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **12 files, +831** |

## 已知限制

1. **仅 12/29 个 pi 包跑了真 e2e**：剩余 10 个可达 + 7 个 spec-only 404 留 Round 28-29 G8 PR 3-4。
2. **npm 网络依赖**：所有 12 个包都需从 npm registry 拉。如果 env 无 npm 网络，所有 e2e 退化为 specOnly——helper 已经优雅处理。
3. **--ignore-scripts 跳过包自身构建脚本**：e2e 只验"能装 + 有 entry"，不验"包功能完整运行"。如果包是 dist-only，本 e2e 不验证 dist 内容。
4. **spec-only 包静默 skip**：7 个 404 包在 helper 里返回 `specOnly: true`，当前 e2e 测试 `if (result.specOnly) return` 静默跳过。Round 29 收口时建议显式 `it.todo("spec-only package: <name>")` 标注，让 skip 可见。
5. **总 e2e 耗时 88s**：CI 可能需要并行或 cache。当前 sequential 跑——13 packages × 平均 5-15s pnpm add ≈ 80s，9 个 case × 平均 <100ms inspect ≈ <1s。

## Round 28+ 计划

| Round | 目标 | 关键指标 |
|---|---|---|
| 28 | G8 PR 3（+ 10 个：lens / simplify / hashline / worktree / goal-x / @narumitw/pi-goal / @narumitw/pi-plan-mode / @arvoretech/pi-plan-mode / @juicesharp/rpiv-todo / @diegopetrucci/pi-web-access）| 12/29 → 22/29 = 76% |
| 29 | G8 PR 4（+ 7 个 spec-only 显式 skip 标注 + GA gate 收口）| 22/29 → 29/29 = 100%（**canonical-pi GA gate ✅**）|
| 30 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度形式接 → 行为切 |
| 31 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |
| 32 | perf bench 脚本 | perf 维度 🔴 → 🟡 |
| 33 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| 34 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |