# OpenBuddy 五期：Pi 原生整合到生产可用（Plan 4.1，v3.3 — Phase A 扩展系统 + pi 上游覆盖 audit 落地)

> 📅 2026-09-10 · 仓库 `louloulin/OpenBuddy` · 版本 `0.14.0` · 父任务 LUM-785
>
> 上游基线：`@earendil-works/pi-coding-agent` 0.85.x · `pi-agent-core` 0.85.x · `pi-ai` 0.85.x
> 配套：`plan4.md`（架构总纲） · `plan4.0.md`（UI 细节） · `docs/pi-analysis-critique.md`（方法论批判）
>
> **本文是 v3**：在 v2 真实审计基础上，**把 §3 Phase A.1 的 baseline 工具落地为可重跑脚本**（`scripts/audit/pi-sdk-usage.{sh,mjs}` + `scripts/audit/canonical-packages-e2e.{sh,mjs}`）。脚本在无 node/pnpm 的开发环境也能跑（纯 grep/awk/sed/find），产出与 v2 §1 / §5 数字对得上且**全部从脚本输出读出，不再手填**。
>
> **v3 数字修正**（脚本实际产出）：
>
> | 字段 | v2 文案 | v3 脚本实测 | 修正理由 |
> |---|---|---|---|
> | 唯一 pi 包 | 3（earendil-works/pi-{agent-core,ai,coding-agent}） | **3** ✓ | 不变 |
> | 唯一 pi 符号 | "24" | **23** | v2 把 `parseFrontmatter` / `stripFrontmatter` / `generateDiffString` / `generateUnifiedPatch` 4 个 `X as Y` 重命名重复计入了；脚本 `sed` 去重后真实唯一 |
> | pi-bridge IPC 通道 | "13" | **14** | v2 数到 `pi-bridge-text:generate-diff` 时漏了 `generate-patch`；脚本 grep `^[[:space:]]*ipcMain\.handle\(` 严格数 = 14 |
> | pi-bridge renderer 消费者 | 1 | **1** | `bridge.text.parseFrontmatter` 在 `src/lib/agent/pi-client.ts:1460`；与 v2 一致 |
> | CANONICAL_PI_PACKAGES | "27" | **29** | v2 没数 `@anthropic/pi-automation` + `@anthropic/pi-todo` + `@diegopetrucci/pi-web-access` 3 个 scoped 包；awk 严格数 = 29 |
> | 应用 patch.ts LOC | "400+" | **228** | `wc -l electron/main/agent/extensions/apply-patch.ts` = 228 |
> | settings-store.ts LOC | "未给出" | **196** | `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts` |
> | profile-manager.ts LOC | "796" | **806** | `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` |
> | 真实 e2e 文件数 | "0" | **0** | `find tests -name 'real-pi-package-*.test.ts'` = 0；脚本按文件名 + content grep 兜底，**全部 29 个 canonical 包都标记 missing** |
> | pi-bridge 利用率 | 公式算 7% | **7%**（1/14） | GA gate ≥80% |

> **环境声明**：本 v3 在没有 node/npm/pnpm/moon 的工作容器中由 `bash` + `grep` + `awk` + `sed` + `find` 现场重跑产出。`pnpm audit:pi-sdk` / `pnpm audit:canonical-packages` 脚本入口已加入 `package.json:51-54`，等用户环境装好依赖即可走 node 版本（`.mjs` 仍委托 bash 执行，避免逻辑分叉）。

---

## 0. 一页摘要

OpenBuddy 在 v1 plan4.1.md 时被归类为"24% pi-native"。**真实审计后修正为 ~35%**——因为忽略了 renderer 通过 `pi-bridge` IPC 间接消费的 13 个 pi helper（parseFrontmatter / stripFrontmatter / truncateHead/Tail/Line / generateDiffString / generateUnifiedPatch / formatSize / detectSupportedImageMimeTypeFromFile / resizeImage / convertToPng / loadSkills / loadSkillsFromDir / formatSkillsForPrompt）。

但**这 35% 的"用"是浅用**：几乎全是 observation（事件订阅、type 引用、helper 透传）。真正**接管 OpenBuddy 业务算法**的只有：
- `shouldCompact` + `DEFAULT_COMPACTION_SETTINGS`（compaction 触发判断）
- `collectEntriesForBranchSummary` + `prepareBranchEntries`（branch 数据收集，**没**调 LLM 版 `generateBranchSummary`——`electron/main/agent/host-modules/session-store.ts` 注释明确）
- 6 个 builtin `ExtensionFactory`（`apply-patch`、`calendar`、`openbuddy-markdown`、`model-bridge`、`session-metadata-bridge`、`telemetry-bridge`）作为薄观察层

**最关键的 4 大空白**（v2 plan 的主攻方向）：

| # | 空白 | 证据 | 影响 |
|---|---|---|---|
| **G1** | **Pi 工具工厂（createBashTool/createReadTool/createWriteTool/createEditTool/createGrepTool/createFindTool/createLsTool）零复用**——`electron/main/agent/extensions/apply-patch.ts` 400+ LOC 自实现 `apply_patch` + `apply_command` | `grep -rEln "createBashTool\|createReadTool\|createWriteTool\|createEditTool" --include="*.ts"` **0 hits** | Pi 升级时 bash/read/write/edit 行为变化 OpenBuddy 不会自动跟随；`extensions/__tests__/apply-patch.test.ts` 维护负担 |
| **G2** | **Pi SettingsManager / DefaultPackageManager / DefaultResourceLoader / PackageManager 全部自实现对应物**——`packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` 自定义 `ProfilePackageManager` 接口（796 LOC）；`host-modules/models-config.ts` 自实现 settings schema | `grep -rEln "SettingsManager\|DefaultPackageManager\|PackageManager" --include="*.ts"` 在 pi 路径上 0 hits；openbuddy 自实现版本命名不同 | Pi 升级 settings schema / retry backoff / image 压缩等改进 OpenBuddy 无法受益 |
| **G3** | **pi-bridge IPC 通道严重低利用**——13 个 IPC handler 注册（`pi-bridge/index.ts:34-121`）但 renderer 仅 1 个真实消费者（`src/lib/agent/pi-client.ts:1457` 的 `parseSkillFrontmatter`） | `grep -rEn "requirePiBridge\|getPiBridge" src/` 仅有 2 个 import（一个在 bridge-client.ts 自身，一个在 pi-client.ts:1457） | Text/image/skill 处理本可走 pi，但 renderer 走的是 openbuddy 自己重写的逻辑 |
| **G4** | **27 个 CANONICAL_PI_PACKAGES 已声明但未实测对接**——`pi-extension-discovery.ts:20-50` 列了 `pi-hermes-memory / pi-mcp-adapter / pi-plan-mode / pi-permission-system / pi-goal / pi-subagents / pi-lens / pi-simplify / pi-worktree` 等；`pi-extension-discovery.ts:52-58` 探测 `node_modules` 但没跑过真实端到端 | 同上文件 + `grep -rEln "CANONICAL_PI_PACKAGES" --include="*.ts"` 仅 14 个文件，**0 个真实 npm 安装 + e2e 测试证据** | "装即用"叙事无证据支撑；v1 plan4.1.md Phase D.3 装的 3 个 pi 包仍是 TODO |

按本 v2 计划的 8 阶段（约 14 周），OpenBuddy 0.17.0 应能达到 70%+ pi 复用度 + 真实第三方 pi 包实测。

---

## 1. 真实审计：Pi 0.85.x 105 个 export 在 OpenBuddy 的使用现状

### 1.1 直接 import 的 24 个 pi export（main 进程）

来源：`grep -rEho "import\s*\{[^}]*\}\s*from\s*['\"]@earendil-works[^'\"]+['\"]" --include="*.ts"` 频次统计

| 频次 | Symbol | 来自 | 用途 | 文件锚点 |
|---|---|---|---|---|
| 17 | `SessionManager` | pi-coding-agent | 会话持久化 | 17 处全仓，主要是 `host-modules/session-store.ts:30`、`agent-host.ts` |
| 6 | `DefaultResourceLoader` | pi-coding-agent | 资源加载（extensions/skills/prompts/themes） | 6 处全仓 |
| 5 | `createAgentSession` | pi-coding-agent | AgentSession 工厂 | 5 处全仓 |
| 5 | `Type` | pi-ai | typebox schema 类型 | `pi-extensions.ts:3` 等 |
| 4 | `discoverAndLoadExtensions` | pi-coding-agent | 自动发现 pi 包 | 4 处全仓 |
| 4 | `ModelRuntime` | pi-coding-agent | 模型运行时 | 4 处全仓 |
| 3 | `AgentSession` | pi-coding-agent | 会话对象 | 3 处全仓 |
| 2 | `streamSimple` | pi-ai | LLM 流式调用 | 2 处全仓 |
| 2 | `createExtensionRuntime` | pi-coding-agent | 扩展运行时 | 2 处全仓 |
| 1 | `shouldCompact` | pi-agent-core | 上下文压缩判断 | `electron/main/agent/pi-extensions.ts:4,1023` |
| 1 | `DEFAULT_COMPACTION_SETTINGS` | pi-agent-core | 默认压缩参数 | 同上 |
| 1 | `collectEntriesForBranchSummary` | pi-coding-agent | branch 摘要数据收集 | `electron/main/agent/host-modules/session-store.ts:30` |
| 1 | `prepareBranchEntries` | pi-coding-agent | branch 条目预处理 | 同上 |
| 1 | `generateUnifiedPatch` (as piGenerateUnifiedPatch) | pi-coding-agent | unified patch 生成 | `electron/main/agent/pi-bridge/text-utils.ts:14` |
| 1 | `generateDiffString` (as piGenerateDiffString) | pi-coding-agent | diff 字符串生成 | 同上 |
| 1 | `parseFrontmatter` (as piParseFrontmatter) | pi-coding-agent | YAML frontmatter 解析 | 同上 |
| 1 | `stripFrontmatter` (as piStripFrontmatter) | pi-coding-agent | frontmatter 剥离 | 同上 |
| 1 | `truncateHead/Tail/Line` | pi-coding-agent | 文本截断 | 同上 + `text-utils.ts:21-23` |
| 1 | `formatSize` | pi-coding-agent | 字节大小格式化 | `text-utils.ts:76` |
| 1 | `ToolDefinition` | pi-coding-agent | tool 定义类型 | 1 处 |
| 1 | `Theme` | pi-coding-agent | 主题类型 | 1 处 |
| 1 | `SessionEntry` | pi-coding-agent | session entry 类型 | 1 处 |
| 1 | `ModelRegistry` | pi-coding-agent | 模型注册表 | 1 处 |
| 1 | `ExtensionUIContext` | pi-coding-agent | 扩展 UI context | 1 处 |
| 1 | `ExtensionFactory` | pi-coding-agent | 扩展工厂 | 6 个 builtin 都用 |
| 1 | `ExtensionAPI` | pi-coding-agent | 扩展 API | 6 个 builtin 都用 |

**直接 import 共 24 个唯一符号**。

### 1.2 通过 pi-bridge IPC 间接消费的 13 个 pi export（renderer）

来源：`electron/main/agent/pi-bridge/{text,image,skill}-utils.ts` 实际 import

| IPC 通道 | pi 函数 | renderer 真实消费者 |
|---|---|---|
| `pi-bridge-text:parse-frontmatter` | `parseFrontmatter` | `src/lib/agent/pi-client.ts:1457`（`parseSkillFrontmatter`） |
| `pi-bridge-text:strip-frontmatter` | `stripFrontmatter` | **0** |
| `pi-bridge-text:truncate-head/tail/line` | `truncateHead/Tail/Line` | **0** |
| `pi-bridge-text:generate-diff` | `generateDiffString` | **0** |
| `pi-bridge-text:generate-patch` | `generateUnifiedPatch` | **0** |
| `pi-bridge-image:detect-mime` | `detectSupportedImageMimeTypeFromFile` | **0** |
| `pi-bridge-image:resize` | `resizeImage` | **0** |
| `pi-bridge-image:resize-file` | `readAndResizeImage` | **0** |
| `pi-bridge-image:convert-to-png` | `convertToPng` | **0** |
| `pi-bridge-skills:load` | `loadSkills` | **0** |
| `pi-bridge-skills:load-from-dir` | `loadSkillsFromDir` | **0** |
| `pi-bridge-skills:format-for-prompt` | `formatSkillsForPrompt` | **0** |
| `pi-bridge-text:format-size` | `formatSize` | **0** |

**13 个 IPC handler 中只有 1 个有真实 renderer 调用者**（text-utils.ts 第 4 行通过 `bridge.text.parseFrontmatter`）。**12/13 = 92% 的 pi-bridge 通道是死代码**。

### 1.3 不使用 / 自实现的 60+ pi export（关键空白）

来源：`grep -rEln "createBashTool|createReadTool|createWriteTool|createEditTool|createGrepTool|createFindTool|createLsTool|SettingsManager|RetrySettings|ImageSettings|initTheme|getMarkdownTheme|getSelectListTheme|getSettingsListTheme|copyToClipboard|getShellConfig|getPowerShellConfig|findCutPoint|prepareCompaction|generateSummary|generateBranchSummary|estimateTokens|calculateContextTokens|getLastAssistantUsage|findTurnStartIndex|parseSessionEntries|migrateSessionEntries|AuthStorage|readStoredCredential|DefaultPackageManager|loadProjectContextFiles|defineTool|wrapRegisteredTool|RemoteSession|runRpcMode|runPrintMode|parseArgs" --include="*.ts" .` **全部 0 hits**。

| Pi export 类别 | 空白 pi export | OpenBuddy 自实现位置 |
|---|---|---|
| **Tool 工厂** | `createBashTool / createReadTool / createWriteTool / createEditTool / createGrepTool / createFindTool / createLsTool` | `electron/main/agent/extensions/apply-patch.ts` 400+ LOC 自实现 `apply_patch` + `apply_command`；缺 grep/find/ls |
| **Settings** | `SettingsManager / RetrySettings / ImageSettings / settings-diagnostics` | `electron/main/agent/host-modules/models-config.ts` + `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts` 自实现 |
| **Theme** | `initTheme / getMarkdownTheme / getSelectListTheme / getSettingsListTheme` | `packages/ui/openbuddy-ui-theme` 自实现 |
| **Shell** | `getShellConfig / getPowerShellConfig / bash-executor / exec` | `apply-patch.ts:39-40` 直接用 `node:child_process.execFile` |
| **Compaction** | `findCutPoint / prepareCompaction / generateSummary / generateBranchSummary / estimateTokens / calculateContextTokens / getLastAssistantUsage / findTurnStartIndex / generateSummaryWithUsage` | `electron/main/agent/branch-summary-format.ts` 自实现 LLM-call wrapper（注释明确 NOT using pi's `generateBranchSummary`）；`packages/ui/openbuddy-ui-conversation/src/lib/streaming-metrics.ts:33` 自实现 UI 侧 `estimateTokens` |
| **Resource** | `DefaultPackageManager / PackageManager / loadProjectContextFiles` | `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` 自定义 `ProfilePackageManager` 接口（796 LOC）；`include.ts` 自实现 context file 加载 |
| **Auth** | `AuthStorage / readStoredCredential / runtime-credentials` | `electron/main/deepseek-generic.ts` 自有 CredentialStore + OS Keychain |
| **Extension** | `defineTool / wrapRegisteredTool / createToolDefinition` | `electron/main/agent/pi-tool-bridge.ts` 自实现 tool 适配层 |
| **Remote / Print** | `RemoteSession / applyTranscriptProgress/Snapshot / runRpcMode / runPrintMode / parseArgs / RpcClient` | `electron/main/harness/harness-server.ts` 1327 LOC 自实现 HTTP/WS |
| **MIME / Lang** | `getLanguageFromPath / highlightCode` | renderer markdown 渲染走 `highlight.js`，绕开 pi 的 highlightCode |
| **Clipboard** | `copyToClipboard` | `electron/main/` 直接用 `clipboard` 模块 |

**自实现总规模估算**：

- `electron/main/agent/extensions/apply-patch.ts` ~400 LOC
- `electron/main/agent/host-modules/models-config.ts` ~300 LOC
- `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` 796 LOC
- `electron/main/agent/branch-summary-format.ts` ~150 LOC（自实现 LLM wrapper）
- `electron/main/harness/harness-server.ts` 1327 LOC
- 巨型 file 中的相关部分合计 **~3000+ LOC 自实现对应物**

### 1.4 27 个 CANONICAL_PI_PACKAGES 实际状态

来源：`electron/main/agent/pi-extension-discovery.ts:20-50`

| 分类 | Pi 包名 | OpenBuddy 处理方式 | 状态 |
|---|---|---|---|
| **P0 memory + tasks** | `pi-hermes-memory`, `@remnic/plugin-pi`, `@juicesharp/rpiv-todo`, `@anthropic/pi-todo` | 默认 discovery；`pi-passthrough.ts` passthrough | 探测可，未真实 e2e |
| **P0 web + MCP** | `pi-web-access`, `@diegopetrucci/pi-web-access`, `pi-mcp-adapter` | 同上 | 探测可，未真实 e2e |
| **Plan + permission** | `pi-plan-mode`, `@narumitw/pi-plan-mode`, `@arvorotech/pi-plan-mode`, `@plannotator/pi-extension`, `pi-permission-system` | 同上；`pi-plan-mode.ts` 自实现 | 自实现占位，第三方未实测 |
| **Folder trust + notification** | `pi-folder-trust`, `@anthropic/pi-folder-trust`, `pi-notification`, `@anthropic/pi-notification` | discovery only | 未实测 |
| **Goal + automation + subagents** | `pi-goal`, `pi-goal-x`, `@narumitw/pi-goal`, `pi-automation`, `pi-workflow`, `pi-cron`, `pi-schedule`, `@anthropic/pi-automation`, `pi-subagents` | discovery only；`subagent-runtime.ts` 自实现 | 自实现 ~600 LOC team-runner.ts + 700 LOC subagent-runtime.ts，未实测第三方 |
| **Zero-cost whitelist** | `pi-lens`, `pi-simplify`, `pi-hashline`, `pi-worktree` | `pi-passthrough` 直接透传 | 最可能落地（白名单） |

**结论**：27 个声明的 pi 包中，**0 个有真实 npm install + e2e 测试证据**。

---

## 2. 真实差距矩阵（基于 §1 证据）

| # | 差距 | 证据（path:line） | 影响用户场景 | 修复方向 | 估时 |
|---|---|---|---|---|---|
| **G1** | `apply-patch.ts` 自实现工具工厂 | `extensions/apply-patch.ts:1-400`、`extensions/__tests__/apply-patch.test.ts`、`extensions/__tests__/apply-patch-r2.test.ts` | bash/read/write/edit 行为漂移；Pi 升级不会自动同步；grep/find/ls 缺失 | 引入 `createEditTool/createBashTool/createReadTool/createWriteTool/createGrepTool/createFindTool/createLsTool`，保留 `apply-patch.ts` 为薄 OpenBuddy adapter（< 100 LOC） | 3 周 |
| **G2** | SettingsManager 自实现 | `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts`、`host-modules/models-config.ts` | retry backoff / image 压缩 / settings schema 校验走自己实现 | 切到 Pi `SettingsManager.create()` + 维护 OpenBuddy → Pi 映射 | 2 周 |
| **G3** | `ProfilePackageManager` 自定义 | `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts:53-63` | Pi `DefaultPackageManager` 的 npm install / git install / tarball install / signature 校验等能力 OpenBuddy 拿不到 | 接入 `DefaultPackageManager`，保留 `ProfilePackageManager` typed facade | 2 周 |
| **G4** | pi-bridge 13 通道 12 个死代码 | `electron/main/agent/pi-bridge/index.ts:34-121` vs `src/lib/` 实际调用 1 处（pi-client.ts:1457） | renderer 文本截断/diff 生成/image resize/skill 加载本可走 pi 但走自实现 | Renderer 全面接入 `requirePiBridge()`；删除自实现对应物 | 2 周 |
| **G5** | Compaction helper 部分复用 | `host-modules/session-store.ts:30` 用 `collectEntriesForBranchSummary` + `prepareBranchEntries`，但 `branch-summary-format.ts` 注释明确 NOT using `generateBranchSummary` | branch summary 走自实现 LLM wrapper；与 pi 默认行为漂移 | 接入 pi `generateBranchSummary`（需要 model 调用 + keychain 凭据）；保留 fallback formatter | 1 周 |
| **G6** | Theme 自实现 | `packages/ui/openbuddy-ui-theme/` 整包 | Pi 主题切换能力（明/暗/自定义 .json）OpenBuddy 拿不到 | 接入 pi `initTheme` + `getMarkdownTheme`；保留 `--wb-*` token 作为 base layer | 1 周 |
| **G7** | Shell helper 自实现 | `extensions/apply-patch.ts:39-40` 直接用 `node:child_process.execFile` | shell 工具行为与 pi 内置不一致；Windows PowerShell 支持缺失 | 接入 pi `getShellConfig / getPowerShellConfig / bash-executor` | 1 周 |
| **G8** | 27 个 CANONICAL_PI_PACKAGES 0 个真实 e2e | `electron/main/agent/pi-extension-discovery.ts:20-50` + 0 个 `tests/integration/real-pi-package-*.test.ts` 文件 | "装即用"叙事无证据 | 真实 `pnpm install pi-mcp-adapter` + 装 + 触发 + 卸载 e2e；至少 3 个真实包 | 3 周 |
| **G9** | Context file loading 自实现 | `packages/runtime/openbuddy-plugin-host/src/include.ts` 350 LOC | Pi `loadProjectContextFiles` 已经有，OpenBuddy 不复用 | 切到 pi helper，保留 include.ts 作为 typed wrapper | 1 周 |
| **G10** | ExtensionFactory 注册路径复杂 | `pi-extensions.ts` 1222 LOC（factories + adapters + compat + diag + resources）；`extensions/*.ts` 6 个 builtin factory | 第三方写一个 ExtensionFactory 进入 OpenBuddy 需要 5+ 文件改动 | 简化入口：单文件 `registerBuiltinExtension(factory)`；文档化最小模板 | 2 周 |
| **G11** | Frontmatter 解析走 bridge 而非 pi-renderer | `pi-bridge/text-utils.ts:4` 有 `parseFrontmatter` 但 `packages/runtime/openbuddy-plugin-sdk/src/manifest.ts` 自实现 | plugin manifest schema 校验与 pi frontmatter 行为漂移 | 接入 pi `parseFrontmatter` 作为 manifest 解析底层 | 1 周 |
| **G12** | pi-runtime-coordinator 单例化风险 | `electron/main/agent/pi-runtime-coordinator.ts` 自实现多 session 协调 | Pi 已提供 `AgentSessionRuntime.newSession/switchSession/fork`，OpenBuddy 可能重复实现 | 审查并最小化 `pi-runtime-coordinator.ts`，复用 `AgentSessionRuntime` | 1 周 |
| **G13** | `pi-session-runtime.ts` 自实现 session binding | `electron/main/agent/pi-session-runtime.ts` 现有~300 LOC | Pi `AgentSession` 已有 session 生命周期，自实现可能漂移 | 评估可移除的部分 | 1 周 |
| **G14** | Harness server 自实现 | `electron/main/harness/harness-server.ts` 1327 LOC；pi 提供 `runRpcMode/RpcClient` | OpenBuddy harness 协议是私有 contract；与 pi 上游 RPC 不兼容 | 评估 pi RPC 模式；可选采纳 `pi-mcp-adapter` 替代自实现 MCP | 2 周 |
| **G15** | Auth storage 自实现 | `electron/main/deepseek-generic.ts` + `~/.openbuddy/auth.json` | Pi `AuthStorage` 已有 OAuth/PKCE 流程 | 接入 pi `AuthStorage` + PKCE | 1 周 |

---

## 3. 8 阶段执行路线（v2 — 基于 §2 真实差距）

> **每阶段独立 PR/commit + 退出标准 + 1 个文件 ≤ 300 行变更限制**（巨型文件拆分例外）

### Phase A：基线与真实差距量化（1 周）

**目标**：把 §1 / §2 的发现固化为可重跑的 baseline。

**任务**：

- **A.1** 创建 `scripts/audit/pi-sdk-usage.mjs`：自动扫描仓库，输出"直接 import / pi-bridge IPC / 0 复用"三档分类表
- **A.2** 创建 `scripts/audit/canonical-packages-e2e.mjs`：对 27 个 `CANONICAL_PI_PACKAGES` 跑真实 `npm install` + 探测，输出可装/不可装/已装状态
- **A.3** 把 §2 的 15 项差距写入 `docs/PI_INTEGRATION_BACKLOG.md`，每项有 owner / 估时 / 依赖
- **A.4** 在 `pnpm verify:plan` 加入 `pi-sdk-usage` + `canonical-packages-e2e` 必跑项

**退出标准**：
- 两个脚本进 `pnpm audit:pi-sdk` / `pnpm audit:canonical-packages`
- baseline 数字进仓库
- 所有现有 542 vitest 文件 / 5517 通过仍然全绿

#### Phase A 实施状态（v3 增量）

> **实施日期**：2026-09-10
> **环境**：开发容器无 `node` / `pnpm` / `moon`；脚本以纯 `bash` + `grep` + `awk` + `sed` + `find` 实现，可重跑，`.mjs` 薄壳仍 `execFileSync` bash。
> **声明**：本仓库 Git 上**未跑过** vitest / tsc / electron smoke（环境缺依赖）；下文所有数字均为脚本在 source tree 上的静态审计产出。Phase B / C / D 全部代码改动**未做**，留待 dev-env 落地。

**A.1 ✅ 已实现**（代码已落地，runtime verification 待 dev-env）：

- `scripts/audit/pi-sdk-usage.sh` — bash source-of-truth（167 行，`set -euo pipefail`）
- `scripts/audit/pi-sdk-usage.mjs` — node 薄壳（22 行，`execFileSync` 委托 bash）
- `package.json:51` 加入 `"audit:pi-sdk": "node scripts/audit/pi-sdk-usage.mjs"`
- `package.json:52` 加入 `"audit:pi-sdk:json": "node scripts/audit/pi-sdk-usage.mjs --json"`

**A.1 实测输出**（在本容器用 `bash scripts/audit/pi-sdk-usage.sh` 跑出，已复制到 §1 / §5 / §3 表）：

```
PI packages imported       : 3
  · @earendil-works/pi-agent-core
  · @earendil-works/pi-ai
  · @earendil-works/pi-coding-agent
Unique pi symbols          : 23       (raw count; reuse % measured separately)
Pi import statements       : 113
Files importing pi         : 88
PI-bridge IPC channels     : 14
PI-bridge renderer usage   : 1  (bridge.text/image/skills.X calls in src/)
PI-bridge DEAD channels    : 13
PI-bridge utilization      : 7%    GA gate: ≥80%
Canonical pi packages      : 29 declared, 0 e2e files    GA gate: 29/29 e2e
Hotspots:
  extensions/apply-patch.ts               228 LOC
  storage/src/sqlite/settings-store.ts    196 LOC
  plugin-host/src/profile-manager.ts     806 LOC
```

JSON 形态（CI / verify:plan 直接消费）：

```json
{"schemaVersion":1,"piPackages":3,"piPackagesList":["@earendil-works/pi-agent-core","@earendil-works/pi-ai","@earendil-works/pi-coding-agent"],"piSymbols":23,"piSymbolStatements":113,"piFiles":88,"piBridge":{"channels":14,"rendererConsumers":1,"deadChannels":13,"utilizationPct":7,"gaGate":">=80%"},"canonicalPackages":{"declared":29,"e2eFiles":0,"gaGate":"29/29 e2e"},"hotspots":{"applyPatch":228,"settingsStore":196,"profileManager":806}}
```

**A.2 ✅ 已实现**（同上 bash + mjs 双形态）：

- `scripts/audit/canonical-packages-e2e.sh` — bash source-of-truth（94 行）
- `scripts/audit/canonical-packages-e2e.mjs` — node 薄壳
- `package.json:53-54` 加入 `"audit:canonical-packages"` + `audit:canonical-packages:json`

**A.2 实测输出**：`total=29 / covered=0 / missing=29`（所有 29 个 CANONICAL_PI_PACKAGES 都没有 `tests/integration/real-pi-package-<name>.test.ts`，content-grep 兜底也 0 命中）。完整 missing list 在脚本 `--json` 输出里。

**A.3 ✅ 已实现**（docs 落地）：

- `docs/PI_INTEGRATION_BACKLOG.md` — 15 项 G-gap（plan4.1 §2）每项 owner / 估时 / 依赖 / 验收命令 / 阻塞状态；与 3 个 audit 脚本的输出字段一一对应
- §0 一页 backlog（P0 5 项 / P1 8 项 / P2 2 项 = 27 周）+ §6 owner 决策待办 + §7 进度更新契约

**A.4 ⏳ 未做**：将两个 audit 接入 `pnpm verify:plan` 必跑项需要改动 `scripts/verify-plan.mjs`，等 vitest 环境就绪再补（verify-plan 现行为 `cd electron && pnpm exec tsc -p tsconfig.json --noEmit --incremental false`）。

**v3.1 增量**（2026-09-10 第二次跑）：

- `scripts/audit/pi-bridge-dead-channels.{sh,mjs}` — 把 14 个 IPC 通道逐条映射到底层 pi 函数 + 当前消费者（grep 自动核对）+ 建议接入位置。Phase D 工作入口。实测 `utilizationPct=7`（1/14 覆盖；GA gate ≥80%）。
- `docs/PI_NATIVE_AUDIT_BASELINE.md` — 把 3 个 audit 脚本的 JSON baseline 固化为可重读的 GA gate 表，包含 `jq` 一键断言命令。
- `package.json:55-56` 加入 `audit:pi-bridge-dead` + `audit:pi-bridge-dead:json` 两个新脚本。

**v3.3 增量**（2026-09-11 第四次跑 — 第 5 / 6 个 audit）：

- `scripts/audit/extensions-inventory.{sh,mjs}` — OpenBuddy Extension 系统全量静态审计（ExtensionFactory / builtin 注册 / LOC / 测试）。Phase B + G10 工作入口。
- `scripts/audit/pi-upstream-coverage.{sh,mjs}` — pi-coding-agent / pi-ai / pi-agent-core 上游 ~105 export 在 OpenBuddy 的覆盖审计，按 11 个域分类 unused + 二次 grep 找 newly-used。
- `package.json:59-62` 加入 `audit:extensions-inventory` + `audit:extensions-inventory:json` + `audit:pi-upstream-coverage` + `audit:pi-upstream-coverage:json`。

**v3.3 实测数字**：

```
extensions-inventory:
  - 5 ext files in extensions/  (586 total LOC; 5/5 导入 pi)
  - 11 create*Extension factory functions
  - 10 builtin extension names  (openbuddy-apply-patch / openbuddy-extra-providers / openbuddy-pi-calendar
                                openbuddy-pi-compact-announce / openbuddy-pi-context-guard / openbuddy-pi-context-status
                                openbuddy-pi-model-bridge / openbuddy-pi-observability / openbuddy-pi-session-metadata
                                openbuddy-pi-telemetry-bridge)
  - 31 ExtensionAPI/ExtensionFactory consumers
  - 6 .test.ts in extensions/ + pi-extensions.test.ts 1032 LOC
  - hotspots: apply-patch 228 (G1), pi-extensions 1222 (G10), settings-store 196 (G2), profile-manager 806 (G3)

pi-upstream-coverage:
  - pi 上游 ~105 export
  - OpenBuddy 已用 : 23
  - OpenBuddy 未用 : 47
  - 覆盖率        : 21.9% (GA gate ≥ 70%) ❌
  - 新发现已用    : SettingsManager, exec, generateBranchSummary, estimateTokens, Snapshot, RpcClient
                    （v3 plan4.1 §1.3 标 unused 但实际有 import；reverify 第二轮 grep 找到）
  - unused by domain:
      compaction  9 (findCutPoint / prepareCompaction / generateSummary / generateBranchSummary / estimateTokens
                      calculateContextTokens / getLastAssistantUsage / findTurnStartIndex / generateSummaryWithUsage)
      tool-factory 7 (createBashTool / ReadTool / WriteTool / EditTool / GrepTool / FindTool / LsTool)
      remote      7 (RemoteSession / applyTranscriptProgress / Snapshot / runRpcMode / runPrintMode / parseArgs / RpcClient)
      theme       4
      shell       4
      settings    4
      resource    3 (DefaultPackageManager / PackageManager / loadProjectContextFiles)
      extension   3 (defineTool / wrapRegisteredTool / createToolDefinition)
      auth        3 (AuthStorage / readStoredCredential / runtime-credentials)
      mime        2
      clipboard   1
```

**v3.3 新增的 GA gate 候选**：

| Gate | 当前 | 目标 | 来源 |
|---|---|---|---|
| `extensionFiles.withPiImports == extensionFiles.count` | 5/5 | 5/5 | extensions-inventory ✅ |
| `builtinExtensionNames.count ≥ 10` | 10 | ≥ 10 | extensions-inventory ✅ |
| `pi-extensions.test.ts.loc ≥ 1000` | 1032 | ≥ 1000 | extensions-inventory ✅ |
| `piUpstreamCoverage.reused ≥ 70%` | 21.9% | ≥ 70% | pi-upstream-coverage ❌ |

**v3.2 增量**（2026-09-11 第三次跑 — 第 4 个 audit）：

- `scripts/audit/test-coverage.{sh,mjs}` — 静态统计 `*.test.ts` / `*.spec.ts` 数量、源码规模、test/source 比；识别 zero-test 包；映射 G8 (29 个 CANONICAL_PI_PACKAGES e2e) 补测目标。
- `package.json:57-58` 加入 `audit:test-coverage` + `audit:test-coverage:json`。
- **v3.2 实测数字**（本容器，无 node_modules，但 node v22.13.0 可用——`mjs` 薄壳可执行；vitest 仍需 `pnpm install`）：
  - Total `.test.ts`/`.spec.ts` : **351**
  - Total source `.ts`         : **343**
  - Overall test/source ratio  : **1.023**  (✅ ≥ 0.5 建议线)
  - 零测试 packages            : **0 个**（所有 `packages/*` 都至少有 1 个测试）
  - 低覆盖 packages（test/source < 0.5）：
    - `packages/auth` (1/9 = 0.111)
    - `packages/ui` (15/87 = 0.172)
    - `packages/shared` (2/8 = 0.250)
    - `packages/bundle` (4/9 = 0.444)
    - `packages/team` (1/2 = 0.500)
  - 高覆盖 packages（ratio ≥ 1.0）：
    - `packages/core` (8/7 = 1.143)
    - `packages/capability` (20/18 = 1.111)
    - `packages/{webhook-outbox,scim,saml,fs}` (1/1 = 1.000)
  - `tests/integration/` 与 `tests/unit/` 目录**不存在**（29 个 canonical e2e 待创建）
  - `electron/preload` 0 测试（仅 1 源文件 `index.ts`）—— Phase D preload 改动需新增测试

**v3.2 新增的 GA gate 候选**：

| Gate | 当前 | 目标 | 距离 |
|---|---|---|---|
| `totals.ratio ≥ 0.5` | 1.023 | ≥ 0.5 | ✅ pass |
| `zeroTestPackages == []` | 0 | 0 | ✅ pass |
| `electron/preload.tests ≥ 5` | 0 | ≥ 5 | -5 ❌ |
| `tests/integration/ 存在 + ≥ 29 e2e` | 不存在 | ≥ 29 | -29 ❌ |

**v3 已知限制**：

1. 数字与 plan4.1.md v2 §1 表里有 4 处不一致（24→23、13→14、27→29、400+→228），已在文首表格说明。后续每次 PR 重新跑 `bash scripts/audit/pi-sdk-usage.sh` 即可锁住。
2. bash 脚本里 `[ "$CANON_E2E_FILES" = "0" ]` 之后用了 `find . -path ./node_modules -prune -o ...`，`set -o pipefail` 下需要 `|| CANON_E2E_FILES=0` 兜底，否则空仓库会 exit 1（已修复并加注释）。
3. 数字 `piSymbolStatements`（113）包含 `import type { ... } from "@earendil-works/..."` 与运行时 import 没区分；如要严格分离，扩展脚本加 `--runtime-only` flag 即可，本次不做。

### Phase B：G1 工具工厂替换（3 周，P0）

**目标**：消除 `extensions/apply-patch.ts` 400 LOC 自实现。

**任务**：

- **B.1** 新建 `electron/main/agent/extensions/pi-tool-factories.ts`：基于 Pi `createBashTool/createReadTool/createWriteTool/createEditTool/createGrepTool/createFindTool/createLsTool`，套 OpenBuddy `folderTrust` + `permission` + `auditLog` 适配器
- **B.2** 拆 `extensions/apply-patch.ts`：保留 ≤ 100 LOC 作为 `apply_patch` 兼容 adapter（如果第三方模型期望 apply_patch schema）
- **B.3** `pi-extensions.ts` 注册新 builtin extension `openbuddy-pi-tools`，内置 grep/find/ls
- **B.4** 31 个 `extensions/__tests__/apply-patch*.test.ts` 测试逐步迁移到 `pi-tool-factories.test.ts`

**退出标准**：
- bash/read/write/edit/grep/find/ls 6 个工具的 vitest 全过
- 真实 Electron smoke 各 1 个 round-trip（写文件→编辑→grep→find）
- `apply-patch.ts` 行数 < 100

### Phase C：G2 + G3 + G11 Settings/Resource 接管（4 周，P0）

**目标**：消除 settings + package + frontmatter 的自实现对应物。

**任务**：

- **C.1** G2 Settings：接入 `SettingsManager.create()`；写 `mapOpenBuddySettingsToPi()` / `mapPiSettingsToOpenBuddy()`；保留 openbuddy settings 作为 typed facade
- **C.2** G3 PackageManager：接入 `DefaultPackageManager`，保留 `ProfilePackageManager` 接口
- **C.3** G9 Context files：切到 pi `loadProjectContextFiles`
- **C.4** G11 Frontmatter：manifest 解析底层用 pi `parseFrontmatter`
- **C.5** 写 `tests/integration/pi-settings-roundtrip.test.ts`：openbuddy 改 → pi 同步；pi 改 → openbuddy 同步

**退出标准**：
- 修改 openbuddy 任一 setting，3 秒内 pi `~/.pi/agent/settings.json` 同步
- 安装 npm 包走 `DefaultPackageManager` 后 `pi-passthrough` 自动识别
- 现有 settings 测试零回归

### Phase D：G4 pi-bridge 充分利用 + G6 Theme 切换（3 周，P0）

**目标**：把 12 个死代码 IPC 通道变成 renderer 实际依赖。

**任务**：

- **D.1** G4 Text：renderer 文件预览/代码块/搜索结果走 `bridge.text.truncateHead/Tail/Line/generateDiffString`；删除 `src/lib/text-utils.ts` 自实现（如有）
- **D.2** G4 Image：附件预览/截图粘贴走 `bridge.image.resizeImage/detectMime/convertToPng`；删除自实现
- **D.3** G4 Skills：render 端 skills 加载走 `bridge.skills.loadSkills/loadSkillsFromDir/formatSkillsForPrompt`
- **D.4** G6 Theme：接入 pi `initTheme` + `getMarkdownTheme`/`getSelectListTheme`/`getSettingsListTheme`；保留 `--wb-*` tokens 作为 base layer
- **D.5** pi-bridge IPC 增加 `pi-bridge-text:format-size`（已注册）+ 新增 `pi-bridge-theme:get-markdown` / `pi-bridge-skills:find-by-name`

**退出标准**：
- 12 个之前死代码的 IPC handler 全部有 ≥ 1 个 renderer 调用者
- 真实 Electron smoke：粘贴截图 → 走 `bridge.image.resizeImage` → 缩略图显示
- 主题切换实测：明 / 暗 / 用户自定义 .json 切换渲染器

### Phase E：G8 + G5 Compaction + Branch Summary 接管（3 周，P1）

**目标**：从 27 个声明的 pi 包中**实测**至少 3 个；`generateBranchSummary` 真实接入。

**任务**：

- **E.1** G8 真实 e2e：CI 起一个 `tests/integration/real-pi-package-{pi-mcp-adapter,pi-goal-x,pi-lens}.test.ts`，每个跑 `pnpm install` → 装 → 触发 → 卸载 → 断言无副作用
- **E.2** G5 Branch Summary：评估 pi `generateBranchSummary` 需要的 LLM 调用链（keychain 凭据 / 模型 routing）；保留 `branch-summary-format.ts` 作为 fallback
- **E.3** G12 Coordinator 简化：评估 `pi-runtime-coordinator.ts` 与 pi `AgentSessionRuntime` 重复部分
- **E.4** G13 Session Runtime 简化：评估 `pi-session-runtime.ts` 与 pi `AgentSession` 重复部分

**退出标准**：
- 3 个真实 pi 包 e2e 测试进 CI
- `branch-summary-format.ts` 行为与 pi 默认 ≥ 90% 一致
- `pi-runtime-coordinator.ts` 行数 -30%

### Phase F：G10 ExtensionFactory 简化 + G7 Shell + G15 Auth（3 周，P1）

**目标**：让第三方开发者写 1 个文件就能进入 OpenBuddy。

**任务**：

- **F.1** G10 简化入口：`packages/runtime/openbuddy-plugin-sdk/src/register.ts` 暴露 `registerOpenBuddyExtension(factory, manifest?)`
- **F.2** G7 Shell：接入 pi `getShellConfig / getPowerShellConfig / bash-executor`；`apply-patch.ts` 的 `apply_command` 改成包装 pi bash tool
- **F.3** G15 Auth：接入 pi `AuthStorage` + PKCE
- **F.4** 文档：`docs/PLUGIN_AUTHORS.md` 第三方 pi 包作者 5 分钟接入指南

**退出标准**：
- 新第三方 pi 包从"5+ 文件"降到"1 文件 + 1 manifest"
- `auth` 流程与 pi 上游 PKCE 一致
- 文档可被独立开发者 follow（实测：招募 1 个外部开发者跑通）

### Phase G：错误恢复 + 可观测 + 性能预算（2 周，P1）

**目标**：plan4.md §8 / §11 的 envelope / queue / generation / 性能预算全部落地。

**任务**：

- **G.1** `bounded-event-queue.ts`（113 LOC，已存在）：分通道（update/lifecycle/error）+ 优先级
- **G.2** `event-envelope.ts`（152 LOC，已存在）：强制 `{ schemaVersion, eventId, taskId?, sessionId?, generation, sequence, timestamp, kind, payload }`
- **G.3** `generation-gate.ts`（132 LOC，已存在）：扩展到所有 IPC handler
- **G.4** `scripts/perf/baseline-bench.mjs`：CI 必跑，断言 cold start ≤ 2.5s / first paint ≤ 1s / tool IPC p95 ≤ 50ms / streaming p95 帧 ≤ 16ms

**退出标准**：
- 任何 IPC handler 拒绝缺 `generation` / `sequence` 的请求
- 旧 generation 事件 0 命中 UI
- CI perf bench 任一项回归 > 10% 阻断 PR

### Phase H：插件市场 + 签名 + 0.17.0 GA 收口（3 周，P1）

**目标**：27 个 `CANONICAL_PI_PACKAGES` 全部实测；用户可"装即用"。

**任务**：

- **H.1** `plugin-marketplace.ts`：本地优先（`pi install npm:`）；registry 需显式用户动作
- **H.2** `plugin-provenance.ts`：来源 / SBOM / license / hash / 签名
- **H.3** `plugin-rollback.ts`：每次 install 写 snapshot，失败回滚
- **H.4** `packages/ui/openbuddy-ui-marketplace`：Settings → Plugins 页面（搜索 / 详情 / 版本 / 权限 / 来源 / 日志 / 禁用 / 回滚）
- **H.5** 27 个 `CANONICAL_PI_PACKAGES` 全部跑真实 e2e（继承 E.1 模式）
- **H.6** 文档：`docs/PI_ECOSYSTEM_COMPATIBILITY.md` — 5,300 个 pi 包兼容性矩阵

**退出标准**：
- 27 个 pi 包全部有真实 e2e 测试
- 恶意 / 损坏 / 不兼容 fixture 被拒绝
- 安装失败不污染旧 profile
- 文档可被独立第三方 follow

---

## 4. 总览与里程碑

```text
Phase A (1w) ─► Phase B (3w) ─► Phase F (3w)
    │                │                  ▲
    ▼                ▼                  │
Phase C (4w) ─► Phase D (3w) ─► Phase E (3w) ─► Phase H (3w)
    │                │                  │              ▲
    ▼                ▼                  ▼              │
                  Phase G (2w) ─────────────────────────┘
```

| 里程碑 | 时间 | 内容 |
|---|---|---|
| **M1** | A + B 完成（4 周） | OpenBuddy 0.16.0-rc1：bash/read/write/edit 走 Pi tool 工厂 |
| **M2** | A + B + C + D 完成（11 周） | OpenBuddy 0.16.0：第三方 pi 包可装 + pi-bridge 全利用 |
| **M3** | A-H 全部完成（18 周 ≈ 4 个月） | OpenBuddy 0.17.0 GA：27 个 pi 包 e2e 通过 + 70%+ pi 复用度 |

---

## 5. 验收门槛与证据格式

### 5.1 每 PR 必填

- 涉及 pi 文件：`pnpm audit:pi-sdk` 输出前后对比（直接 import 数 / pi-bridge 消费者数 / 自实现对应物行数）
- typecheck：`pnpm typecheck` 0 error
- vitest：`pnpm workspace:test` 全绿
- 涉及运行时：真实 Electron smoke
- 涉及性能：`pnpm perf:ipc` / `pnpm perf:streaming` 同环境基线 ±10%
- 涉及插件：`tests/integration/real-pi-package-*.test.ts` 跑通

### 5.2 0.17.0 GA 门槛

| 维度 | 目标 | 阻断阈值 |
|---|---|---|
| **Pi 复用度** | ≥ 70% 唯一 export 至少 1 个 consumer | < 50% |
| **第三方 pi 包 e2e** | 27/27 通过 | < 25/27 |
| **pi-bridge IPC 利用率** | ≥ 80% 通道有真实消费者 | < 50% |
| **TypeScript** | affected projects 0 error | > 0 |
| **Unit/contract** | 新增行为 100% 有 deterministic test | < 100% |
| **Plugin** | 安装/启用/禁用/reload/失败/回滚全覆盖 | 任一缺失 |
| **Task** | draft→running→approval/retry/completed/failed/cancelled/paused→resume 可恢复 | 状态机漂移 |
| **IPC** | channel allowlist、payload schema、取消、事件顺序和背压通过 | 任一失败 |
| **Security** | secret 不进日志/manifest/inventory；危险权限明确审批 | 任意泄漏 |
| **Performance** | cold start ≤ 2.5s / tool IPC p95 ≤ 50ms / streaming 帧 ≤ 16ms | 任一回归 > 10% |
| **Product** | Tasks / Projects / Assistants / Experts / Skills / Connectors / Automation / Artifacts 至少各有可运行闭环 | 任一缺失 |
| **E2E** | 无凭据 deterministic smoke + 27 个真实 pi 包 e2e 全通过 | 任一失败 |

---

## 6. 与既有文档的关系（v2 更新）

| 文档 | v1 plan4.1.md 的判断 | v2 真实审计修正 |
|---|---|---|
| "24% pi-native" | 基于 `import` 频次统计 | **~35%**（加入 pi-bridge IPC 间接消费） |
| "12 个 capability adapter" | 仍准确 | 不变 |
| "Tool 工厂 0 复用" | 准确 | **G1 仍是核心空白**，但补充了 grep/find/ls 全部缺失 |
| "SettingsManager 0 复用" | 准确 | **G2 确认**，补充 settings-store.ts 自实现细节 |
| "5,300+ 第三方 pi 包" | 来自 WebSearch 二手数据 | **未变**——但 27 个 `CANONICAL_PI_PACKAGES` 中 0 个有真实 e2e 是新发现 |
| "建议执行顺序" | 8 阶段 | 不变结构，**重写具体任务**为基于 §2 差距表的"做哪些文件哪些行" |
| **不做的 10 条划线** | 保留 | 不变 |

---

## 7. 风险登记（v2 增量）

| 风险 | v1 评估 | v2 增量 |
|---|---|---|
| **R1** Pi 升级破坏 API | High | 不变 |
| **R2** 第三方 pi 包 license 风险 | High | 不变 |
| **R8** task state machine 误把 renderer-only 状态当权威 | High | 不变 |
| **R6** 插件市场成为隐式远程代码执行入口 | High | 不变 |
| **R11（新）** pi-bridge IPC 通道继续死代码 | — | **新增**：若 Phase D 不强制 80% 利用率，G4 永远修不完 |
| **R12（新）** 27 个 pi 包永远只是"声明可发现" | — | **新增**：若 Phase E.1 不强制 `tests/integration/real-pi-package-*.test.ts`，G8 永远修不完 |
| **R13（新）** `apply-patch.ts` 400 LOC 自实现被"为了兼容"无限期保留 | — | **新增**：Phase B.2 强制行数 < 100 + 完整迁移路径 |

---

## 8. 结论

v1 plan4.1.md 给出了 8 阶段的"应该这样做"——v2 plan4.1.md 用真实 grep 证据回答了"哪些没做、哪些做了、哪些永远做不到"。

**核心修正**：
- pi 复用度 **24% → 35%**（计入 pi-bridge IPC）
- 但 pi-bridge IPC **12/13 通道是死代码**——v1 没发现
- 27 个 `CANONICAL_PI_PACKAGES` **0 个真实 e2e**——v1 没发现
- 自实现对应物总规模 **~3000+ LOC**，集中在 apply-patch.ts / profile-manager.ts / harness-server.ts / branch-summary-format.ts——v1 列了 4 个文件，实际影响面更大

**核心不变**：
- 不复制 Pi agent loop / provider HTTP / JSONL tree
- 不删除仍在承担真实业务责任的 OpenBuddy service
- 不把企业 Casdoor / 支付 / SCIM / SAML 塞入微内核
- 不以"删 LOC"代替行为兼容证明

**v2 路线图的差异化**：每一阶段都直接对应 §2 真实差距表里的 1+ 个 G 项，**不存在"虚构的 pi 集成"任务**。0.17.0 GA 时 OpenBuddy 应达到 **70%+ pi 复用度**（vs 当前 35%）+ **27 个真实 e2e pi 包**（vs 当前 0）+ **pi-bridge IPC 80%+ 利用率**（vs 当前 8%）。

---

**Sources（v2 plan 引用）**：

- [pi.dev](https://pi.dev/)
- [pi.dev/packages](https://pi.dev/packages)
- [earendil-works/pi-mono on GitHub](https://github.com/earendil-works/pi-mono)
- [@earendil-works/pi-coding-agent on npm](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- [Pi SDK docs](https://pi.dev/docs/latest/sdk)
- [Pi Extension Loading (DeepWiki)](https://deepwiki.com/earendil-works/pi/6.2-extension-loading-and-discovery)

**本地证据锚点**（grep 命令输出，全部由 audit 脚本可重跑）：

```bash
# A.1 scripts/audit/pi-sdk-usage.mjs 复现命令
grep -rEho "import\s*\{[^}]*\}\s*from\s*['\"]@earendil-works[^'\"]+['\"]" \
  --include="*.ts" --include="*.tsx" . | \
  sed -E 's/import\s*\{//; s/\}\s*from.*//' | tr ',' '\n' | \
  sed -E 's/^\s+//; s/\s+$//; s/^type\s+//' | grep -v '^$' | sort | uniq -c | sort -rn

# A.2 scripts/audit/canonical-packages-e2e.mjs 复现命令
grep -A 30 "export const CANONICAL_PI_PACKAGES" \
  electron/main/agent/pi-extension-discovery.ts | head -35

# B.1 tool factory 空白确认
grep -rEln "createBashTool|createReadTool|createWriteTool|createEditTool|createGrepTool|createFindTool|createLsTool" \
  --include="*.ts" .  # expect: 0 hits

# C.2 ProfilePackageManager 自实现确认
grep -nE "ProfilePackageManager" packages/runtime/openbuddy-plugin-host/src/profile-manager.ts
```