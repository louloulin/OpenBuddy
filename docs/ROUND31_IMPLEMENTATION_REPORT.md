# Round 31 Implementation Report — G5 PR 2 token budget 接管 + perf bench, G5 100% ✅ (LUM-785, 2026-09-11)

## Round 31 真实落地的功能

### 1. G5 PR 2 — token budget 接管 + perf bench（G5 100% 完成）

**改动**（4 files）：

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `electron/main/agent/branch-summary-format.ts` | + export `DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS` | +20 |
| `electron/main/agent/host-modules/session-store.ts` | import named constant, 替换字面量 | -1/+1 |
| `scripts/perf/branch-summary.mjs` | new bench script（CI 可重跑）| +95 |
| `tests/perf/branch-summary.test.ts` | new vitest perf budget | +75 |

### 2. token budget 接管（8_000 字面量 → named export）

**改前**（v3.27）—— 8_000 字面量重复 3 处：

```typescript
// branch-summary-format.ts
reserveTokens: options.reserveTokens ?? 8_000,    // 1
const prepared = prepareBranchEntries(entries, options.reserveTokens ?? 8_000);  // 2

// session-store.ts:rewindSession
reserveTokens: 8_000,                              // 3
```

**改后**（v3.28）—— 单一 named export：

```typescript
// branch-summary-format.ts
export const DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS = 8_000;
// (JSDoc 解释为什么 8_000：~50 turns typical agent conversation)

reserveTokens: options.reserveTokens ?? DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
const prepared = prepareBranchEntries(entries, options.reserveTokens ?? DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS);

// session-store.ts
import { formatBranchSummary, DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS } from "../branch-summary-format";
reserveTokens: DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
```

**净效果**：
- 3 处字面量 → 1 处 named export（DRY）
- JSDoc 解释为什么 8_000 是合理默认（**~50 turns typical agent conversation**）
- session-store 显式 import 避免隐式耦合

### 3. perf bench（scripts/perf/branch-summary.mjs）

**CI-friendly bench script**：测量 pi-prepare / openbuddy-text 两个路径的 mean ms，输出 JSON report，**ratio > 1.5 时 exit 1**：

```bash
node scripts/perf/branch-summary.mjs                 # sizes=[10, 50, 200], iterations=20
node scripts/perf/branch-summary.mjs --sizes=100,500 # custom sizes
```

**输出格式**：
```json
{
  "bench": "branch-summary",
  "iterations": 20,
  "reserveTokens": 8000,
  "sizes": [10, 50, 200],
  "results": [
    { "entries": 10,  "piPrepareMs": 0.05,  "openbuddyTextMs": 0.07,  "ratio": 1.4,  "pass": true },
    { "entries": 50,  "piPrepareMs": 0.30,  "openbuddyTextMs": 0.45,  "ratio": 1.5,  "pass": true },
    { "entries": 200, "piPrepareMs": 1.20,  "openbuddyTextMs": 1.55,  "ratio": 1.29, "pass": true }
  ],
  "overallPass": true
}
```

**关键设计**：
- **`buildEntries(count)`** 构造 synthetic SessionEntry[]（user/assistant 交替）
- **`benchMs(fn, iterations)`** 含 3 次 warm-up + N 次采样 mean
- **JIT elision 防护**：在 fn 内部 touch result（`if (prepared.messages.length === -1)`），避免 DCE 干掉 call
- **Promise.then handler**：openbuddy-text 是 async，避免 unhandled rejection 警告

### 4. vitest perf budget assertion

`tests/perf/branch-summary.test.ts` 含 2 个 case：
1. `exports a DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS of 8_000`——**守卫 const 漂移**
2. `text-fallback overhead ≤ 1.5x of pi's prepareBranchEntries (size=50)`——**CI gate**

**设计选择**：
- **vitest perf vs standalone**：CI 默认跑 vitest（自动收集），standalone bench script 供手动 / 性能调优用
- **size=50**：与 rewind 真实场景对齐（typical 一次 rewind 看到 ~50 turns）
- **iterations=30 + warm-up=3**：减少 JIT 抖动，结果稳定

### 5. 真实验证结果

- `tsc -p tsconfig.json --noEmit` → **0 新错** ✅（仅 pre-existing `theme-pi.ts:29` getEditorTheme）
- `vitest run electron/main/agent/branch-summary-format.test.ts tests/perf/branch-summary.test.ts` → **21/21 passed** ✅
  - 19 旧 case（向后兼容）
  - 2 新 case（const export + perf budget）
- **perf budget 通过**：size=50 时 openbuddy-text ≤ 1.5x pi-prepare（**G5 PR 2 验收门槛过**）

### 6. 21 个 vitest case 详细分布

| Test file | Cases |
|---|---|
| electron/main/agent/branch-summary-format.test.ts (Round 30) | 19 |
| tests/perf/branch-summary.test.ts (Round 31, new) | 2 |
| **总计** | **21** |

## 具体实现的细节

### 7. G5 全 PR 完成度回顾（R30-31）

| PR | 改动 | 状态 |
|---|---|---|
| G5 PR 1（Round 30）| `formatBranchSummaryWithPi` + `formatBranchSummary` router + session-store.rewindSession 改用 router | ✅ |
| G5 PR 2（Round 31）| `DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS` named export + session-store 改用 + perf bench script + vitest perf budget | ✅ |
| **总计** | **2 / 2 = 100%** | **✅ G5 100% 完成** |

### 8. 5 维总评变化（v3.27 → v3.28）

| 维度 | v3.27 | v3.28 | 原因 |
|---|---|---|---|
| Pi-native utilization | 🟢 | 🟢 | G5 100% 完成（pi LLM 接入 + token budget 接管） |
| Performance | 🔴 | **🟡** | **perf bench script + vitest perf assertion 双层 perf gate 已建立** |
| Code quality | 🟡 | 🟡 | token budget 命名化，DRY |
| Settings plumbed | 🟡 | 🟡 | 未变（settings 未改） |
| GA gate | 🟢 | 🟢 | G5 100% → G5 GA gate ✅ |

### 9. 进度贡献

| 项 | v3.27 | v3.28 |
|---|---|---|
| G1 / G4 / G10 / G11 | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| G2 | 67% | 67% |
| **G5** | **67%（PR 1 完成）** | **100%（PR 1 + PR 2 + perf bench 全完成）✅** |
| G8 | 100% | 100% |

P1 完成度：36.25 → **39.75**（G5 67% → 100%，加 3.5；含 G5 GA gate +5）
G 项落地总进度：~76% → **~81%**（+5 pp）

## Round 31 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `electron/main/agent/branch-summary-format.ts` | + export const | +20 |
| `electron/main/agent/host-modules/session-store.ts` | 1 import + 1 line | -1/+1 |
| `scripts/perf/branch-summary.mjs` | new | +95 |
| `tests/perf/branch-summary.test.ts` | new | +75 |
| `plan4.1.md` | v3.27 → v3.28 + §9.21 | +150 |
| `docs/ROUND31_IMPLEMENTATION_REPORT.md` | new | +230（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **7 files, +571** |

## 已知限制

1. **G5 PR 2 perf 测的是 text-fallback 路径**，不是 pi LLM 路径。LLM 调用耗时取决于 provider + model，远超 prepareBranchEntries（典型 1-5s）。但 LLM 路径无法在 CI 跑（需真 API key），故 perf budget 只覆盖 offline fallback 路径。
2. **`DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS = 8_000` 仍是 hard-coded 常量**。如用户 settings 引入 token budget preference，可加 round 32+ 接入 settings store。
3. **perf bench script 用 size=50 标定**。真实 rewind 可能遇到 200+ entry 长会话；如想覆盖更大 size，本 round 已支持 `--sizes=` 自定义参数。
4. **vitest perf 在 slow CI runner 上可能 fail**：1.5x slack 较紧，慢 runner 上 prepareBranchEntries 本身慢，openbuddy-text 比例更易超。建议 CI runner baseline ≥ 2.0 GHz。

## Round 32+ 计划

| Round | 目标 | 关键指标 |
|---|---|---|
| 32 | G3 PR 1（DefaultPackageManager 接入）| profile-manager.ts 806 → ≤ 200 |
| 33 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| 34 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |

**G5 已 100% 完成**（第三 GA gate ✅）。剩余 GA gate：G3 / G2。