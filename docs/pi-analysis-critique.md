# PI 分析方法论批判 —— OpenBuddy 产品 / 企业视角的盲点审计

> 比较基线：`docs/storage-architecture-audit.md`、`docs/distributed-buddy-network-architecture.md`、`docs/casdoor-enterprise-auth.md`、`docs/openbuddy-commercial-model.md`、`docs/workbuddy-parity-matrix.md`、`docs/workbuddy-points-system-comparison.md`、`docs/expert-team-design.md`、`README.md`（"Enterprise & Commercialization"）。
> 审计时间：2026-08-31。结论等级：可复核证据 → 推断 → 待验证。未发现的事实统一标注 `unknown / not-run`，绝不外推为已证实。
> 本审计为调查产出，不修改源文件；所有结论都标注绝对路径与行号。

---

## 1. 执行摘要

**结论 1：PI 分析是一份 "Pi 集成工程实施记录"，不是 "OpenBuddy 产品路线图"。** 这八份 PI 文档的总标题、章节顺序、结论段落均以 Pi 框架的契约、Pi 插件家族、Pi session tree、Pi model registry 为中心组织；它们几乎没有"OpenBuddy 用户为什么应该付费 / 续费 / 推荐"的章节。`pi-capability-gap-analysis.md:1-15` 的 goal 写明是"enumerate **every** Pi capability ... then map it against every OpenBuddy feature ... The migration's true cost lives in the 'gap' column"；`pi-sdk-implementation-plan.md:1-9` 写"embed `pi-coding-agent` via SDK ... full Pi-native migration"。两者的主语始终是 Pi 或迁移，不是用户。

**结论 2：方法论把 "Pi 能做什么" 等同于 "OpenBuddy 应该做什么"，导致产品视角被消除。** 关键证据是 `pi-core-capabilities.md` 中反复出现的"**What we get for free**"小节（line 162、261、297、457、530、612、683、806、832、861 等），把"Pi 提供的能力清单"直接转为 OpenBuddy 的能力资产，没有任何"对用户价值是什么"的二次评估。`pi-capability-gap-analysis.md:441` 的总结语 "The migration's true **novel code** is roughly ... That's the win." 把 LOC 净下降当作业务价值，未触及用户留存、转化率、商业 KPI。

**结论 3：验收体系过度集中在 IPC / 桥接 / Pi-原语 / MiniMax smoke 上，完全缺失 UX、商业、企业级、多租户、数据安全、跨平台、长演进的验收维度。** `brief.md:35-77` 的 15 个 acceptance examples（A1–A15）几乎全部是 "Electron 启动 + IPC allowlist + Pi event log + 真实 MiniMax 多轮对话"；`pi-openbuddy-completeness-audit.md:530-548` 的"已完成 / 当前剩余边界"也是技术边界，没有任何"用户首次开通 → 完成首次成功对话 → 第一次邀请同事 → 第一次续费 → SLA 报告"的旅程验收。

**结论 4：与现有 OpenBuddy 战略文档存在 6 类显式冲突**，其中最严重的是 (a) 数据权威性（PI 把 Pi JSONL 当 system of record，storage-audit 把 SQLite 当 system of record）；(b) 多租户治理（PI 完全无 Casdoor 章节，casdoor-enterprise-auth.md 是 12 个企业面板与 RBAC 的事实源）；(c) 商业计费（PI 完全无 points / wallet / SKU，commercial-model.md 是商业事实源）；(d) 分布式协作（PI 仅在 `pi-extension-architecture.md:7` 提及"openbuddy-collaboration 插件"，distributed-buddy-network-architecture.md 是 4 个 Phase 的事实源）；(e) WorkBuddy 私有能力（PI 假设可移植，workbuddy-parity-matrix.md 第 9 行明确不纳入私有云/商业账号）；(f) 专家/技能/连接器的缓存与路由语义（PI 假设扁平 `agents/*.md`，expert-team-design.md §1.5.4 描述 4 层缓存与路由）。

**结论 5：PI 分析至少存在 11 类夸大承诺或错误假设**，最严重的几条：(a) "Pi 集成完成 = OpenBuddy 可用"——`pi-openbuddy-completeness-audit.md:55-58` 用 published Harness artifact E2E 自评为 "real-external 的 published registry/network 证据" 但紧接一句 "不等同于完整 DeepSeek Harness parity"；同文档 `532-548` 列出 5 个剩余边界；(b) `pi-capability-gap-analysis.md:441` 声称 "Net TS LOC added: ~3,000. That's the win" 但实际 `pi-openbuddy-completeness-audit.md:732` 自承 production build 仍被 `EmailDraft | undefined` 类型错误阻塞；(c) `pi-core-capabilities.md:603` "All 19+ providers ship with Pi" 暗示 BYOK 等于无平台风险，但 `openbuddy-commercial-model.md:1-66` 与 `workbuddy-points-system-comparison.md:25-40` 都把 New API + Resource Gateway 当作商业事实源，BYOK 只是其中一个维度。

---

## 2. PI 分析的整体定位与视角偏差

### 2.1 文档主语反复以 "Pi / Pi extension / Pi session / Pi-native" 为中心

- `pi-core-capabilities.md:1-8` 的 opening 段写："This doc enumerates **what we get for free** when we embed Pi in-process. The goal: keep the migration surface narrow. Anything Pi already provides natively becomes an Electron-side thin host module ... Anything Pi **doesn't** provide becomes a Pi extension (≈50 LOC each)."——核心动词是 enumerate / embed / narrow / provide，主语是 Pi 而不是 OpenBuddy。
- `pi-capability-gap-analysis.md:1-15` 的 Goal 写："enumerate **every** Pi capability ... The migration's true cost lives in the 'gap' column."——把 "gap" 定义为"对 Pi 能力的 gap"，不是"对用户需求的 gap"。
- `pi-extension-architecture.md:3-7` 的 Decision 写："OpenBuddy embeds the Pi SDK in Electron main and keeps the WorkBuddy renderer as the UI. Pi extensions are therefore an agent-runtime extension seam, not a second application plugin system."——把 UI 看作 WorkBuddy "renderer" 而非产品体验，把 Pi extension 看作 "seam" 而非业务能力。
- `pi-runtime-next-roadmap.md:5-23` 的结论段画出的运行时边界图：`WorkBuddy Renderer → Electron Main → PiSessionRuntime → Pi AgentSession`——WorkBuddy Renderer 仅以"渲染层"身份出现，不存在 "产品层 / UX 层 / 商业层"。
- `pi-openbuddy-completeness-audit.md:575` 自承："**当前实现是 Pi-first 的 OpenBuddy 适配层，不宣称已替代 deepseek-harness 的全部生态包**"——直接说明本文档立场是"Pi 适配层"。

### 2.2 章节分布反映视角偏差

`pi-core-capabilities.md` 共 970 行、21 章，按 Pi 框架概念切分：Agent session lifecycle、Event types、Session storage、Providers、Built-in tools、Extensions API、MCP integration、Permissions、Skills、Slash commands、Subagents、Web search、Plan mode、Auth & account、ModelRegistry、Settings、ACP/RPC fallback、Community extensions、What's NOT in Pi → our 10 Pi extensions、Net result、References。**没有任何一章讨论 OpenBuddy 用户、商业模式、销售渠道、市场定位或客户支持。**

对比 `expert-team-design.md:1-460` 与 `workbuddy-points-system-comparison.md:1-150` 等产品文档，它们都至少有一章"WorkBuddy 业务组件映射"、"产品 UI 一致性"、"WorkBuddy 行为 → OpenBuddy 映射"、"刻意不同的地方"。PI 分析缺乏这种"以 WorkBuddy / 用户心智模型为外参照"的章节。

### 2.3 视角偏差的三个具体表现

#### 2.3.1 "What we get for free" 句式将上游能力等同于产品功能

- `pi-core-capabilities.md:162` "What we get for free (vs the current `sessions.rs` 686 lines)"
- `pi-core-capabilities.md:261` "What we get for free (vs `providers.rs` 1281 lines ...)"
- `pi-core-capabilities.md:297` "What we get for free"
- `pi-core-capabilities.md:457` "What we get for free"
- `pi-core-capabilities.md:530` "What we get for free"
- `pi-core-capabilities.md:612` "What we get for free"
- `pi-core-capabilities.md:683` "What we get for free"
- `pi-core-capabilities.md:806` "What we get for free"
- `pi-core-capabilities.md:832` "What we get for free"

这是 **9 次相同句式**，每一次都用"删除本地实现 LOC 数"作为价值衡量，而不是"用户获得的体验改进"或"对销售可讲的卖点"。`pi-sdk-implementation-plan.md:248-262` 的 Milestone matrix 列 LUM-37 ~ LUM-49，每项仅标 LOC 增量，没有商业 / 用户指标。

#### 2.3.2 风险表只有 "技术风险"，没有 "产品 / 市场风险"

- `migration-pi-electron.md` 的风险章节（按 §5 引用、`pi-capability-gap-analysis.md:434-444` 重新评估）只列：custom titlebar、Pi RPC protocol change、BYOK migration script、Bundle size、Session format incompatibility、Team runtime / subagents、Background tasks、Plan mode、Pi breaking changes。完全没有"用户感知到的产品风险"，例如：Pi 上游 breaking change 传导到 OpenBuddy 客户业务、WorkBuddy 品牌兼容性、企业销售信任度等。
- `pi-core-capabilities.md:949-957` 的 "Net result" 表只有 LOC、provider 数、tools 数、session 管理、MCP transports、skills、permissions、BYOK isolation、Plan mode、Web search、Subagents、Memory、Account/OAuth。**没有 NPS、retention、conversion、ARPU、deal cycle、support load 等产品指标**。

#### 2.3.3 "暂不做" 与 "Non-goals" 仅限工程边界

- `pi-runtime-next-roadmap.md:97-103` 的"暂不做"全是工程边界：不再引入第二套 Agent loop、不把 AgentSession 移到 Renderer、不为兼容单个插件复制其完整后端、不在 P0 前继续扩大 UI 表面。**没有"暂不做企业销售"、"暂不做多语言"、"暂不做 Windows 原生 PTY 完整 parity"** 这种产品边界（Windows PTY 在 `pi-openbuddy-completeness-audit.md:744` 才承认是技术债务）。
- `brief.md:21-31` 的 Non-goals 也仅限工程：不恢复 Grok、不伪造 WorkBuddy 私有后端、不修改 Pi AgentSession、不把真实 API key 写入仓库、不增加常驻 Debug toolbar、不 mock 关键链路、不删除 IPC。**没有"不承诺 WorkBuddy 商业账号对等"、"不替代 deepseek-harness 的全部生态"、"不替代 WorkBuddy 私有云后端"等商业边界条款**——尽管 brief 本身确实写了"不伪造 WorkBuddy 私有云后端"和"private/undocumented Pi internals are not invented"，但 PI 分析后续文档在 "What we get for free" 部分实际上仍然把 Pi 能力当作 OpenBuddy 卖点，没有为这种"非承诺"建立结构化文档。

### 2.4 视角偏差的根因

PI 分析文档由"Pi 迁移项目组"产出（Tracking issue 全部为 LUM-37 ~ LUM-49 / TBD，见 `pi-sdk-implementation-plan.md:248-262`），产出目的是为 LUM-37 收口提供技术依据。文档读者被假设为 "code reviewer / PR 评审者"，不是 "产品负责人 / 销售负责人 / 企业客户"。因此视角偏差是结构性的，而非偶然笔误。

---

## 3. 方法论缺陷清单（按严重程度排序）

### 3.1 [P0] 把"Pi 上游能力"等同于"OpenBuddy 产品能力"

**证据**：

- `pi-core-capabilities.md:179-227` 列出 Anthropic、OpenAI、Gemini、Mistral、Groq、Cerebras、xAI、OpenRouter、Vercel AI Gateway、Azure、Bedrock、Kimi、DeepSeek、ZAI、MiniMax、Qwen Token Plan、NVIDIA NIM、Cloudflare AI Gateway、Hugging Face、Fireworks、Together AI、Baseten、Xiaomi MiMo、Ant Ling 共 24+ provider，随后 `pi-core-capabilities.md:261-270` 直接得出 "All 19+ providers ship with Pi; OpenBuddy's `providers_save_*` / `providers_delete_*` / `providers_fetch_models` all map to `~/.pi/agent/models.json` read/write + the built-in registry"。**没有"对 OpenBuddy 客户而言这 24 个 provider 中哪几个值得在 Settings UI 默认展示 / 哪些要放在 advanced / 哪些仅 BYOK 不可推荐"的产品决策**。
- `pi-core-capabilities.md:366-420` 给出 ExtensionAPI 的 6 类能力（registerTool / registerCommand / registerShortcut / on / sendUserMessage / UI dialog）后，紧接 `pi-core-capabilities.md:427-456` "OpenBuddy strategy" 才提出 "agent-team / inspiration / folder-trust / plan-mode / automations / notifications / subagents / web-search 8 个 Pi 扩展 + 10 个 host 模块"。这种 "上游能力 → 下游扩展"的映射缺少"用户场景 → 所需能力 → 是否需要包装 → 包装程度"的需求驱动过程。
- `pi-capability-gap-analysis.md:407-441` "Reuse opportunities worth taking" 推荐 `@pi9/todo`、`@arvorotech/pi-plan-mode`、`@juicesharp/rpiv-ask-user-question`、`@burneikis/pi-nolo`、`@mariozechner/pi-tui`、`omp acp`。这些是社区包，没有安全审计、license 稳定性、长期维护承诺、用户教育成本、产品一致性代价等评估，PI 分析只把它们作为 "saves us a few components"（line 410）。

**严重程度**：P0。**这是 PI 分析最核心的方法论缺陷**，直接导致 11 类覆盖盲点（见 §4）。

### 3.2 [P0] 验证体系过度集中在 "Pi 自身契约" 与 "Electron 启动 + MiniMax 单 LLM smoke"

**证据**：

- `brief.md:35-77` 的 15 个 Acceptance examples（A1–A15）几乎全部是 IPC / Electron 启动 / Pi event log / MiniMax Anthropic 多轮对话。A11 是 "真实 MiniMax 验证"（单 LLM 通道）、A12 是 "codex/casdoor / codex/storage / codex/openbuddy 跨分支融合"（仅 IPC 维度）、A13 是 "AI Agent 全功能真实闭环测试矩阵"（也仅 capability → IPC → smoke 维度）、A14 是 "AgentBench-tools / AgentDojo-safety / GAIA-style 顶级测试集"（但 PI 分析未跟进）。**A1-A15 中 0 个 acceptance 涉及 UX 验收、用户旅程、商业计费、企业 SLA、多租户 RBAC、跨平台 parity、销售就绪度**。
- `pi-openbuddy-completeness-audit.md:140-162` 的"重新验证命令"仅 7 条：`pnpm exec vitest run`、`pnpm exec tsc --noEmit`、`pnpm exec electron-vite build`、`node --check scripts/electron/smoke.mjs`、`pnpm exec node scripts/electron/smoke.mjs`、`git diff --check`、真实 MiniMax smoke。**没有端到端 UX 测试、没有可访问性测试、没有跨平台真实 Electron smoke、没有外部 evaluator（Inspect-AI / DeepEval / Promptfoo / Langfuse）运行**——尽管 `pi-openbuddy-completeness-audit.md:546` 自承 "Inspect-AI、DeepEval、Promptfoo、Langfuse 适配器已实现 fail-closed，但本机未安装对应依赖，因此本轮未单独执行这些框架命令"。
- `pi-real-plugin-compatibility.md:8-22` 验证的 6 个真实 Pi 包：`pi-context-prune`、`pi-mcp-adapter`、`pi-web-access`、`pi-goal`、`pi-plan-mode`、`pi-subagents`。这些都是 "Pi 包 → Pi 原生资源" 的兼容性，未验证它们对 OpenBuddy 业务能力的实际贡献（例如 `pi-goal` 是否能让 OpenBuddy 用户完成 "设定本季度目标并追踪" 这种端到端体验？文档未评估）。
- `pi-runtime-next-roadmap.md:88-94` 的 P3 真实验收矩阵也只覆盖 Pi（MCP/Web/Goal/Plan/Subagents/Hermes）、Harness（client/remote/typert/Cordis package）、provider、Electron、安全。**无 UX 维度、无商业维度、无企业维度**。

**严重程度**：P0。

### 3.3 [P0] 把 "Net LOC 减少" 当作业务价值

**证据**：

- `pi-capability-gap-analysis.md:441` "**Net Rust LOC deleted: 14,237. Net TS LOC added: ~3,000.** That's the win."
- `pi-sdk-implementation-plan.md:248-262` 整个 Milestone matrix 列 LUM-37 ~ LUM-49，每项只有 LOC 净增量。
- `pi-core-capabilities.md:949-957` 整个 "Net result" 表只有 LOC、provider 数、tools 数等数字。
- `migration-pi-electron.md:51` 表格里 "Net Rust LOC deleted: 14,237" 标为"This is the win"。

**问题**：LOC 是工程效率指标，不是用户价值指标。一个 LOC 减少 75% 但 UX 倒退 30% 的迁移在产品视角下可能是失败；LOC 增加 50% 但完成企业级 RBAC、SLA、审计的迭代是成功。PI 分析从未建立"产品价值 vs LOC 减少"的相关性论证。

**严重程度**：P0。

### 3.4 [P1] "subagent / team / plan mode / inspiration / notifications" 反复出现，但每次都以"Pi 上游缺乏 → 我们写一个扩展"处理，缺少"用户真实需求规模 vs 写扩展的投入"决策

**证据**：

- `pi-capability-gap-analysis.md:223-243` §2.8-§2.10 反复出现 "Port / Reimplement / Wrap" 三类决策，但都只给出 LOC 估算或"pure UI concern"。例如 line 229 "Inspiration generation: this is the trickier one. WorkBuddy's 'inspiration' appears to be: spin up a side session with a random creative prompt and surface the result. We can implement it as a Pi extension that calls `pi.sendMessage()` with an 'inspiration' prompt template and a separate session id, then forwards `message_end` events as `grok://inspiration`. No native support; minor reimplementation (~50 LOC)."——这是把 "Pi 不提供 inspiration" 直接当作 "写 50 LOC Pi 扩展"，没有"OpenBuddy 用户对 inspiration 功能的使用频率 / NPS / 弃用率 / WorkBuddy inspiration 在 OpenBuddy 战略中的位置"评估。
- `pi-core-capabilities.md:711-732` 同样处理 inspiration：line 729 "OpenBuddy strategy: `extensions/openbuddy/inspiration/`"。
- `pi-openbuddy-completeness-audit.md:223-231` 的 `openbuddy-inspiration` 实现是 "纯函数 adapter，15 条 LUM-44 种子，无 LLM 成本"。但 `expert-team-design.md:269-336` 的差距矩阵 G1（场景化首页与技能推荐）已经把 inspiration 列为 P3 优先级，且 §3 指出 WorkBuddy inspiration 是 "side session creative prompt" 而 OpenBuddy 是 "15 条种子"。**PI 分析把 WorkBuddy 的复杂体验降级到 15 条种子，不评估用户价值损失**。

**严重程度**：P1。

### 3.5 [P1] 性能 / 可观测性 / 可调试性只在"测试通过"维度，未提供用户体验维度的指标

**证据**：

- `pi-core-capabilities.md:42-56` AgentSession 方法列表没有任何性能特征（latency p50/p95、streaming 帧率、内存增长、tool execution timeout）。
- `pi-openbuddy-completeness-audit.md` 全文搜索 "performance" / "latency" / "p95" / "frame rate"，仅在 `pi-runtime-next-roadmap.md` 隐含 "P2: harness 可靠性" 提到，无具体数字。
- `brief.md:24-26` 的 Verification expectations 列 "运行 Vitest / TypeScript / Renderer/Main/Preload / 生产构建 / Electron smoke / `git diff --check`"，没有性能 smoke、没有内存增长 smoke、没有长会话（>100 turn）稳定性 smoke。
- `pi-openbuddy-completeness-audit.md:738-744` 的本地 Harness Terminal/Jobs 矩阵证据 `5 skipped`，未说明跳过的原因、是否是平台不支持、是否影响产品可用性。

**严重程度**：P1。

### 3.6 [P1] 把"WorkBuddy Renderer 风格保留"当作 UI 一致性策略

**证据**：

- `pi-extension-architecture.md:7` "OpenBuddy embeds the Pi SDK in Electron main and **keeps the WorkBuddy renderer as the UI**"。
- `pi-runtime-next-roadmap.md:7` "UI 继续保持 WorkBuddy 风格"。
- `pi-openbuddy-completeness-audit.md:41` "保持 WorkBuddy Renderer 只消费既有事件/IPC 面"。
- `pi-openbuddy-completeness-audit.md:294` "继续使用现有 WorkBuddy UI 和单一 Pi Main runtime，不在前端创建第二套 AgentSession"。

**问题**：

- `WORKBUDDY_UI_REFERENCE.md` 自承"待完善 📝：场景标签页、技能推荐栏、置顶会话功能、工作空间分组、权限管理面板、设置面板完善、搜索功能、更多动画效果"。PI 分析从不评估这些未完成项的完成进度对产品价值的影响。
- `WORKBUDDY_UI_REFERENCE.md` 列出的 16 个基础组件（Avatar/Breadcrumb/Button/Card/...）与 8 个布局组件（Sidebar/HomePage/SearchPanel/...）与 8 个业务组件（conversation-list/pinned-section/...），PI 分析无任何关于"这些组件在 OpenBuddy Renderer 中的实际覆盖度 / 哪些是 stub / 哪些是完整的"评估。
- `workbuddy-parity-matrix.md` 的 capability 列表与 PI 分析的 capability 列表维度不同：workbuddy-parity-matrix 关注"用户在 UI 上能否看到 / 能否触发"，PI 分析关注"IPC 通道是否存在"。

**严重程度**：P1。

### 3.7 [P2] 把 "OpenBuddy 多项目并存"（HOME / PROJECT / multi-session）混在"Pi session tree"里，未做业务分类

**证据**：

- `pi-core-capability-gap-analysis.md:127-178` 的 Sessions 章节把 OpenBuddy 的所有 session 都视为 Pi JSONL tree。但 `storage-architecture-audit.md:79` 已经识别 "Pi transcript、Markdown memory、旧 JSON/JSONL、relay outbox、Keychain secret values 和临时 `localStorage` 仍保留为明确兼容/安全边界"，并且把 session catalog、session event log、collaboration event stream、team catalog、settings、tasks、automations、automation runs、notifications、memory metadata/FTS、MCP registry、credential refs、calendar state 接入独立 `packages/runtime/openbuddy-storage` 的 SQLite-first adapters。

**问题**：PI 分析的 Pi session tree 假设"每个 cwd 一个 JSONL 文件"，与 storage-audit 的"SQLite catalog-first + JSONL mirror"不兼容——后者把 Pi JSONL 当作兼容/审计导入源，不是 system of record。`pi-openbuddy-completeness-audit.md:282-302` 自承 "Pi JSONL 现在已经具备第一段 Harness 风格冷恢复语义 ... 准备按 session id 独占"，但 `storage-architecture-audit.md:5-21` 已经声明"JSONL 是 transcript 权威源；SQLite 是 pinned/archived/expert 等 metadata system of record"。**两套事实源矛盾**（详见 §6.1）。

**严重程度**：P2。

### 3.8 [P2] Pi 上游 breaking change 风险反复出现，但风险缓解只停在"pin 版本"

**证据**：

- `pi-capability-gap-analysis.md:444` 风险重新评级："Pi breaking changes between releases — Medium — project is in active iteration (v0.84+ → 2026+); pin and document."
- `pi-runtime-next-roadmap.md:86` "P2：补齐 Harness 级可靠性" 中提到 "Pi breaking changes between releases" 多次，但缓解措施只是 "Pin Pi" / "publish upgrade path doc"。

**问题**：上游迭代速度本身是产品风险（用户每次升级都可能被 breaking change 影响），PI 分析未评估：(a) Pi 上游 license 稳定性（MIT → 商业许可的潜在转变）；(b) Pi 上游领导层 / 团队稳定性（Mario Zechner 单人维护期 / Earendil Works 接手后的人员）；(c) Pin 版本的弃用窗口；(d) Pi 上游破坏性变更传导到 OpenBuddy 客户业务的影响。`pi-extension-architecture.md` §"Recommended adoption order"（line 298-307）只列 5 步产品采用顺序，没有"上游变更响应 SOP"。

**严重程度**：P2。

### 3.9 [P2] "workbuddy-parity-matrix.md 第 9 行"明确把 WorkBuddy 私有云/商业账号排除，PI 分析从未声明同样的边界

**证据**：

- `workbuddy-parity-matrix.md:11` 第 9 行 "WorkBuddy 私有云/商业账号：未实现、未伪造、不纳入真实通过项、需要公开协议或用户账号授权、否（不纳入本 change）"。
- `brief.md:25` "不伪造 WorkBuddy 私有云后端、商业账号、未公开 API 或第三方 OAuth/marketplace 交易能力"。

**问题**：PI 分析的"Net result"反复把 "19+ providers" / "Subagents" / "Plan mode" / "Web search" 当作 OpenBuddy 卖点，但实际上：

- `pi-capability-gap-analysis.md:229` 写 "WorkBuddy's 'inspiration' appears to be: spin up a side session ... We can implement it as a Pi extension that calls `pi.sendMessage()`"——直接套用 WorkBuddy 设计，未评估 "OpenBuddy 是否应完全照搬 WorkBuddy 的灵感模型"。
- `pi-capability-gap-analysis.md:235` "experts.rs (636 LOC) + connectors_catalog.rs (541 LOC) + skills_catalog.rs (835 LOC)"——把 WorkBuddy 的目录当作 "gap column" 里的"需要 port"，而不是 "WorkBuddy 用户期待的体验"。

**严重程度**：P2。

### 3.10 [P3] "OpenBuddy is Pi's adaptation layer" 与 "OpenBuddy 是企业级平台"两种定位在文档间并存

**证据**：

- `pi-openbuddy-completeness-audit.md:575` "当前实现是 Pi-first 的 OpenBuddy 适配层，不宣称已替代 deepseek-harness 的全部生态包"。
- `README.md:299-411` "Beyond the personal WorkBuddy-style surface, OpenBuddy ships a full enterprise control plane built around Casdoor (identity / RBAC / multi-tenant) and New API (token accounting / multi-provider routing). All control panels live inside the Settings dialog and talk to a self-hosted Casdoor Resource Gateway that we operate alongside New API." "Twelve enterprise control panels (all shipped)"。

**问题**：PI 分析把 OpenBuddy 描述为 "Pi 适配层"，README 把 OpenBuddy 描述为 "完整企业级平台"。两套叙事并存导致：(a) 企业销售读 PI 分析会得出"OpenBuddy 只是 Pi 之上的壳"，从而质疑商业可行性；(b) 用户读 README 会得出"OpenBuddy 是完整产品"，但被 PI 分析的"尚未替代 DeepSeek Harness 全部生态包"反复打断；(c) 工程团队读 PI 分析会认为"完成 Pi 集成 = 完成 OpenBuddy"，但实际企业级平台还需要 Casdoor、New API、Resource Gateway、Wallet、Credit Ledger 等 PI 分析未涉及的子系统。

**严重程度**：P3（叙事风险，会影响销售 / 用户 / 工程团队三方认知一致性）。

### 3.11 [P3] 文档的 "已验证" / "real-external" / "real-local" / "fixture-only" 分级有效，但分级阈值不一致

**证据**：

- `pi-openbuddy-completeness-audit.md:113` "由于当前环境没有安装 `pi-context-prune`、`pi-mcp-adapter` 或 `pi-web-access`，这些外部包的真实第三方 E2E 仍待单独运行，不能由 fixture 证据替代。"——明确了 fixture ≠ real-external。
- `pi-openbuddy-completeness-audit.md:55-58` "该结果属于 `real-external` 的 published registry/network 证据，但不等同于真实 provider 或完整第三方插件 parity。"——再次区分。
- 但 `pi-real-plugin-compatibility.md:8-22` 的 6 个 Pi 包验证全部标为 "已验证"，未区分"profile 安装 + extension 绑定"与"实际功能交付"。
- `pi-runtime-next-roadmap.md:88-94` "Pi：MCP、Web、Goal/Plan、Subagents、Hermes Memory/Lens" P3 验收矩阵只列包名，无分级。

**问题**：分级标准仅在 `pi-openbuddy-completeness-audit.md` 部分段落隐含，没有统一的"real-external / real-local / fixture-only / 未验证"判定 SOP；不同章节的"已通过"含义不同。

**严重程度**：P3。

---

## 4. 覆盖盲点分类矩阵（盲点 × 当前状态 × 风险）

下表列出 12 类盲点。每行格式：盲点 / PI 分析当前状态（引用具体行号） / 产品风险。

### 4.1 产品定位与差异化（vs WorkBuddy、Codex、Grok-build、OpenClaw）

- **PI 当前状态**：
  - `pi-capability-gap-analysis.md` 全文搜索 "WorkBuddy" 仅 6 处出现，且都是 "transition source" 含义（line 229、235、243 等），未做产品对标；
  - `pi-core-capabilities.md` 全文搜索 "WorkBuddy" 仅 0 处出现（`pi-core-capabilities.md` 从未提及 WorkBuddy 作为竞品或参照系）；
  - `pi-extension-architecture.md` 全文搜索 "WorkBuddy" 仅 1 处 "keeps the WorkBuddy renderer as the UI"（line 7），同样只是渲染层；
  - `pi-openbuddy-completeness-audit.md` 全文搜索 "WorkBuddy" 约 18 处，绝大部分是 "WorkBuddy UI" / "WorkBuddy Renderer" / "WorkBuddy IPC"，无一处做产品对比。
  - Codex、Grok-build、OpenClaw 在 PI 分析中完全未出现。
- **产品风险**：P0。OpenBuddy 销售在没有竞品对比图的情况下，无法向潜在企业客户说明"为什么选 OpenBuddy 而非 WorkBuddy / Codex / Grok-build"。`workbuddy-points-system-comparison.md` 与 `expert-team-design.md` 已经存在 WorkBuddy 对标，但 PI 分析从不引用这些对标结论。

### 4.2 用户旅程与 UX 一致性

- **PI 当前状态**：
  - 全文搜索 "user journey" / "onboarding" / "first-time" / "empty state" 在 `docs/pi-*.md` 中均 0 处出现；
  - `pi-extension-architecture.md:7` 仅 "keeps the WorkBuddy renderer as the UI"，无空状态 / 引导流 / 错误恢复 UX 设计；
  - `WORKBUDDY_UI_REFERENCE.md:108-116` 列 8 个 "待完善" UI 项，PI 分析未评估其中任何一个对 Pi 集成的依赖。
- **产品风险**：P0。WorkBuddy 的核心价值是 "polished UI"（README:40 引用），如果 OpenBuddy Renderer 保留 WorkBuddy 风格但 Pi 集成引入新事件、新错误、新交互，但 UI 未补齐这 8 项，则"polished" 承诺无法兑现。

### 4.3 商业模型（计费、套餐、License、企业销售）

- **PI 当前状态**：
  - 全文搜索 "point" / "credit" / "wallet" / "SKU" / "billing" / "subscription" / "license" / "enterprise sale" 在 `docs/pi-*.md` 中均 0 处出现；
  - `pi-core-capabilities.md:262-270` "BYOK isolation bug class disappears entirely — Pi has no 'default internal model' to clash with" 暗示 BYOK = 无平台风险，但 `openbuddy-commercial-model.md:23-66` 与 `workbuddy-points-system-comparison.md:25-40` 都把 New API + Resource Gateway 当作商业事实源；
  - `README.md:299-358` 列 12 个企业面板、Token commerce model、Production deployment、Casdoor IDP templates、Observability，PI 分析无任何章节涉及。
- **产品风险**：P0。PI 分析让 OpenBuddy 工程团队把 "Pi + Cordis + Electron Main" 当作产品，但商业上需要 Casdoor、New API、Resource Gateway、Wallet、Credit Ledger、SKU、付费通道。两者完全脱节，会导致 Pi 集成完成 ≠ 可商业化。

### 4.4 企业级部署（私有化、SLA、审计、合规）

- **PI 当前状态**：
  - 全文搜索 "SLA" / "private deployment" / "on-premise" / "air-gap" / "SOC2" / "ISO 27001" / "审计" 在 `docs/pi-*.md` 中均 0 处出现；
  - `pi-openbuddy-completeness-audit.md:530-548` 的"已完成"包括 "Pi 核心 Agent Runtime"、"Pi 扩展与兼容适配"、"DeepSeek Harness 插件主机"、"Harness 传输与 Renderer 接入"、"动态扩展 reload"、"模块化边界"，无任何企业部署能力；
  - `deployment-guide.md`（README:350 引用）是 38 个环境变量、Postgres HA / backup / restore、SIEM (syslog / webhook / CSV)、Caddy + Let's Encrypt、Alertmanager rules 的 operations manual，PI 分析未引用任何 deployment-guide 内容。
- **产品风险**：P0。Pi integration 假设单进程 + Electron Main，分布式 / HA / 私有化部署 / air-gap / SOC2 / 备份策略在 PI 分析里 0 出现。企业客户无法基于 PI 分析判断 OpenBuddy 是否满足其合规要求。

### 4.5 多租户与组织管理（团队、角色、SSO、RBAC）

- **PI 当前状态**：
  - 全文搜索 "multi-tenant" / "tenant" / "RBAC" / "SSO" / "organization" / "team" 在 `docs/pi-*.md` 中：
    - `tenant`：仅 `pi-openbuddy-completeness-audit.md:259-260` 出现 "workspace:list" / "workspace management"，**无 tenant 概念**；
    - `multi-tenant` / `RBAC` / `SSO`：0 处；
    - `team`：仅在 §11 Subagents 章节作为 "agent team" 概念出现（`pi-core-capabilities.md:711-732`），与 casdoor-enterprise-auth.md:131-160 的 "团队管理" 是不同概念。
  - `casdoor-enterprise-auth.md` 列 12 个企业面板（账户管理、租户成员、账号绑定、Webhook 订阅、企业计费、积分定价、资源目录、租户策略、会话管理、Token 内省、网关健康、成本对账），PI 分析从未引用此文档。
- **产品风险**：P0。"团队"在 PI 分析里是"agent 多 agent runtime"，在企业产品里是"组织成员 / 租户 / RBAC"。两套语义在文档中并存会让企业销售无法回答 "我们部门 50 人怎么用 OpenBuddy"。

### 4.6 数据安全（凭据管理、加密、跨边界、隐私）

- **PI 当前状态**：
  - `pi-core-capabilities.md:751-815` §14 Auth & account 描述 `AuthStorage`、`~/.pi/agent/auth.json`、PKCE、OAuth flows；`pi-openbuddy-completeness-audit.md:235` `electron/main/deepseek-generic.ts` 提到 "生产 credentials 使用 `CredentialStore` + OS Keychain，测试使用 ephemeral provider"；
  - 但全文搜索 "Keychain" / "SecretStore" / "credential" 在 `docs/pi-*.md` 中仅 5 处出现（`pi-openbuddy-completeness-audit.md` 的 CredentialStore 段落），**无 GDPR / CCPA / 合规审计 / 跨边界数据流 / 隐私设计**。
  - `storage-architecture-audit.md:189-203` 已经建立 SecretStore / 凭据迁移 / 备份 / 保留策略 / 可观测性 / HTML 脱敏的完整设计，但 PI 分析无任何引用。
- **产品风险**：P0。BYOK 凭据如果泄露或不当持久化，企业客户会立即下架 OpenBuddy。

### 4.7 跨平台一致性与可维护性

- **PI 当前状态**：
  - `pi-openbuddy-completeness-audit.md:738-744` "仍未宣称完整 Harness parity：Windows 原生 PTY、Linux bubblewrap/Landlock 与真实 `dsh-sandbox-local` provider 的严格执行、完整 foreground process-group/readiness/spill/tree-quiescence 语义、真实 published subprocess/sandbox package E2E、terminal/job 跨 Electron 重启策略、第三方插件全量矩阵仍需继续完成"——明确承认 Windows / Linux 原生 PTY 未完成；
  - `pi-openbuddy-completeness-audit.md:741` "下一步应优先增加真实 published package gated E2E，并明确 terminal/job 默认只恢复 metadata、不跨重启恢复旧进程"；
  - 但 `macos-signing.md`、`electron-builder.yml`、`README.md` 的 macOS / Windows / Linux 三平台分发未在 PI 分析中评估。
- **产品风险**：P1。Mac 用户首次安装 / 升级时签名问题、Windows 用户 PTY 不工作、Linux 用户无 sandbox，三类平台问题会直接导致客户流失。

### 4.8 性能、可观测性、可调试性

- **PI 当前状态**：
  - `pi-runtime-next-roadmap.md:7` "Event/State Gateway snapshot/readiness/RPC/replay"——可观测性组件提及，但无具体指标；
  - `pi-openbuddy-completeness-audit.md:530-548` "已完成" 未包含"性能基准"；
  - 全文搜索 "performance" / "p95" / "latency" / "memory growth" / "CPU usage" 在 `docs/pi-*.md` 中均 0 处出现；
  - 无 SLO / SLI / 错误预算定义。
- **产品风险**：P1。Pi 上游 breaking change 难以在生产环境早期发现，性能回归难以归因（是 Pi 慢还是 Cordis 慢还是 Renderer 慢？文档无答案）。

### 4.9 文档、学习曲线、社区

- **PI 当前状态**：
  - `pi-sdk-implementation-plan.md:1-9` 全文 319 行无任何章节讨论"用户文档 / API 文档 / 开发者上手时间"；
  - `pi-capability-gap-analysis.md` 与 `pi-core-capabilities.md` 的 References 章节能列出 10+ 外部链接，但这些链接是给开发者看的，不是给 OpenBuddy 用户看的；
  - 无新手入门 / 5 分钟跑通 Hello World / 典型场景 walkthrough / FAQ。
- **产品风险**：P2。开源项目若文档缺，新贡献者少 → 生态弱 → 难以与 WorkBuddy 闭源产品差异化。

### 4.10 长期演进与技术债务

- **PI 当前状态**：
  - `pi-runtime-next-roadmap.md:5-23` 与 `pi-extension-architecture.md:298-307` 列 P0-P3 路线，但仅覆盖技术 debt（session boundary / plugin snapshot / harness reliability / 真实插件矩阵）；
  - 无 "Pi 上游弃用 / 不维护" 风险评估；
  - 无 "Pi 商业化（如果 Earendil Works 把 Pi 转为商业许可）" 风险评估；
  - 无 "Pi Fork / 自维护分支" 决策框架。
- **产品风险**：P2。依赖单一上游（Pi / Earendil Works / Mario Zechner）的开源项目，长期演进路径不清晰。

### 4.11 失败模式与边界条件

- **PI 当前状态**：
  - `pi-openbuddy-completeness-audit.md:732` "本轮仓库 production build 本轮仍受既有 `packages/capability/openbuddy-email/src/index.ts` 的 `EmailDraft | undefined` 类型错误阻塞，不归因于本轮执行底座改动"——承认 production build 阻塞但归因于其他模块；
  - `pi-runtime-next-roadmap.md:88-94` P3 真实验收矩阵只列成功路径，无失败路径（Pi 上游不可用 / MiniMax 不可用 / Electron 启动失败 / 用户电脑磁盘满 / 网络中断 / 凭据失效）。
  - 无 SLO/SLI/SLA/error budget 设计。
- **产品风险**：P1。产品上线后第一次大规模故障（MCP server 全部不可用 / Electron 启动失败）无 runbook。

### 4.12 WorkBuddy 私有能力对标

- **PI 当前状态**：
  - `workbuddy-parity-matrix.md:11` 第 9 行明确把 "WorkBuddy 私有云/商业账号" 排除；
  - `expert-team-design.md:340-348` §5.1 列出 5 类 WorkBuddy 私有能力限制；
  - PI 分析中 `pi-capability-gap-analysis.md:229` "WorkBuddy's 'inspiration' appears to be: spin up a side session with a random creative prompt" 等 6 处 "appears to be" / "based on" 推测，**没有引用任何已确认的 WorkBuddy 私有能力文档**（用户协议、API 文档、白皮书）；
  - `brief.md:25` "不伪造 WorkBuddy 私有云后端、商业账号、未公开 API 或第三方 OAuth/marketplace 交易能力" 是 brief 边界，但 PI 分析后续章节实际未严格遵守——例如 `pi-capability-gap-analysis.md:407-441` 把 "@pi9/todo、@arvorotech/pi-plan-mode、@juicesharp/rpiv-ask-user-question、@burneikis/pi-nolo" 推荐为可直接使用的 community package，没有审计这些包是否引用了 WorkBuddy 私有 API。
- **产品风险**：P2。如果 PI 分析推荐的开源包实际上复制了 WorkBuddy 私有实现，会引发 license / 知识产权风险。

---

## 5. 错误假设与夸大承诺清单

| # | 假设 / 承诺 | 文档引用 | 反证 / 现实 | 严重度 |
|---|---|---|---|---|
| 1 | "Pi 集成完成 = OpenBuddy 可用" | `pi-openbuddy-completeness-audit.md:530-548` "已完成" 列 6 项；`pi-capability-gap-analysis.md:441` "That's the win" | `pi-openbuddy-completeness-audit.md:732` production build 被阻塞；`532-548` 列 5 个剩余边界；商业 / 企业 / UX 维度（见 §4）完全未完成 | P0 |
| 2 | "BYOK 等于无平台风险" | `pi-core-capabilities.md:262-270` "BYOK isolation bug class (`byok_isolate` ~80 LOC) disappears entirely — Pi has no 'default internal model' to clash with" | `openbuddy-commercial-model.md:1-66` 商业账本不依赖 BYOK；`workbuddy-points-system-comparison.md:25-40` New API `quota` ≠ OpenBuddy 积分；BYOK 用户只是其中一类客户 | P0 |
| 3 | "Net Rust LOC deleted: 14,237. Net TS LOC added: ~3,000. That's the win." | `pi-capability-gap-analysis.md:441`、`pi-core-capabilities.md:949-957`、`migration-pi-electron.md:51` | LOC 是工程指标不是用户价值指标；用户看到的价值 = UX 提升 + 新功能 + 商业权益，不是 LOC 减少 | P0 |
| 4 | "All 19+ providers ship with Pi" 暗示 OpenBuddy 立刻具备完整 BYOK provider 矩阵 | `pi-core-capabilities.md:179-227` 列出 24+ provider；`pi-core-capabilities.md:261-270` "What we get for free" | provider 注册只是配置文件层；UI 默认显示哪些 / 哪些标 recommended / 哪些 BYOK / 哪些 commercial channel 都不在 Pi 范畴；`openbuddy-commercial-model.md:23-66` 商业渠道需要 New API Group + Channel 验证 | P1 |
| 5 | "subagent / team / plan / inspiration 都用 ~50 LOC Pi 扩展补齐" | `pi-capability-gap-analysis.md:223-243`、`pi-core-capabilities.md:711-732` | 50 LOC Pi 扩展只解决 IPC 层；UI（WorkBuddy Sidebar 同事面板、`WORKBUDDY_UI_REFERENCE.md`）、商业权益（`workbuddy-points-system-comparison.md`）、用户体验（`expert-team-design.md:269-336` G1-G13）均不在 Pi 扩展覆盖范围 | P1 |
| 6 | "OpenBuddy 已通过真实 MiniMax 五轮 smoke" | `pi-openbuddy-completeness-audit.md:140-162`、`workbuddy-parity-matrix.md:13-18` | 单 LLM 通道 (MiniMax-M3) ≠ 完整产品验证；缺 UX / 商业 / 企业 / 跨平台 / 长会话 / 错误恢复 / 多用户并发 | P0 |
| 7 | "OpenBuddy 可通过 harness smoke 替代 WorkBuddy" | `workbuddy-parity-matrix.md` 9 个能力行 + `brief.md:25` "不伪造 WorkBuddy 私有后端" | PI 分析 0 处把 OpenBuddy 描述为 "WorkBuddy 替代品"；事实上 OpenBuddy 是 "WorkBuddy 风格 + Pi 开源"，不是替代 | P1 |
| 8 | "production build 通过" | `pi-openbuddy-completeness-audit.md:154` `electron-vite build` 列在验证命令中 | `pi-openbuddy-completeness-audit.md:732` 同文档另一段承认 "本轮仓库 production build 本轮仍受既有 `packages/capability/openbuddy-email/src/index.ts` 的 `EmailDraft | undefined` 类型错误阻塞" | P0（内部矛盾） |
| 9 | "真实 published Harness artifact 集成矩阵 = 真实 parity" | `pi-openbuddy-completeness-audit.md:55-58` "该结果属于 `real-external` 的 published registry/network 证据" | 同段紧接 "但不等于完整第三方插件 parity"——这是分级合理，但 `pi-runtime-next-roadmap.md:88-94` P3 真实验收矩阵仍把 "Harness：client、remote、typert、官方 Cordis package" 列为目标，未声明当前实现是 partial | P2 |
| 10 | "deepseek-harness 30+ 包覆盖 55+ 完整生态" | `full-pluginization-plan.md:1-290` §1.1-§7 | 同文档 §4 列 24 commits 计划，但当前 `pi-openbuddy-completeness-audit.md` 已落地 14 个 `pi-*` adapter 家族，仍属 partial | P1 |
| 11 | "Cordis 是 OpenBuddy 的 canonical service seam" | `pi-extension-architecture.md:3-7` "Cordis remains the canonical service seam for persistent and cross-surface capabilities" | 商业账本（Wallet/Credit/Ledger/Order）的系统 of record 是 Resource Gateway（`openbuddy-commercial-model.md:1-66`），不是 Cordis；身份与权限的事实源是 Casdoor（`casdoor-enterprise-auth.md:1-30`），也不是 Cordis | P1 |
| 12 | "brief 是空模板就足够驱动开发" | `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` 全文仅 9 个空标题 | 对比 `docs/comet/changes/openbuddy-electron-pi-closure/brief.md` 才是真实 brief（79 行具体内容）；空模板若被当作"无 brief 变更"，则该变更的 Outcome / Scope / Acceptance / Verification 等关键约束全部丢失 | P2（文档治理风险） |
| 13 | "OpenBuddy 是 Pi-first 的 OpenBuddy 适配层" | `pi-openbuddy-completeness-audit.md:575` 自承 | 与 `README.md:299-411` "Beyond the personal WorkBuddy-style surface, OpenBuddy ships a full enterprise control plane" 定位冲突 | P1（叙事风险） |
| 15 | "AgentBench-tools / AgentDojo-safety / GAIA-style 顶级测试集已接入" | `brief.md:60` A14 | `pi-openbuddy-completeness-audit.md:546` 自承 "Inspect-AI、DeepEval、Promptfoo、Langfuse 适配器已实现 fail-closed，但本机未安装对应依赖，因此本轮未单独执行这些框架命令" | P1 |

---

## 6. 与其他分析文档的冲突点

### 6.1 数据权威性：PI JSONL vs SQLite

- **PI 立场**：`pi-core-capabilities.md:127-178` §3 Sessions 描述 "Storage: JSONL tree under `~/.pi/agent/sessions/<encoded-cwd>_<timestamp>.jsonl`"，`pi-capability-gap-analysis.md:127` 把 session 列在 "Pi equivalent" 栏，认为是 OpenBuddy 的直接替代；
- **Storage 立场**：`storage-architecture-audit.md:5-21` "推荐不是把所有东西塞进 SQLite，而是采用分层架构 ... SQLite：本地结构化 metadata、事件日志、projection、迁移账本、索引和 FTS ... Pi JSONL：短期保留为兼容/审计导入源；迁移期间双读、shadow compare 和可回滚"；
- **冲突**：Pi 是 system of record 还是 mirror？`pi-openbuddy-completeness-audit.md:282-302` 自承 "Pi JSONL 现在已经具备第一段 Harness 风格冷恢复语义"，似乎把 Pi JSONL 提升为 source of truth；而 `storage-architecture-audit.md:79-100` 把 SQLite catalog-first + JSONL mirror 写入 storage audit。两套事实源在不同文档里并存。
- **后果**：迁移脚本、shadow import、rebuild projection、回滚演练都依赖哪个事实源？`storage-architecture-audit.md:141-189` 已经列出 5 个 phase 的迁移 / 回滚演练步骤，但 PI 分析未引用。

### 6.2 多租户治理：PI 完全无 Casdoor 章节

- **PI 立场**：见 §4.5，PI 分析 0 处出现 "multi-tenant / tenant / RBAC / SSO / organization"。
- **Casdoor 立场**：`casdoor-enterprise-auth.md:1-410` 列 12 个企业面板（账户管理 / 租户成员 / 账号绑定 / Webhook 订阅 / 企业计费 / 积分定价 / 资源目录 / 租户策略 / 会话管理 / Token 内审 / 网关健康 / 成本对账）、`README.md:299-358` 强调 "Beyond the personal WorkBuddy-style surface, OpenBuddy ships a full enterprise control plane"。
- **冲突**：PI 分析把 OpenBuddy 定位为 "Pi 适配层"，完全无 Casdoor / 多租户章节。Casdoor 文档把 OpenBuddy 定位为 "完整企业平台"。两套叙事并存导致企业销售读 PI 分析会得出"OpenBuddy 只是 Pi 之上的壳"，但实际上 Casdoor / Resource Gateway / New API 才是企业级能力的载体。
- **后果**：如果 Pi 集成团队认为"完成 Pi 集成 = 完成 OpenBuddy"，则 Casdoor / Resource Gateway / New API 三个 P0 子系统会无人推进。`openbuddy-commercial-model.md:124-144` 已经把 Casdoor callback/scopes / SMS/WeChat Provider / 真实 Organization 列为 P0 上线前置。

### 6.3 商业计费：PI 完全无 Points/Wallet/SKU 章节

- **PI 立场**：见 §4.3，PI 分析 0 处出现 "point / credit / wallet / SKU / billing / subscription"。
- **Commercial 立场**：`openbuddy-commercial-model.md:1-144` 与 `workbuddy-points-system-comparison.md:1-150` 把 points / wallets / SKUs (`free` / `team` / `enterprise`) / credits / billing orders / shared wallets / HMAC-signed callbacks / refund / expire / transfer 作为商业事实源。
- **冲突**：PI 分析的商业假设 = "BYOK only"，即用户自带 API key，OpenBuddy 不参与商业分发。但 OpenBuddy 的真实商业模式包括：free SKU 自动发放（`workbuddy-points-system-comparison.md:11`）、team SKU 团队购买、enterprise SKU 共享钱包 + Group + 模型白名单、真实 usage 强制（`openbuddy-commercial-model.md:23-30`）。
- **后果**：PI 集成如果推广到 `free` 用户，会遇到"无 BYOK key 无法对话"的体验断裂；推广到 enterprise 用户，会遇到"模型白名单 / 模型 allowlist / 共享钱包 / 资源目录"的全面缺失。

### 6.4 分布式协作：PI 仅"插件化提及"，distributed-buddy 是 4 Phase 事实源

- **PI 立场**：`pi-extension-architecture.md:7` "The distributed Buddy layer follows the same seam: `openbuddy-collaboration` is a separately loadable Cordis/Pi capability plugin. It receives a Main-owned `collaborationRuntimeBridge`, registers redacted snapshot/task/network tools through `pi.tools`, and disposes those registrations with the plugin fiber. The default profile enables it; disabling or reloading the entry does not require changing the existing Personal/Project/Skills/Mail navigation."
- **Distributed Buddy 立场**：`distributed-buddy-network-architecture.md:1-310` 列 4 个 Phase（Phase 0 协议内核、Phase 1 个人 local-first、Phase 2 组织协作、Phase 3 跨设备/跨组织、Phase 4 开放网络）、`Main-owned A2A facade`、`MCP capability governance`、`Relay 授权与恢复边界`、`Federated Room Grant`、`RemoteRelayTransport`、Ed25519 credential 签名、revoke authority 等。
- **冲突**：PI 分析把 collaboration 简化为 "1 个 Cordis/Pi 插件"，distributed-buddy 把它展开为 4 Phase / 跨设备 / 跨组织 / Ed25519 签名 / Federated Room Grant / LocalRelay + RemoteRelay / A2A facade。两套文档描述的不是同一复杂度的功能。
- **后果**：如果 PI 集成团队认为"openbuddy-collaboration 插件已落地 = 分布式协作完成"，则会忽略 LocalRelay / RemoteRelay / revoke / Ed25519 签名 / Federated Room Grant 的工程量。

### 6.5 WorkBuddy 私有能力：PI 假设可移植，parity-matrix 明确排除

- **PI 立场**：`pi-capability-gap-analysis.md:229` "WorkBuddy's 'inspiration' appears to be: spin up a side session with a random creative prompt"——直接套用 WorkBuddy 设计；
- **Parity Matrix 立场**：`workbuddy-parity-matrix.md:11` 第 9 行 "WorkBuddy 私有云/商业账号：未实现、未伪造、不纳入真实通过项、需要公开协议或用户账号授权、否（不纳入本 change）"；
- **冲突**：PI 分析推测 WorkBuddy 内部行为（"appears to be"），但 parity-matrix 已明确把私有能力排除；推测结论与排除结论并存。
- **后果**：如果 PI 集成团队基于推测实现 inspiration / 团队 / 技能 / marketplace，可能会与 WorkBuddy 实际体验不匹配，或侵犯 WorkBuddy 私有实现的版权 / 商业秘密。

### 6.6 专家 / 技能 / 连接器缓存与路由语义

- **PI 立场**：`pi-capability-gap-analysis.md:232-243` §2.8 "agents_list / get / save / delete / template — Port → `~/.pi/agent/agents/*.md`"；`pi-core-capabilities.md:625-639` §16 Settings `agents: []` 数组；`pi-extension-architecture.md:62-92` "Profile packages can also use Pi's native package contract"。
- **Expert Team Design 立场**：`expert-team-design.md:94-117` §1.5.3 "场景不是 banner，而是路由配置"、§1.5.4 "专家、技能、连接器和缓存分层"、§3 G1-G13 差距矩阵：场景化首页与技能推荐栏（G1+G2）、置顶会话与工作空间分组（G3+G11+G12）、同事面板提升为左栏 + WorkBuddy 风格精修（G4+G13）、团队成员语义化 + 实时进度（G5+G6）、Subagent 配置硬拦截（G7+G8）、团队回看与 preset（G9+G10）。
- **冲突**：PI 分析把 expert / skill / connector 简化为 "扁平 markdown 文件 + SKILL.md"，expert-team-design 把它们展开为 4 层缓存（本地目录 / Marketplace / 路由配置 / 工作空间） + 13 类差距 + 场景化首页 + 实时进度。
- **后果**：如果 PI 集成团队认为"agents/*.md + SKILL.md 已落地 = expert / skill / connector 完成"，则缓存分层、路由配置、场景化首页、实时进度都会被跳过，导致 OpenBuddy 在 WorkBuddy 风格上仍然有明显 UX 缺口（`WORKBUDDY_UI_REFERENCE.md` 列 8 个待完善项中至少 5 个与 expert/skill/connector 相关）。

### 6.7 Casdoor Provider & WeChat/SMS

- **PI 立场**：0 处出现 "WeChat / SMS / OAuth Provider"。
- **Casdoor 立场**：`casdoor-enterprise-auth.md:18-25` 列 5 类 Casdoor Provider（微信开放平台 / 微信公众号 / 阿里云短信 / 腾讯云短信 / GitHub OAuth / Google OIDC / 邮箱验证码），`README.md:358-380` 列 7 个 Provider 模板与 import script。
- **冲突**：PI 集成假设"BYOK + AuthStorage"足够，但实际上中国市场的微信开放平台、微信公众号、阿里云短信、腾讯云短信是必要入口，海外市场的 GitHub OAuth / Google OIDC 也是必要入口。
- **后果**：PI 集成在中国 / 海外市场的用户获取会被 Casdoor Provider 缺失阻塞。

### 6.8 月度 / 财务 / 退款 / 过期流水

- **PI 立场**：0 处出现 "billing order / refund / expire / financial / 财务"。
- **Commercial 立场**：`openbuddy-commercial-model.md:69-94` §3 套餐和钱包 / `workbuddy-points-system-comparison.md:11-15` 注册即得免费 `额度`、过期失效 / 退款、过期流水、对账、自动降级。
- **冲突**：PI 集成假设"个人付费 = BYOK"，但企业付费涉及财务系统的支付回调、税费、汇率、退款、过期、对账、生产发布门禁（`openbuddy-commercial-model.md:124-144`）。
- **后果**：PI 集成让 enterprise SKU 用户无法使用——他们需要 Group + 共享钱包 + 模型白名单 + 每日预算 + 财务对账 + SLA，PI 分析完全未涉及。

---

## 7. 改造建议（针对 PI 分析本身如何补充产品视角）

以下建议针对 PI 分析文档族（不下结论改源文件，仅给出补充章节建议）。每条建议都给出：补充目标 / 章节草案 / 关联引用。

### 7.1 在每份 PI 文档开头增加 "Product Anchors" 小节

- **目标**：让读者在 30 秒内知道"这份文档对应 OpenBuddy 产品的哪个用户场景"。
- **草案**：
  ```markdown
  ## Product Anchors
  - 用户角色：[个人 / 团队成员 / 团队 admin / 企业 admin / 企业销售]
  - 用户场景：[首次开通 / 首次对话 / 邀请同事 / 配置 PI 模型 / 完成计费 / 完成续费 / 反馈问题]
  - 依赖的产品子系统：[Casdoor / Resource Gateway / New API / Pi AgentSession / Cordis / Electron Main / Renderer]
  - 不在本文档范围：[列出本文档明确不解决的产品问题]
  ```
- **关联引用**：`README.md:299-358`（已有产品子系统清单），`expert-team-design.md:1-200`（已有用户场景分类）。

### 7.2 在 `pi-capability-gap-analysis.md` 增加 "Capability × Product Value" 双轴表

- **目标**：把"Pi 提供能力"映射到"OpenBuddy 用户价值"。
- **草案**：每个 capability 增加 3 列：(a) 用户场景（哪类用户在哪种流程下使用）；(b) 价值主张（用户用这个能力完成什么）；(c) 验收指标（NPS / retention / conversion / 月活）。
- **关联引用**：`workbuddy-points-system-comparison.md:11-20`（已有 WorkBuddy 行为 → OpenBuddy 一致性表），`expert-team-design.md:269-336`（已有 G1-G13 差距矩阵）。

### 7.3 在 `pi-core-capabilities.md` 拆分 "What Pi provides" 与 "What OpenBuddy layers on"

- **目标**：避免"Pi 能做 = OpenBuddy 能做"的混淆。
- **草案**：每个 capability 章节末尾强制两个段落：① "What Pi provides natively"（纯上游）；② "What OpenBuddy layers on"（OpenBuddy 自己的 UX / 商业 / 企业包装）；并明确标注哪些包装是必须的、哪些是 nice-to-have、哪些尚未实现。
- **关联引用**：`workbuddy-parity-matrix.md:7-22`（已有 OpenBuddy 当前实现 vs 真实验证 vs 限制/缺口列）。

### 7.4 在 `pi-openbuddy-completeness-audit.md` 增加 "Product-side Verification" 子矩阵

- **目标**：补充 PI 集成未涉及的产品 / 商业 / 企业 / UX 维度验收。
- **草案**：在已有 IPC/Pi-event/MiniMax smoke 之外，增加：(a) UX smoke（首次开通到首次成功的 5 步流程）；(b) 商业 smoke（free → team → enterprise SKU 转换）；(c) 企业 smoke（Casdoor OIDC → 共享钱包 → 模型 allowlist → kill switch）；(d) 跨平台 smoke（Mac/Win/Linux 三平台 Electron 启动）；(e) 长会话 smoke（>100 turn 的 Pi session）。
- **关联引用**：`brief.md:35-77`（已有 A1-A15 acceptance examples，但全部是 IPC / Pi-event 维度），`storage-architecture-audit.md:172-189`（已有 5 个失败场景）。

### 7.5 在 `pi-runtime-next-roadmap.md` 增加 "Product Risks" 与 "上游风险" 章节

- **目标**：从"工程风险"扩展到"产品 / 市场 / 上游依赖"风险。
- **草案**：(a) Pi 上游 breaking change 风险（v0.84+ → 2026+ 迭代速度，license 稳定性，团队稳定性）；(b) WorkBuddy 私有能力不可伪造风险；(c) Casdoor / Resource Gateway / New API 同步上线风险；(d) Mac/Win/Linux 三平台 parity 风险；(e) long-tail Pi extension 兼容性风险（已识别但未跟踪的 50+ community package）。
- **关联引用**：`pi-capability-gap-analysis.md:444`（已有 Pi breaking changes 风险，但只有技术维度）。

### 7.6 在每份 PI 文档结尾增加 "Non-claims" 章节

- **目标**：明确声明本文档不承诺什么。
- **草案**：
  ```markdown
  ## Non-claims
  - 本文不承诺 OpenBuddy 已具备完整 WorkBuddy 风格 UX（参考 WORKBUDDY_UI_REFERENCE.md 待完善项）
  - 本文不承诺 OpenBuddy 已具备企业级 RBAC / 租户治理（参考 casdoor-enterprise-auth.md）
  - 本文不承诺 OpenBuddy 已具备商业计费 / 钱包 / SKU（参考 openbuddy-commercial-model.md）
  - 本文不承诺 OpenBuddy 已具备分布式协作（参考 distributed-buddy-network-architecture.md）
  - 本文不承诺 Pi 上游无 breaking change 风险
  ```
- **关联引用**：`brief.md:21-31`（已有 Non-goals，但只覆盖工程边界）。

### 7.7 在 `pi-extension-architecture.md` 增加 "Non-Pi Subsystems Map"

- **目标**：让读者清楚"哪些子系统不依赖 Pi"。
- **草案**：画一张表，列出 Casdoor / Resource Gateway / New API / SQLite (openbuddy-storage) / Cordis / DeepSeek Harness / WorkBuddy Renderer / Electron Main / IPC 等子系统，标注每个子系统的事实源、权威文档、与 Pi 的关系（依赖 / 不依赖 / 可选）。
- **关联引用**：`storage-architecture-audit.md:5-21`（已有分层架构），`distributed-buddy-network-architecture.md:6-40`（已有统一对象模型）。

### 7.8 在 `pi-sdk-implementation-plan.md` Milestone matrix 增加 "Product Milestone" 列

- **目标**：让工程 milestone 与产品 milestone 对齐。
- **草案**：每行 LUM-37 ~ LUM-49 额外列出：(a) 关联的 WorkBuddy 能力；(b) 关联的产品子系统（Casdoor/Resource Gateway/New API 等）；(c) 关联的 UX 改进（WORKBUDDY_UI_REFERENCE.md 待完善项）；(d) 商业 / 企业 readiness 信号。
- **关联引用**：`workbuddy-parity-matrix.md:7-22`（已有 WorkBuddy 能力 vs OpenBuddy 当前实现）。

### 7.9 治理建议：brief.md 必须包含具体内容，不允许空模板

- **目标**：避免 `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` 这种空模板成为正式 brief。
- **草案**：在 `docs/comet/changes/` 下增加 CI / pre-commit 检查：brief.md 任一章节为空时拒绝提交。
- **关联引用**：`docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` 全文仅 9 个空标题 vs `docs/comet/changes/openbuddy-electron-pi-closure/brief.md` 79 行具体内容。

### 7.10 治理建议：所有 PI 分析文档必须引用 README + WORKBUDDY_UI_REFERENCE + parity-matrix

- **目标**：让 PI 分析始终以"产品定位 + UI 参考 + 能力对标"为外部参照系。
- **草案**：每份 PI 文档开头增加 "External References" 段，列出 3 个外部参照文档（README 商业定位、WORKBUDDY_UI_REFERENCE UI 清单、workbuddy-parity-matrix 能力对照）。
- **关联引用**：`README.md:299-358`、`WORKBUDDY_UI_REFERENCE.md:1-130`、`workbuddy-parity-matrix.md:1-50`。

---

## 8. 证据索引

### 8.1 PI 分析文档族

| 文件 | 行数 | 关键章节 | 关键引用行号 |
|---|---|---|---|
| `docs/pi-capability-gap-analysis.md` | 441 | §1 Pi capability inventory；§2 OpenBuddy 映射表；§3 Gap summary；§4 Reuse opportunities；§5 Risk re-rating | line 1-15 (goal)；111 (xAI irony)；127-178 (sessions)；179-227 (providers)；229 (inspiration appears to be)；232-243 (§2.8-§2.10)；407-441 (reuse + net result)；434-444 (risk re-rating) |
| `docs/pi-core-capabilities.md` | 970 | §1 Agent session lifecycle；§2 Event types；§3 Session storage；§4 Providers；§5 Built-in tools；§6 Extensions API；§7 MCP；§8 Permissions；§9 Skills；§10 Slash commands；§11 Subagents；§12 Web search；§13 Plan mode；§14 Auth & account；§15 ModelRegistry；§16 Settings；§17 ACP/RPC fallback；§18 Community extensions；§19 What's NOT in Pi；§20 Net result；§21 References | line 1-8 (opening)；42-56 (AgentSession methods)；127-178 (session storage)；179-227 (providers)；261-270 (BYOK isolation disappears)；272-310 (4 built-in tools)；313-420 (ExtensionAPI)；469-538 (Permissions)；543-617 (Skills)；621-687 (Slash commands)；689-732 (Subagents + community)；749-815 (Auth & account)；859-867 (Settings)；879-895 (ACP/RPC fallback)；897-925 (community extensions)；927-948 (what's NOT in Pi)；949-957 (Net result) |
| `docs/pi-extension-architecture.md` | 308 | ## Decision；## Capability boundaries；## Built-ins；## Ecosystem review；## Loading and lifecycle rules；## Dynamic loading semantics；## Unified inventory；## Provider registration；## Recommended adoption order | line 3-7 (Decision)；38-72 (Dynamic reload contract)；72-92 (Unified package contract)；106-150 (Capability boundaries + Compatibility levels)；169-192 (Adapter projection inventory)；205-262 (Loading and lifecycle rules)；282-296 (Unified readiness observation / Unified cross-surface plugin snapshot)；298-307 (Recommended adoption order) |
| `docs/pi-openbuddy-completeness-audit.md` | 754 | ## 总体结论；## 验收矩阵；## 已知的产品限制；## 重新验证命令；## 在 profile 中启用适配投影；## Slash 命令 UI 投影标记；## dsh-commands；## pi-todo；## pi-automation；## pi-folder-trust；## pi-inspiration；## pi-notification；## pi-session；## pi-fs；## 本轮进度 (×40+)；## 当前实现进度；## 后续执行计划 | line 29-72 (总体结论)；74-97 (验收矩阵)；133-138 (已知产品限制)；140-162 (重新验证命令)；165-188 (profile 启用)；194-275 (12 适配投影)；282-302 (Pi JSONL 冷恢复)；304-322 (typed RPC)；326-334 (双向交互 RPC)；336-358 (Renderer generation)；358-366 (Pi JSONL compaction)；368-392 (ConnectionController)；394-410 (Harness session baseline)；426-440 (Pi 扩展加载机制)；442-458 (Harness `since` + cursor-gap)；472-481 (Cursor 持久化)；482-490 (Cursor SSE)；491-501 (Renderer Harness transport)；503-509 (真实 Harness carrier)；510-515 (双会话去重)；516-522 (Pi 自动发现)；523-529 (短时 Electron smoke)；530-548 (当前实现进度)；549-557 (后续执行计划)；558-660 (统一 RPC + Typert Remote + 插件管理)；668-696 (Harness jobs)；696-712 (Typert provider declaration)；712-728 (dsh-agent-instructions/presets)；728-738 (terminal 三层)；738-744 (subprocess/sandbox)；744-754 (published execution package) |
| `docs/pi-real-plugin-compatibility.md` | 67 | ## 已验证插件；## 重复执行；## 插件加载结论；## 后续优先级 | line 7-22 (6 包验证)；23-35 (执行命令)；37-50 (加载结论)；52-67 (后续优先级) |
| `docs/pi-runtime-next-roadmap.md` | 112 | ## 结论；## P0；## P1；## P2；## P3；## 暂不做；## 完成定义 | line 5-23 (结论)；25-37 (P0 Pi 会话边界)；39-65 (P1 统一五面插件状态)；67-86 (P2 Harness 可靠性)；88-94 (P3 真实验收)；97-103 (暂不做)；105-112 (完成定义) |
| `docs/pi-sdk-implementation-plan.md` | 319 | ## Why SDK embed；## Key APIs；## Architecture；## Phased rollout；## Test strategy；## Open decisions | line 1-9 (status/approach)；11-26 (SDK vs RPC tradeoffs)；28-78 (Key APIs)；80-150 (Architecture + Phase 0-1)；150-240 (Phase 2-4)；248-262 (Milestone matrix LUM-37~49)；264-273 (Test strategy)；275-283 (Open decisions) |
| `docs/migration-pi-electron.md` | 222 | ## Goal；## Why this pairing；## Component mapping；## Phased rollout；## Phase 0/1/2/3/4；## Risks | line 5-15 (§1 Goal)；17-27 (§2 Why this pairing)；29-65 (§3 Component mapping 3.1/3.2/3.3)；67-89 (§4 Phased rollout + Phase 0)；90-130 (§5 Phase 1/2)；131-205 (§6 Phase 3/4 + 7.x Why SDK + 7.4 In-process agent + 7.5 Team tools + 7.6 Patch surface)；206-222 (§8 References) |
| `docs/full-pluginization-plan.md` | 289 | ## DeepSeek Harness 关键架构模式；## 借鉴到 OpenBuddy；## 执行计划；## 不做；## 风险；## 验证清单；## 参考资料 | line 1-10 (title + LUM-37)；12-90 (DeepSeek Harness 五件套 + 包结构 + bundle 叠 + dispatch mode + 模型可见)；92-200 (借鉴到 OpenBuddy 当前 vs 目标 + 30+ 包布局 + Service class 模板)；202-225 (24 commits 执行计划)；227-235 (§4 不做)；237-249 (§5 风险 + §6 验证清单)；251-289 (参考资料) |
| `docs/comet/changes/openbuddy-electron-pi-closure/brief.md` | 79 | ## Outcome；## Scope；## Non-goals；## Acceptance examples；## Constraints and invariants；## Decisions；## Open questions；## Verification expectations | line 7-13 (Outcome)；15-30 (Scope)；21-31 (Non-goals)；35-77 (A1-A15 acceptance)；79-95 (Constraints)；97-110 (Decisions)；111-115 (Open questions)；117-126 (Verification) |
| `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` | 9 | 同上 9 个标题 | line 1-9（全文仅标题，无内容） |

### 8.2 比较基线文档

| 文件 | 行数 | 关键引用 |
|---|---|---|
| `docs/storage-architecture-audit.md` | ~700 | line 5-21 (执行摘要)；23-56 (证据与方法)；57-80 (存储清单)；81-140 (目标架构 + 关系模型)；141-189 (迁移和回滚)；189-203 (安全、备份、运维)；215-231 (LegacySourcePreflight)；246-260 (实施顺序) |
| `docs/distributed-buddy-network-architecture.md` | ~800 | line 6-40 (目标 + 统一对象模型)；41-100 (产品与 UI)；101-130 (参考设计吸收与边界)；170-198 (4 Phase)；200-268 (验证与边界 + Renderer contribution contract)；268-310 (Main-owned A2A + MCP capability + Relay 授权) |
| `docs/casdoor-enterprise-auth.md` | ~1200 | line 1-65 (OpenBuddy 用户入口 + Casdoor 应用)；66-110 (配置 + Login)；111-130 (Permission)；131-160 (组织角色权限)；161-220 (能力矩阵 + 多租户)；221-280 (Refresh + WeChat/SMS)；281-410 (Webhook + 后续 Tier A/B/C + 推进原则) |
| `docs/openbuddy-commercial-model.md` | 144 | line 1-66 (权威边界 + 计费公式)；67-94 (套餐和钱包)；95-105 (New API 集成)；105-122 (商业审计和上线门禁)；124-144 (剩余工作 P0/P1/P2 + 账期结算) |
| `docs/workbuddy-parity-matrix.md` | ~50 | line 7-22 (9 行能力表)；23-30 (主链路证据)；31-37 (仍需明确边界) |
| `docs/workbuddy-points-system-comparison.md` | ~150 | line 1-10 (心智模型)；11-20 (WorkBuddy 行为 → OpenBuddy 映射)；21-30 (刻意不同的地方)；31-40 (仍未实现或需外部资源)；41-50 (推荐落地路径)；51-60 (度量与监控) |
| `docs/expert-team-design.md` | ~460 | line 1-200 (当前实现 + WorkBuddy 实际配置证据)；200-260 (WorkBuddy 对标)；269-336 (差距矩阵 G1-G13)；340-348 (WorkBuddy 私有能力限制)；350-360 (技术风险)；365-460 (迁移设计) |
| `WORKBUDDY_UI_REFERENCE.md` | 130 | line 1-50 (整体布局 + 基础组件 + 布局组件 + 业务组件)；51-90 (CSS 设计令牌 + 关键页面 + Composer)；108-116 (对齐清单 已完成 ✅ vs 待完善 📝) |
| `README.md` | ~430 | line 25-130 (产品定位 + 特性 + WorkBuddy 对比)；240-280 (代码架构)；290-380 (Enterprise & Commercialization 12 panels + Multi-tenant + Token commerce + Production deployment + Casdoor Provider templates + Observability)；380-430 (测试覆盖 + 路线图 + 致谢) |

### 8.3 文档时点与归属

- 4 份 PI 分析核心文档（`pi-capability-gap-analysis.md`、`pi-core-capabilities.md`、`pi-extension-architecture.md`、`pi-sdk-implementation-plan.md`）的更新时间集中在 2026-08-26 ~ 08-30，主要跟踪 issue 是 LUM-37（Pi Electron 迁移主线）。
- `pi-runtime-next-roadmap.md`、`pi-real-plugin-compatibility.md`、`pi-openbuddy-completeness-audit.md` 更新时间为 2026-08-29 ~ 08-31，是后续阶段产出。
- `migration-pi-electron.md` 状态 "Phase 0 / design freeze"，目标分支 `agent/chong/pi-electron-*`。
- `full-pluginization-plan.md` 跟踪 issue LUM-37 终极目标，分支 `agent/chong/full-pluginization`。
- `docs/comet/changes/openbuddy-electron-pi-closure/brief.md` 是 `openbuddy-electron-pi-closure` 变更的 brief（79 行具体内容）。
- `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` 是本次审计对应的 brief（仅空标题 9 行）。

### 8.4 自承的剩余边界

PI 分析本身已经明确承认的剩余边界（注意：这些边界几乎全部是技术边界，不是产品 / 商业 / 企业边界）：

- `pi-openbuddy-completeness-audit.md:543` "第三方外部能力矩阵：真实 MCP server、connector、远程 marketplace、平台通知和真实第三方 Pi extension 仍需各自配置后验证；本轮只验证仓库内可观察的本地能力与 fixture 分支。"
- `pi-openbuddy-completeness-audit.md:544` "DeepSeek Harness parity：只读 RPC 已具备跨 Renderer generation/HTTP 响应丢失安全恢复；仍需补齐跨 Main 重启的 durable resume token、完整 Typert gateway carrier、严格 wire schema/codegen、session-query compaction/recovery，以及 workspace authorization 快照与远端 transaction 的组合边界，不宣称替代 DeepSeek Harness 全部生态包。"
- `pi-openbuddy-completeness-audit.md:546` "第三方评测运行环境：Inspect-AI、DeepEval、Promptfoo、Langfuse 适配器已实现 fail-closed，但本机未安装对应依赖，因此本轮未单独执行这些框架命令；Node 统一 acceptance 已真实通过。"
- `pi-openbuddy-completeness-audit.md:732` "本轮仓库 production build 本轮仍受既有 `packages/capability/openbuddy-email/src/index.ts` 的 `EmailDraft | undefined` 类型错误阻塞，不归因于本轮执行底座改动。"
- `pi-openbuddy-completeness-audit.md:741` "下一步应优先增加真实 published package gated E2E，并明确 terminal/job 默认只恢复 metadata、不跨重启恢复旧进程。"
- `pi-openbuddy-completeness-audit.md:744` "仍未宣称完整 Harness parity：Windows 原生 PTY、Linux bubblewrap/Landlock 与真实 `dsh-sandbox-local` provider 的严格执行、完整 foreground process-group/readiness/spill/tree-quiescence 语义、真实 published subprocess/sandbox package E2E、terminal/job 跨 Electron 重启策略、第三方插件全量矩阵仍需继续完成。"

PI 分析未自承但本审计识别的盲点（产品 / 商业 / 企业 / 跨平台 / UX / 文档）：见 §4 的 12 类盲点。

---

## 9. 结论

PI 分析文档族是"Pi 集成工程的执行级记录"，不是"OpenBuddy 产品 / 企业的战略级审计"。它把"Pi 提供的能力"反复当作"OpenBuddy 获得的能力"（"What we get for free" 句式 9 次），把 LOC 净下降当作商业价值（"Net Rust LOC deleted: 14,237. That's the win."），把单 LLM MiniMax 五轮 smoke 当作产品验证（A1-A15 全部是 IPC / Pi event / MiniMax 维度）。

它与 storage-architecture-audit、distributed-buddy-network-architecture、casdoor-enterprise-auth、openbuddy-commercial-model、workbuddy-parity-matrix、workbuddy-points-system-comparison、expert-team-design 等已有产品 / 企业级分析存在 **8 类显式冲突**，其中最严重的是：

1. 数据权威性（PI JSONL vs SQLite catalog-first）；
2. 多租户治理（PI 完全无 Casdoor 章节）；
3. 商业计费（PI 完全无 points / wallet / SKU 章节）；
4. 分布式协作（PI 仅 1 段提及 collaboration 插件，distributed-buddy 是 4 Phase 事实源）；
5. WorkBuddy 私有能力（PI 假设可推测，parity-matrix 明确排除）；
6. 专家 / 技能 / 连接器缓存与路由语义（PI 假设扁平 markdown，expert-team-design 是 4 层缓存 + 13 类差距）；
7. Casdoor Provider（PI 0 处出现 WeChat / SMS / GitHub OAuth）；
8. 财务 / 退款 / 过期 / 对账（PI 0 处出现）。

PI 分析存在 **15 项错误假设或夸大承诺**，最严重的是：

- "Pi 集成完成 = OpenBuddy 可用"（PI 文档族核心叙事）；
- "BYOK 等于无平台风险"（忽略商业 SKU 强制）；
- "Net LOC 减少 = 商业价值"（LOC 是工程指标，不是用户价值）；
- "production build 通过"（同文档 732 行承认被 `EmailDraft | undefined` 阻塞）。

PI 分析存在 **12 类产品 / 商业 / 企业 / 跨平台 / UX / 文档 / 失败模式盲点**（§4），每类都引用具体行号与反证文档。

本审计未修改任何源文件；所有结论都可由 `docs/` 目录下的具体文档与行号复核。下一步建议：在每份 PI 文档开头增加 "Product Anchors" + "Non-claims" 段（§7），把 PI 集成从 "工程闭环" 升级为 "产品 / 企业 / UX 闭环"。
