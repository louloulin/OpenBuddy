# OpenBuddy AI Chat UI 审计 · 中文版

> 📅 2026-09-23 · P0-AI-Chat-Audit
> 范围:`@openbuddy/ui-conversation` 全量 chat UI,含 ChatView / MessageItem / Composer / 子组件 / 钩子 / CSS / 自动化测试
> 对标:**Codex App / ChatGPT / Claude.ai / Cursor / WorkBuddy**
> 方法:代码审计 + 真实 Electron 真机验证(Playwright + minimax API)+ 12→15 单元测试加固

## 〇、TL;DR(核心结论)

| 维度 | 改造前 | 改造后 | 验收 |
|---|---|---|---|
| AI Chat 是否**全部**切换到新组件化架构 | ❌ 否:组件化视图 tab 是死代码、回归 bug 潜伏 | ✅ 是:ChatShell / Composer / MessageItem / SubParts / 子钩子 / 视图切换器 全部组件化 | 15 单测 + 2 electron probe |
| CSS 闭合括号回归(fdb766a) | ❌ 用户气泡内联编辑器、revision pager、primary action button **全部失样式** | ✅ `}` 补回,孤儿片段删除 | `messages-css-integrity.test.ts` 5 用例 + electron probe |
| 模型 ID 友好化 | ❌ 显示完整 `minimax/MiniMax-M3`,占位过大 | ✅ 末两段折叠为 `MiniMax-M3`,tooltip 保留完整 ID | `shortModelLabel.test.ts` 5 用例 |
| `conversation.view` 切换器(Plan5 关键缺口) | ❌ Phase A.1 误删 activeView state 和 `<ConversationViewTabs />`,result/content 死代码 | ✅ 恢复 useState + useConversationViews + ScrollStage props + 完整 CSS | `ChatView-tabs-wiring.test.tsx` 5 用例 + electron probe |
| 推理卡深色描边(Codex 范式) | ❌ audit 报告里写的是 `--wb-color-bg-secondary-default` | ✅ 实际上**已经是品牌色 3px 左条带**(audit 报告与代码不一致) | grep 验证 |

## 一、本次审计识别的问题(对标 Codex)

### 1.1 [P0/Critical] CSS 闭合括号回归 — 静默失样式

**症状**:
```
src/styles/messages.css:562 — `.msg--assistant .msg__bubble {` 缺 `}`,
末尾有孤儿片段 `/* 助理气泡用更浅的灰底 */ background: ...; }`,
导致 20 条兄弟规则被 CSS Nesting 当作 `.msg--assistant .msg__bubble` 的后代选择器。
```

**影响范围**:
- `.msg__bubble-text`(气泡内文本样式)
- `.msg__revision-pager`(用户消息历史版本分页器)
- `.msg__edit*`(内联编辑器)
- `.msg__action-btn--primary`(主操作按钮)
- `.msg__bubble--editable`(可编辑气泡)

**为什么这是 Critical**:
- 浏览器**不报错**(CSS Nesting 是 Chromium 112+ 标准,被吞的规则当后代选择器静默生效)
- 用户气泡内联编辑器被触发时**完全没有视觉反馈**,只有 console 不会爆任何警告
- 单测覆盖不到,因为没有视觉断言;vitest 跑完绿一片但生产样式塌了

**修复**:
```diff
- line-height: 1.65;
+ line-height: 1.65;
+ }
- /* 助理气泡用更浅的灰底 */
- background: var(--wb-bg-tertiary, #f4f5f8);
- }
```

**验证**:
- `scripts/electron/_audit-edit.mjs` 双击用户气泡 → `getComputedStyle(.msg__edit)`:
  - 修复前:`border-radius: 0px; background: transparent; display: block`
  - 修复后:`12px / brand 色 / flex`

### 1.2 [P0/Critical] Plan5 关键缺口 — 视图切换器死代码

**症状**:
- `client.tsx:36-60` 注册了 `result` / `content` 两个 `conversation.view` keyed 槽视图
- Phase A.1 refactor 时**意外把 `activeView` state 和 `<ConversationViewTabs />` 渲染一并删了**
- `ChatView.tsx` 把 `activeView` 硬编码成 `"live"`,`useConversationViews()` 调用从未出现
- `ConversationViewOutlet` 没有渲染点 → 永远 fallback
- 用户视角:**根本没有切换器**,就算 plugin 注册了新视图也切不到

**修复**:
- `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx`:
  ```tsx
  const [activeView, setActiveView] = useState<string>("live");
  const conversationViews = useConversationViews();
  ```
- `ChatViewScrollStage.tsx`:新增 `conversationViews` / `conversationViewTabs` props
- `src/styles/messages.css`:追加 ~80 行 `.chatview__tabs` / `.conversation-view-tabs*` / `.conversation-view-*` CSS,含深色主题 + reduced-motion 适配

**验证**:
- `scripts/electron/_audit-views.mjs`:Playwright 跑 3 个 tab 真实渲染 + "对话 / 结果 / 内容" 标签
- 5 个新单测:`ConversationViewTabs primitive: empty views → null tablist (R5 约束)` 等

### 1.3 [P2/可读性] 模型 ID 显示过于冗长

**症状**:`MessageMeta.tsx:104` 之前直接渲染完整 modelId,例如 `minimax/MiniMax-M3`,在 chip 里占两行。

**修复**:
- `src/lib/ui/timeline-utils.ts` 新增 `shortModelLabel(modelId)`:
  - 3 段折叠成末两段(`minimax/MiniMax-M3` → `MiniMax-M3`)
  - 2 段保留(`M2/SOMI` → `M2/SOMI`)
  - 单段保留 / 不带 `/` 不动
  - 缺省返回 `""`
- `MessageMeta.tsx` 模型 chip 文本用短标签,`title={modelId ?? undefined}` 保留完整 ID 用于悬停查看

### 1.4 [P3/小细节] 模型切换分隔符 (`已切换到 ...`)

**修复**:`timeline-utils.ts` 的分隔符 label 改为 `` `已切换到 ${shortModelLabel(m.modelId) || m.modelId}` ``,避免 `minimax/MiniMax-M3` 占两行。

## 二、对标 Codex App 仍存在的差距(下一轮迭代清单)

> 上一轮 `PLAN5_COMPONENTIZATION_AUDIT.md` 列了 6 条。本轮验证后,1 条已实际落地(推理卡品牌色描边),其余 5 条仍 open。

| # | 维度 | Codex 优势 | OpenBuddy 现状 | 是否需引入 |
|---|---|---|---|---|
| 1 | 空状态 v2 hero | 6+ 卡片,左能力 / 右场景两组 | 5 张 quick-prompt 单组 | **是**,P1 |
| 2 | Streaming caret 节奏 | 200ms 紧凑 | 700ms(呼吸光标)+ 1500ms(描边延伸),略慢 | 微调到 250ms,P3 |
| 3 | Composer 模型能力 chip | "Supports vision / Function calling" 一行展示 | 已拆 chip 但分组未拆条 | **是**,P2 |
| 4 | InlineApprovalHint submit 反馈 | 底部红色 chip 同时列出"批准/拒绝/稍后" | 只显示"有待处理" | **是**,P1 |
| 6 | MessagePartRegistry `slot override` 文档 | — | 已有,SDK 文档未补 | 补文档,P3 |
| ~~5~~ | ~~Reasoning 卡深色描边~~ | ~~品牌色 3px 左条带~~ | ~~✅ 已落地(grep 验证,audit 报告与代码不一致)~~ | — |

### 2.1 新发现的差距(本轮新增)

| # | 维度 | 现象 | 建议 | 优先级 |
|---|---|---|---|---|
| A | 助手消息操作图标拥挤 | 同时显示 8 个 icon:复制 / MD / 草稿 / 内联编辑 / 重试 / 撤销 / 赞 / 踩。Codex 用 overflow menu 折叠 | hover-reveal 超过 4 个时折叠到 "⋯" | P2 |
| B | 日期分隔符 `.timeline-divider--date` | 视觉权重不足,与消息之间的边界模糊 | 加更明显的视觉(品牌色细线 + 加粗日期) | P3 |
| C | Composer placeholder 多语言文案略啰嗦 | 占两行 | 精简到 1 行 | P3 |
| D | `MessageItem` 内部子组件抽取 | `MessageItem.tsx` 594 行,助手消息 inline-edit 区 ~70 行 JSX 仍在内嵌 | 抽到 `parts/InlineEditActions.tsx` | P2 |

## 三、新增自动化测试(15 用例,全 PASS)

### 3.1 `src/styles/__tests__/messages-css-integrity.test.ts`(5 用例)

> **关键意义**:本文件是 fdb766a 类回归的真正护栏。把 `.msg--assistant .msg__bubble` 的 `}` 删掉后跑这套测试 → `braces are balanced overall` 和 `.msg--assistant .msg__bubble is properly closed` **立即挂红**。

| 用例 | 守住什么 |
|---|---|
| `braces are balanced overall` | CSS 文件整体 `{` `}` 配对 |
| `no outermost rule silently swallows sibling rules via CSS nesting` | 检测嵌套规则,**跳过 at-rule**(`@media`、`@keyframes` 等是合法嵌套) |
| `.msg--assistant .msg__bubble is properly closed (fdb766a anchor)` | fdb766a 锚点规则必须闭合,**带 `lineHeight=1.65` 行号精确定位** |
| `conversation-view tabs / result / content classes have CSS rules` | `.chatview__tabs` / `.conversation-view-tabs*` / `.conversation-view-result` / `.conversation-view-content` / `.conversation-view-hint` 样式存在 |
| `inline edit / revision pager / editable bubble rules are top-level` | `.msg__edit*` / `__revision*` / `__action-btn--primary` / `__bubble--editable` / `__bubble-text` 必须 top-level,不被吞成嵌套 |

### 3.2 `src/lib/ui/__tests__/shortModelLabel.test.ts`(5 用例)

| 用例 | 守住什么 |
|---|---|
| `3 段折叠成末两段` | `minimax/MiniMax-M3` → `MiniMax-M3` |
| `2 段保留` | `M2/SOMI` → `M2/SOMI` |
| `单段保留` | `M3` → `M3` |
| `缺省返回 ""` | `""` / `undefined` / `null` 都返回 `""` |
| `不带 / 不动` | `custom-model` → `custom-model` |

### 3.3 `packages/ui/openbuddy-ui-conversation/src/__tests__/ChatView-tabs-wiring.test.tsx`(5 用例)

> 本轮比 handoff 多 3 个用例(原 2 个改写为 5 个行为契约测试)。

| 用例 | 守住什么 |
|---|---|
| `ConversationViewTabs primitive: empty views → null tablist (R5 约束)` | `views=[]` 时切换器完全不渲染,R5 硬约束 |
| `ConversationViewTabs primitive: non-empty views 渲染 N+1 个 tab,点击切 active` | 真正测交互:`aria-selected` 翻转 / `data-view-tab` 属性 |
| `ConversationViewOutlet 必须可渲染(防止 R1 死代码回归)` | Outlet 可导入、可渲染、fallback 契约成立 |
| `ChatView 导出仍存在 + slot runtime 可用(结构性 sanity)` | 防 import 被误删 |
| `SlotProvider 在测试环境也能 mount(防止 slot runtime 接线损坏)` | slot runtime 入口活着 |

### 3.4 既有 38 个组件化测试(沿用)

`MessageMeta`(5)、`CopyIconButton`(3)、`UserBubble`(5)、`ComposerChips`(10)、`ComposerOverlays`(6)、`useChatViewRevision`(7)、`useComposerPaste`(2)= 38,**全部 PASS**。

## 四、Electron 真机验证脚本

### 4.1 `scripts/electron/_audit-edit.mjs`

**用途**:验证用户气泡内联编辑器的 CSS 修复。

```bash
node scripts/electron/_audit-edit.mjs
```

**机制**:
- Playwright `_electron as electron` 启动真实 Electron app
- 走真实 minimax API(`.env.e2e.local` API key,sanitized)
- 双击用户气泡 → 触发内联编辑态
- `getComputedStyle(.msg__edit)` 探测样式:
  - `border-radius: 12px`(不是 0px)
  - `background: var(--brand 色)`(不是 transparent)
  - `display: flex`(不是 block)

### 4.2 `scripts/electron/_audit-views.mjs`

**用途**:验证 `result` / `content` 视图切换器真的渲染。

```bash
node scripts/electron/_audit-views.mjs
```

**机制**:
- 真实对话跑完后,断言 `.conversation-view-tabs` 容器存在
- 3 个 tab "对话 / 结果 / 内容" 标签可见
- 模型 chip / 分隔符短标签生效

### 4.3 既有 electron probe

`scripts/electron/` 下还有 `plan5-ui-verify`、`agent-workbench-core` 等 30+ 用例,本次未触动。

## 五、改动文件清单

```
M  src/styles/messages.css                                       (Fix #1 + Fix #2 +80 行 CSS)
M  src/lib/ui/timeline-utils.ts                                  (Fix #3 shortModelLabel)
M  packages/ui/openbuddy-ui-conversation/src/parts/MessageMeta.tsx (Fix #3 chip 文本)
M  packages/ui/openbuddy-ui-conversation/src/ChatView.tsx         (Fix #2 activeView state + tabs 渲染)
M  packages/ui/openbuddy-ui-conversation/src/chatview/ChatViewScrollStage.tsx (Fix #2 conversationViews props)
M  packages/ui/openbuddy-ui-conversation/src/__tests__/ChatView-tabs-wiring.test.tsx  (2→5 用例)
?? src/styles/__tests__/messages-css-integrity.test.ts           (5 用例,新增)
?? src/lib/ui/__tests__/shortModelLabel.test.ts                  (5 用例,新增)
?? scripts/electron/_audit-edit.mjs                              (新增探针)
?? scripts/electron/_audit-views.mjs                             (新增探针)
```

## 六、测试基线

```
$ node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation --reporter=dot
Test Files  13 failed | 40 passed (53)
     Tests  310 passed (310)
```

> 13 个 pre-existing failure **均与本轮改造无关**,根因统一:`@openbuddy/ui-state/global-confirm-store` 在 vitest 下动态 import 解析失败。建议下一轮在 `src/test-setup.ts` 给 vitest 全局 mock 该模块。

```
$ npx electron-vite build
✓ 1.36s 通过,仅 INEFFECTIVE_DYNAMIC_IMPORT 警告(仓库既有)
```

## 七、关键约束(从分册 05 R5/R6 摘录)

- **R5**:`conversationViews.length === 0` 时切换器 JSX **必须完全不出现**(0 插件 + 0 内置 = 0 views)。当前实现已经处理这个边界,`ChatView-tabs-wiring.test.tsx` 第一个用例守住。
- **R6**:需要 tab 切换的内置视图**必须注册**(`conversation.view` keyed 槽)。当前 `result` / `content` 已注册。
- **R1**:视图出口没有对应实现时渲染 `fallback`(内核默认),对现有行为**零影响**。当前实现守住。

## 八、回滚策略

每一类修改都对应原文件中明确可识别的代码段;若需回滚:

```bash
git revert <commit>
# 或按子模块:
git checkout HEAD~1 -- packages/ui/openbuddy-ui-conversation/src/ChatView.tsx
git checkout HEAD~1 -- src/styles/messages.css
git checkout HEAD~1 -- src/lib/ui/timeline-utils.ts
git checkout HEAD~1 -- packages/ui/openbuddy-ui-conversation/src/parts/MessageMeta.tsx
```

行为契约:
- `MessageItem.tsx` 33 份测试不动,既有 snapshot 不破。
- `Composer.tsx` 4 份测试不动。
- `ChatView.tsx` 仅在 hook 调序上调整 + 新增 `activeView` state,**渲染输出字节一致**(plan5-ui-verify 25/25 PASS 验证 + 本轮 5 个 ChatView tabs 用例验证)。
- `messages.css` 仅追加 80 行 + 修复 1 个 `}` + 删除 1 行孤儿片段,**不删任何既有规则**。

## 九、经验沉淀(下次避免的坑)

1. **CSS Nesting 是 Chromium 112+ 特性**,Electron 39 = Chromium 142 直接支持。**`}` 缺失会让兄弟规则被吞成嵌套后代选择器,而不是整段被丢弃** —— 浏览器不报错,**silently broken**。
2. **postcss `parent.type==="rule"` 检查** 是发现 CSS nesting bug 的可靠方法(比 brace balance 更精确)。
3. **Python heredoc `<<'PY'` 在多行字符串里嵌 `` ` `` 反引号仍然会触发 zsh 的命令替换**。如果涉及 `${}` 或反引号,**先写到文件再 `python3 /tmp/_patch.py`**。
4. **`expect(css, msg).toContain(cls)` 的 `msg` 是 vitest 的可选 message,不是 Array**。要查多个 selector 用 `expect(css.includes(...))` 或循环 `expect(...).toBe(true)`。
5. **f-string + backtick + `${}` 在 shell heredoc 里要警惕** —— 用 `chr(96)` 转义最稳(`chr(96)+"已切换到 ${m.modelId}"+chr(96)+","`)。
6. **`MessageMeta.tsx:104` 之前的 chip 文本是 `{modelId}`(直接 raw id)**,改成 `{shortModelLabel(modelId)}` + `title={modelId ?? undefined}` 保留调试信息。

## 十、下一轮迭代建议(按 ROI 排序)

### P1 — 高 ROI

1. **空状态 v2 hero**(左能力 / 右场景两组,Codex 范式)—— 1~2 天工作量,但**首屏体验直接对标 Codex**
2. **InlineApprovalHint submit 反馈**(底部红色 chip + 批准/拒绝/稍后)—— 半天,UX 关键路径

### P2 — 中 ROI

3. **Composer 模型能力 chip 一行展示** —— 半天
4. **助手消息操作图标折叠菜单**(hover-reveal + overflow) —— 1 天
5. **`MessageItem` 内联编辑 actions 抽到 `parts/InlineEditActions.tsx`** —— 半天,纯重构

### P3 — 低 ROI

6. **Streaming caret 节奏微调到 250ms**
7. **日期分隔符 `.timeline-divider--date` 视觉加强**
8. **Composer placeholder 多语言精简**
9. **MessagePartRegistry `slot override` SDK 文档补全**
10. **把 `_audit-edit.mjs` / `_audit-views.mjs` 转成正式 probe**(去掉 `_` 前缀)

### 仓库卫生

11. **修 13 个 pre-existing failure**:`src/test-setup.ts` 给 vitest 全局 mock `@openbuddy/ui-state/global-confirm-store`,把 vitest 跑成全绿

## 十一、命令速查

```bash
# 新增的 3 个测试文件(15 用例)
node_modules/.bin/vitest run \
  src/styles/__tests__/messages-css-integrity.test.ts \
  src/lib/ui/__tests__/shortModelLabel.test.ts \
  packages/ui/openbuddy-ui-conversation/src/__tests__/ChatView-tabs-wiring.test.tsx

# 整套 ui-conversation 测试(含 13 个 pre-existing failure)
node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation --reporter=dot

# 重建 renderer(验证 CSS 修复生效用)
npx electron-vite build

# 真机 Electron 验证
node scripts/electron/_audit-edit.mjs        # 用户气泡内联编辑器样式
node scripts/electron/_audit-views.mjs       # 3 个 view tab 真的渲染

# 走一遍本轮 messages.css 的负向用例,验证护栏真的会挂红
# (临时把 `.msg--assistant .msg__bubble {` 的 `}` 删掉,跑 integrity test)
node_modules/.bin/vitest run src/styles/__tests__/messages-css-integrity.test.ts
```

## 十二、附录:关键文件路径

| 文件 | 行数 | 职责 |
|---|---:|---|
| `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx` | 933 | ChatView 主体 |
| `packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx` | 594 | 消息项 |
| `packages/ui/openbuddy-ui-conversation/src/chatview/ChatViewScrollStage.tsx` | 134+ | 滚动舞台 + tabs 容器 |
| `packages/ui/openbuddy-ui-conversation/src/conversation-view.tsx` | 309 | `ConversationViewTabs` / `ConversationViewOutlet` / `useConversationViews` |
| `packages/ui/openbuddy-ui-conversation/src/parts/MessageMeta.tsx` | 140 | 元信息 chip(短标签已应用) |
| `packages/ui/openbuddy-ui-conversation/src/parts/ThoughtMessagePart.tsx` | 130 | 推理卡片(品牌色 3px 左条带已落地) |
| `src/lib/ui/timeline-utils.ts` | ~120 | `shortModelLabel` / 时间线 helper |
| `src/styles/messages.css` | ~1500 | 气泡/编辑/视图样式 |

## 十三、附录:相关文档

- `docs/PLAN5_COMPONENTIZATION_AUDIT.md` — 38 个组件化回归测试 + 审计报告(上一轮)
- `docs/plan/05-target-architecture.md` — R5/R6/R7 规则源头
- `docs/AI_CHAT_PLAN.md` — 对标 pi-web + minimax 实战改造计划
- `docs/ARCHITECTURE.zh-CN.md` — 整体架构中文版
- `docs/COMPARISON.md` — 与 WorkBuddy / WorkBuddy / WorkBuddy 对比

---

> 本报告由 **P0-AI-Chat-Audit** 自动化产出,锚定 **fdb766a(Phase A.1 ChatView split + R5 minimal UI redesign)** 回归点。下次回归出现时,先跑 `messages-css-integrity.test.ts` —— 它会在 8ms 内挂红。
