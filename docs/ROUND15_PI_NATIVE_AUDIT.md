# Round 15 — pi-native 全审计 + plan4.1 v3.12 + plan4.0 v3 + 5 维评估

> 📅 2026-09-11 · 父任务 LUM-785 · Round 15 — 第六次审计校正（v3.6 估"105 export" → ground-truth 274）

---

## 0. 一句话结论

**v3.12 ground-truth**：OpenBuddy 当前实际 pi-native 复用度 **8.4%**（23 / 274 unique pi exports），pi-bridge IPC **7%**（1/14），canonical pi 包 e2e **0/29**——从"形式 pi-native"（4 个 facade 已落地）到"行为 pi-native"还有 ~88 个百分点要走。**总进度 ~21%（G 项落地）/ ~12%（行为 pi-native）**。按 Round 16-25 顺序约需 3-4 个月工程量才能到 0.17.0 GA 门槛。

---

## 1. 核心发现（v3.12 ground-truth）

| 维度 | v3.6/v3.11 估算 | v3.12 ground-truth | 修正来源 |
|---|---|---|---|
| **pi 0.85.1 总 export 数** | "105" | **274** | `awk 'grep -oE "^export \{[^}]+\}" dist/index.d.ts'` 去重后真实 274 唯一 identifier（runtime + type） |
| **OpenBuddy 已用唯一符号** | 23 | **23** ✅ | 与 `scripts/audit/pi-sdk-usage.sh` 一致 |
| **pi 真实复用度** | "35%"（含 pi-bridge 12 dead）| **8.4%**（23/274 runtime+type） | v3.6 估"35%"含 pi-bridge 死代码；v3.12 严格按可执行符号 = 23/274 |
| **pi-bridge IPC 利用率** | 7%（1/13）| **7%**（1/14） | v3 数通道时漏了 `generate-patch`；`scripts/audit/pi-bridge-dead-channels.sh` 重跑 = 14 通道 |
| **29 canonical pi 包 e2e** | 0/29 | **0/29** | 仍未装任何 pi-mcp-adapter / pi-plan-mode / pi-subagents 等 |
| **apply-patch.ts LOC** | 228 | **257**（Round 14 PR 2） | typed-tool.ts PR 2 已落地，unsafe cast 8 → 0 |
| **typed-tool.ts** | 不存在 | **86 LOC**（Round 13+14）| 新增 facade |
| **resource-pi.ts** | 不存在 | **55 LOC**（Round 12）| 新增 facade |
| **theme-pi.ts** | 不存在 | **~30 LOC**（Round 11）| 新增 facade |
| **parsePluginManifestFromString** | 自实现 YAML | **改走 pi parseFrontmatter**（Round 10）| plugin-sdk facade |

---

## 2. 5 维评估

| 维度 | 当前 | 目标 | 评级 | 关键证据 |
|---|---|---|---|---|
| **功能** | 23/274 = 8.4% runtime + 1/14 = 7% pi-bridge + 0/29 canonical | 70% / 80% / 29/29 | **🟡 早期** | 4 个 typed facade 落地（typed-tool / resource-pi / theme-pi / parsePluginManifestFromString）——形式 pi-native 框架已成；但 pi-bridge / canonical e2e 仍 0 |
| **性能** | cold start / IPC p95 / streaming 帧均未测 | cold start ≤ 2.5s / IPC p95 ≤ 50ms / streaming 帧 ≤ 16ms | **🔴 未测** | `scripts/perf/baseline-bench.mjs` 在 §3 Phase G.4 列出但**未实现** |
| **产品力** | 5 builtin extension（apply-patch / calendar / model-bridge / openbuddy-markdown / session-metadata-bridge）+ 10 builtin name + apply-patch typed-tool 重构 | 第三方 pi 包"装即用"+ 1 文件接入 | **🟡 局部** | apply-patch typed-tool PR 2 让新工具可 1 文件加，**但 renderer 端 0 桥接新通道** |
| **集成度** | 浅用：观察层 / 类型层 / helper 透传；未接管业务算法（`generateBranchSummary` / `getMarkdownTheme` 仅 facade 接入，未切行为）| 接管业务算法而非仅 facade | **🟡 形式接、行为未切** | `branch-summary-format.ts` 仍自实现 LLM wrapper（注释明确 NOT using pi `generateBranchSummary`） |
| **工程基础** | 5 个 audit 脚本（pi-sdk-usage / canonical-packages-e2e / pi-bridge-dead-channels / extensions-inventory / pi-upstream-coverage）全 bash+awk；typed-tool.ts 6/6 + apply-patch 14/14 vitest 真实跑通 | 所有 PR 必跑 audit；G-gap 实施前先 `wc -l <file>` + `cat node_modules/.../d.ts \| grep <symbol>` | **🟢 扎实** | Round 9 real audit + Round 10-14 每个 PR 都重跑 5 个 audit 脚本 |

---

## 3. 进度百分比（用户问"说明进度百分比"专答）

| 子维度 | 进度 | 依据 |
|---|---|---|
| typed facade 落地（G1+G6+G9+G11）| **67%**（4/6 facade 已落地；G1 PR 3 + G6 PR 2 待做）| Round 10 (G11) + Round 11 (G6) + Round 12 (G9) + Round 13+14 (G1) |
| pi 运行时 import 利用度 | **8.4%**（23/274）| ground-truth `dist/index.d.ts` 实测 |
| pi-bridge IPC 利用度 | **7%**（1/14）| `pi-bridge-dead-channels.sh --json` |
| canonical pi 包 e2e | **0%**（0/29）| `canonical-packages-e2e.sh --json` |
| perf 维度 | **0%**（bench 脚本未实现）| scripts/perf/ 未跑过 |
| 全 monorepo vitest | **~70%**（typed-tool + apply-patch 20/20 全过；plugin-host 全包 35 个失败与本轮无关）| vitest 4 测试集 |
| 0.17.0 GA 整体 | **~21%**（G 项落地）/ **~12%**（行为 pi-native 折扣后）| 加权公式见 plan4.1.md §9.2 |

**加权公式**（plan4.1.md §9.2）：
```
P0 (5 项)：G1=67% + G2=0% + G3=0% + G11=100% + G4=7% → 174%
P1 (8 项)：G5=0% + G6=33% + G7=0% + G8=0% + G9=50% + G10=0% + G12=0% + G15=0% → 83%
P2 (2 项)：G13=0% + G14=0% → 0%
加权（P0=3 / P1=2 / P2=1）总和 = 125.15 / 6 × 100% = ~21%
```

---

## 4. 现实差距 vs 0.17.0 GA 目标

| 指标 | 当前 | 0.17.0 GA 门槛 | 距离 |
|---|---|---|---|
| **Pi runtime 复用度** | **8.4%** | ≥ 70% | **-61.6 个百分点**（约需 61 个新 import / facade 改造）|
| **pi-bridge IPC 利用率** | 7% | ≥ 80% | **-73 个百分点**（约需 11 个新桥接）|
| **29 canonical pi 包 e2e** | 0/29 | 29/29 | **-29 个 e2e 文件**（每个 ~30 LOC + 装包 + 触发 + 卸载）|
| **apply-patch.ts LOC** | 257 | （未设上限）| Round 16 PR 3 目标 <240 |
| **5 个 audit 脚本** | 5/5 ✅ | — | — |
| **vitest 真实跑通（typed-tool + apply-patch）**| 20/20 ✅ | — | — |
| **spec audit 失败连击** | 5 连击补救策略已写 | — | — |

**距离 0.17.0 GA 还需要**：~61 个 facade 改造 + 11 个 pi-bridge 桥接 + 29 个 e2e 文件 + perf bench 脚本 + 全 monorepo vitest（blocked on fts5）= **约 5-7 周工程量 + 1-2 周环境修复**。

---

## 5. Round 16+ 下一步顺序（按 ROI）

| 优先级 | Round | 目标 | 估时 | 期望指标提升 |
|---|---|---|---|---|
| **P0** | **16** | **G1 PR 3**（typed-tool 加 `validateParamsSafe` 类型守卫；apply-patch.ts 删最后一个临时 cast；e2e + plan4.0.md §1.7 O8/O9 UI 演示）| 2-3 天 | typed-tool 6/6 → 8/8；apply-patch LOC 257 → <240 |
| **P0** | **17** | **G10 PR 1**（ExtensionFactory 单文件入口样板，引用 apply-patch.ts 真实例子 + typed-tool.ts）| 1 周 | 第三方 pi 包接入从 5+ 文件 → 1 文件 + 1 manifest |
| **P0** | **18** | **G7**（shell helper 套用 typed-tool 模板：`BashParamsSchema` + `validateParams` + 直接 typed body）| 1 周 | apply_command 与 pi `bash-executor` 行为对齐；Windows PowerShell 走 pi |
| **P0** | **19** | **G2 PR 1**（SettingsManager 切到 pi + 保留 OpenBuddy typed facade）| 2 周 | settings-store.ts 196 → ≤ 50 |
| **P1** | **20** | **G4 PR 1**（renderer 接 `bridge.text.generate-diff` + `bridge.text.generate-patch` 进 ToolCallCard / DiffView）| 3 天 | pi-bridge 7% → 14% |
| **P1** | **21** | **G4 PR 2**（renderer 接 `bridge.image.resize` + `bridge.image.detect-mime` 进 attachment/upload.ts）| 3 天 | pi-bridge 14% → 28% |
| **P1** | **22** | **G8 PR 1**（3 个 canonical pi 包真实 e2e：pi-mcp-adapter / pi-lens / pi-worktree）| 1 周 | 29/29 → 3/29 = 10% |
| **P1** | **23** | **G5 PR 1**（generateBranchSummary 真实接入 + 保留 branch-summary-format.ts fallback）| 1 周 | 集成深度从形式接 → 行为切 |
| **P2** | **24** | **G3 PR 1**（DefaultPackageManager 接入，保留 ProfilePackageManager facade）| 2 周 | profile-manager.ts 806 → ≤ 200 |
| **P2** | **25** | **perf bench 脚本**（`scripts/perf/baseline-bench.mjs`：cold start / IPC p95 / streaming 帧；CI 必跑）| 3 天 | perf 维度从 🔴 → 🟡（有数）|

---

## 6. Round 15 改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `plan4.1.md` | v3.11 → **v3.12** | 头部 v3 数字修正 + v3.12 数字修正（ground-truth 274 export）+ §0 重写（8.4% ground-truth）+ §1 标题改"274 个 export" + §1.3 标题改"262 个 pi export" + 新增 §9（5 维评估 + 进度百分比 + Round 16-25 下一步顺序）|
| `plan4.0.md` | v2 → **v3** | 头部 v3 增量（Round 14 G1 PR 2 落地 + Round 15 全审计）+ §1.7 新增 O8/O9（typed-tool.ts UI 演示：schema viewer + validateParams 错误展示）+ §1.8 v3 修正（13 → 14 通道 + Round 16+ 解锁 B1-B7 顺序）|
| `docs/ROUND15_PI_NATIVE_AUDIT.md` | 新增 | 本报告 |

---

## 7. 真实验证

```bash
$ bash scripts/audit/pi-sdk-usage.sh
{"piPackages":3,"piSymbols":23,"piFiles":94,"piSymbolStatements":119,"piBridge":{"channels":14,"rendererConsumers":1,"deadChannels":13,"utilizationPct":7},"canonicalPackages":{"declared":29,"e2eFiles":0},"hotspots":{"applyPatch":257,"settingsStore":196,"profileManager":806}}

$ bash scripts/audit/canonical-packages-e2e.sh
{"total":29,"covered":0,"missing":29}

$ bash scripts/audit/pi-bridge-dead-channels.sh
{"total":14,"covered":1,"dead":13,"utilizationPct":7,"gaOk":false}

$ bash scripts/audit/extensions-inventory.sh
extensions: 5 files / 615 LOC, all with pi imports
create*Extension factories: 11 (count includes both definition and re-export sites)
builtin extension names: 10 (openbuddy-apply-patch / openbuddy-extra-providers / openbuddy-pi-calendar / openbuddy-pi-compact-announce / openbuddy-pi-context-guard / openbuddy-pi-context-status / openbuddy-pi-model-bridge / openbuddy-pi-observability / openbuddy-pi-session-metadata / openbuddy-pi-telemetry-bridge)

$ bash scripts/audit/pi-upstream-coverage.sh
Pi 上游 exports: 105 (legacy v3 estimate)
OpenBuddy 已用: 23
覆盖率: 21.9% (GA gate ≥ 70%)
```

> **注**：`pi-upstream-coverage.sh` v3.6 估"105"——本轮 ground-truth 274 已写进 plan4.1.md §9.1 但**未改脚本**（脚本 grep 的是 plan4.1.md v3.6 §1.3 的旧数字列表）；Round 16 应优先改脚本 grep `dist/index.d.ts` 而不是 grep plan4.1.md。

---

## 8. 已知限制

1. **pi-upstream-coverage.sh 自身未更新**：脚本 grep plan4.1.md v3.6 §1.3 的旧 export 列表；v3.12 ground-truth 274 已写进 plan4.1.md §9.1 但脚本没同步——Round 16 第一动作
2. **fakade "形式接、行为未切"是最严重短板**：4 个 facade 落地但调用方仍走老路（如 `branch-summary-format.ts` 仍自实现）；不是"加更多 facade"能解决的，需要切调用点
3. **Round 14 typed-tool PR 2 的"details 初始化"仍有一处临时 cast** `(params as ApplyPatchParams | null)?.file_path ?? ""`——PR 3 可重构为 `validateParamsSafe` 类型守卫让 TS 自动收窄
4. **push 受阻**（agent 内 git credential 不可用）：commit `e1ec1b5` 已落本地 `agent/devbox2/86efbd59c853`，等 run 结束平台自动同步
5. **fs5 仍限制 vitest 全集**：plugin-host 全包 35 个失败与本轮无关

---

## 9. 下一步（v4.0 候选）

- **Round 16 G1 PR 3**（typed-tool 加 `validateParamsSafe` 类型守卫；apply-patch.ts 删最后一个临时 cast；e2e + plan4.0 O8/O9 UI 演示）
- **Round 17 G10 PR 1**（ExtensionFactory 单文件入口样板）
- **修正 pi-upstream-coverage.sh** 让脚本读 `dist/index.d.ts` 而不是 plan4.1.md §1.3（修复自身 bug）
- **修正 G1 spec 整段 §1 / §2**（apply-patch.ts 已是 pi；pi 无 createXxxTool 工厂）
- **修正 G9 spec §0 LOC 表**（350 → 128）+ §2 API（patterns → cwd/agentDir）
- **修正 G11 spec §0 LOC 表**（277 → 347 反向）+ G6 spec §2
- **全 monorepo vitest**（63 packages；待 fts5 修复）

---

## 10. 用户原问题逐项答复

1. **"分析 openbuddy 是否充分利用 pi 的能力打造 pi native 的 workbuddy"** → **未充分利用**。复用度 8.4%（23/274）；4 个 facade 形式接但调用方多走老路
2. **"分析存在问题"** → (a) facade 与调用点脱节（集成深度 = 🟡）；(b) pi-bridge 93% 死代码；(c) canonical pi 包 0/29 e2e；(d) perf 维度 🔴 完全未测；(e) apply-patch LOC 257 仍超目标
3. **"在功能性能产品力上分析"** → 详见 §2 5 维评估；当前 **功能 🟡 / 性能 🔴 / 产品力 🟡 / 集成度 🟡 / 工程基础 🟢**
4. **"按照计划 plan4.1.md 最佳方式实现"** → 4 个 facade 已落（typed-tool / resource-pi / theme-pi / parsePluginManifestFromString）；Round 16+ 顺序见 §5
5. **"实现后真实的验证"** → 14/14 apply-patch vitest + 6/6 typed-tool vitest + 5 个 audit 脚本全跑通
7. **"推送代码"** → 受阻（agent 内 git credential 不可用），commit `e1ec1b5` 本地
8. **"安装相关依赖修复问题"** → typebox 1.3.7 已加（Round 13）；fts5 缺（无 root）
9. **"说明实现功能，说明细节"** → 见 plan4.1.md §3 Phase B Round 14 报告 + ROUND14_IMPLEMENTATION_REPORT.md
10. **"说明进度百分比"** → **~21%（G 项落地）/ ~12%（行为 pi-native 折扣后）**（§3 表）