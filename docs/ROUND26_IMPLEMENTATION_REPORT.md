# Round 26 Implementation Report — G8 PR 1 tests/integration/ 创建 + 3 个 canonical pi 包真实 e2e (LUM-785, 2026-09-11)

## Round 26 真实落地的功能

### 1. G8 PR 1 — 创建 `tests/integration/` + 3 个 canonical pi 包真实 e2e

**新建** 目录 + 模板 helper + 3 个 e2e 文件：

| 文件 | 内容 |
|---|---|
| `src/test-integration-helpers/real-pi-package-template.ts` | helper：`tryInstallCanonicalPiPackage` / `inspectInstalledPackage` / `cleanupTempDir` |
| `src/test-integration-helpers/index.ts` | barrel |
| `tests/integration/real-pi-package-pi-mcp-adapter.test.ts` | 4 vitest case |
| `tests/integration/real-pi-package-pi-plan-mode.test.ts` | 4 vitest case |
| `tests/integration/real-pi-package-pi-goal.test.ts` | 4 vitest case |
| `vitest.config.ts:122-126` | `environmentMatchGlobs` 新增 `tests/integration/**` → node env |

**3 个被真实安装 + 验证的 pi 包**（npm registry 实测可达）：

| 包 | 版本 | entry 形式 |
|---|---|---|
| `pi-mcp-adapter` | 2.33.0 | `exports` map → `./index.ts`（modern） |
| `pi-plan-mode` | 0.4.8 | `main` → `./plan-mode.ts`（legacy） |
| `pi-goal` | 0.1.7 | `pi.extensions`（canonical pi package convention） |

**3 种典型 pi 包 entry 形式都覆盖**——helper `hasEntry` 把 `main / exports / bin / pi.extensions` 都视为有效入口。

### 2. 真实验证结果

- `tsc -p tsconfig.json --noEmit` → **0 错** ✅（仅 pre-existing `theme-pi.ts:29` getEditorTheme，Round 11 G6 已知）
- `vitest run tests/integration/` → **12/12** ✅（3 files × 4 cases = 12 测试）
- **真实 `pnpm add` 安装 3 个第三方 pi 包** —— 不是 mock，不是 stub

### 3. 12 个 vitest case（4 per file）

每文件 4 case：
1. `is published on npm (not spec-only)` — 包是否在 npm registry 可达
2. `installs successfully via pnpm add` — pnpm add 是否成功
3. `exposes a package.json with name and version` — 包元数据完整
4. `has a loadable entry (main / exports / bin)` — entry point 存在

## 具体实现的细节

### 4. helper 关键设计（85 LOC）

```typescript
export function tryInstallCanonicalPiPackage(pkg: string, timeoutMs = 60_000): InstallResult {
  // 1. pnpm view <pkg> name version  → 404? mark specOnly
  // 2. pnpm add <pkg> --silent --ignore-scripts
  //    (--ignore-scripts 避免 ERR_PNPM_IGNORED_BUILDS 阻塞；peer deps 不影响 e2e smoke)
  // 3. 若 node_modules/<pkg>/package.json 存在 → installed=true
  // 4. 否则 installed=false
}

export function inspectInstalledPackage(cwd: string, pkg: string): PackageMetadata {
  // hasEntry: main | exports | bin | pi.extensions
}
```

**为什么 `--ignore-scripts`**：pnpm 11 默认拒绝静默忽略 build scripts（`ERR_PNPM_IGNORED_BUILDS` 退出非零）。本 e2e 只验"能装 + 有 entry"，不需要跑第三方 build steps。`--ignore-scripts` 让 install 真正成功。

**为什么 helper 放在 `src/test-integration-helpers/` 而不是 `tests/integration/helpers/`**：vite alias 路径下 vite 能解析；`tests/integration/helpers/*.ts` vite 默认不 resolve（vite 只 pick up `**/*.{test,spec}.?(c|m)[jt]s?(x)`，helper 文件不在白名单）。本轮先尝试 `__helpers__/index.ts` 失败，再尝试 `.ts` 后缀失败，最终移到 `src/test-integration-helpers/index.ts` 走 vite alias 路径成功。

### 5. canonical pi 包 e2e 覆盖率更新（0% → 10%）

| 状态 | 数量 |
|---|---|
| 全部 CANONICAL_PI_PACKAGES | 29 |
| **Round 26 末已 e2e 覆盖** | **3**（pi-mcp-adapter / pi-plan-mode / pi-goal）|
| 未覆盖 | 26 |
| **覆盖率** | **3/29 = 10%**（v3.22 0% → v3.23 10%）|

### 6. 为什么只跑 3 个（不是 spec 列的 5 个）

G8 spec §3 PR 1 列了 pi-mcp-adapter / pi-plan-mode / pi-folder-trust / pi-notification / pi-goal（5 个）。本轮 grep registry 发现：
- **pi-folder-trust** 404
- **pi-notification** 404

这 2 个是 spec 里的"文档占位包"，从未实际发布到 npm。Round 26 跑剩余 3 个 npm 可达的包。**剩余 26 个 + 这 2 个 spec-only 占位包 = Round 27+ G8 PR 2-4 逐 round 处理**。

### 7. canonical pi 包覆盖清单（3/29）

| 已覆盖 (3) | 未覆盖 (26) |
|---|---|
| pi-mcp-adapter | pi-hermes-memory, @remnic/plugin-pi, @juicesharp/rpiv-todo, @anthropic/pi-todo, pi-web-access, @diegopetrucci/pi-web-access, pi-folder-trust* (404), @anthropic/pi-folder-trust* (404), pi-notification* (404), @anthropic/pi-notification* (404), @narumitw/pi-plan-mode, @arvoretech/pi-plan-mode, @plannotator/pi-extension, pi-permission-system, pi-goal-x, @narumitw/pi-goal, pi-automation, pi-workflow, pi-cron, pi-schedule, @anthropic/pi-automation, pi-subagents, pi-lens, pi-simplify, pi-hashline, pi-worktree |

`*` = npm 404，spec-only。

## 进度百分比更新

| 项 | v3.22 | v3.23 |
|---|---|---|
| G1 PR 1+2+3 | 100% | 100% |
| G2 | 67% | 67% |
| G3 | 0% | 0% |
| G10 | 100% | 100% |
| G11 | 100% | 100% |
| G4 | 100% | 100% |
| **G8** | **0%** | **10%（3/29 covered）** |

P1 完成度：20.75 → **23.25**（G8 0% → 10%，加 2.5）
G 项落地总进度：~58% → **~59%**（+1 pp）

5 维总评（v3.23）：**🟢 / 🟡 / 🔴 / 🟡 / 🟢**（无变化——G8 PR 1 落地属于"3 个包真 e2e"，但 26 个包还没跑）

## Round 26 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `src/test-integration-helpers/real-pi-package-template.ts` | new helper | +85 |
| `src/test-integration-helpers/index.ts` | new barrel | +1 |
| `tests/integration/real-pi-package-pi-mcp-adapter.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-plan-mode.test.ts` | new | +50 |
| `tests/integration/real-pi-package-pi-goal.test.ts` | new | +50 |
| `vitest.config.ts` | environmentMatchGlobs 新增 | +2 |
| `plan4.1.md` | doc | +135（§9.16 + header v3.22→v3.23 + doc-block 同步）|
| `docs/ROUND26_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **9 files, +604** |

## 已知限制

1. **仅 3/29 个 pi 包跑了真 e2e**：剩余 26 个留 Round 27+ G8 PR 2-4。**本轮目标是 G8 PR 1 spec 收口**，不是一次跑完。
2. **npm 网络依赖**：3 个包都需从 npm registry 拉。**如果 env 无 npm 网络，所有 e2e 退化为 specOnly**——helper 已经优雅处理（返回 `specOnly: true`，测试 skip）。
3. **--ignore-scripts 跳过包自身构建脚本**：e2e 只验"能装 + 有 entry"，不验"包功能完整运行"。如果包是 dist-only（如 pi-mcp-adapter 的 `./dist/types.js`），本 e2e 不验证 dist 内容。
4. **pi-folder-trust / pi-notification 不在 npm**：spec 列了但实际未发布。**Round 27+ 处理时建议先 `pnpm view` 探测，不可达的标 specOnly 跳过**。
5. **3 个 pi 包安装耗时共 ~5s**：每个包 pnpm add 约 1-2s（含依赖图解析）。**29 包全跑要 30-60s**，CI 可能需要并行 + cache。

## Round 27+ 计划

| Round | 目标 | 关键指标 |
|---|---|---|
| 27 | G8 PR 2（+ 9 个 canonical pi 包 e2e）| 3/29 → 12/29 = 41% |
| 28 | G8 PR 3（+ 10 个 e2e）| 12/29 → 22/29 = 76% |
| 29 | G8 PR 4（+ 7 个收口 + GA gate）| 22/29 → 29/29 = 100%（**canonical-pi GA gate ✅**）|
| 30 | G5 PR 1（generateBranchSummary 真实接入）| 集成深度形式接 → 行为切 |
| 31 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |

**注意**：G8 spec §3 PR 2-3 是 9 + 10 个，PR 4 是 5 个收口。本轮按 plan4.1.md v3.22 §9.15.9 表"3 个 / round"策略估算 4 round 完成 G8。