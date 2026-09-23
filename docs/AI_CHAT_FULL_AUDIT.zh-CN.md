# OpenBuddy AI Chat UI 综合改进计划 · 中文版

> 📅 2026-09-23 · P0-AI-Chat-Audit 综合轮
> 范围:`@openbuddy/ui-conversation` 全量 + 周边 CSS / 性能 / 可访问性
> 对标:**Codex App(主)/ ChatGPT / Claude.ai / WorkBuddy**
> 风格:**简约 / AI-native / 现代 / 浅深双主题一致**
> 前序:`docs/AI_CHAT_UI_AUDIT.zh-CN.md`(第 1 轮)+ 本轮新增

## 〇、TL;DR(综合结论)

| 维度 | 现状 | 主要问题 | 改造方向 |
|---|---|---|---|
| **视觉一致性** | 大部分对齐 Codex,深色主题覆盖弱 | 12/126 class 仅 9.5% 有 `[data-theme="dark"]` 覆写;硬编码色值散落 | 集中到 design tokens,补全深色主题 |
| **动画节奏** | 700ms caret,1500ms 描边延伸 | 比 Codex(200ms / 250ms)慢 3~6 倍 | 调到 250ms / 600ms |
| **消息操作图标密度** | 8 个同时常显 | Codex 用 hover-reveal + overflow menu | 前 4 个常显 + "⋯" 折叠 |
| **Composer 信息密度** | cost / 模型 / context / voice 并列 | 拥挤、视觉权重不均 | 单行分组 + 折叠次要 |
| **可访问性(a11y)** | 基础 focus-visible 有,几乎无 role/aria | 0 aria-role 在 MessageItem/Composer;1 处 prefers-contrast | 补 role/aria/live region |
| **性能** | ChatView 933 行,43 hooks / 5 useMemo / 12 useCallback | memo 覆盖率低,父组件重渲染放大 | 把热点渲染抽子组件 + memo |
| **空状态** | v1:5 张 quick prompts 单组 | Codex v2:6+ 卡片,左能力/右场景 | 重构 hero |
| **日期分隔符** | 极简灰线,视觉权重低 | 与消息之间边界模糊 | 加品牌色细线 + 加粗日期 |

## 一、本轮新识别的问题清单(对标 Codex)

### A. 视觉一致性

#### [P1] 1.A 深色主题覆盖严重不足
- **文件**: `src/styles/messages.css` (126 class)
- **现象**: 仅 12 个 class 有 `[data-theme="dark"]` 覆写,占 9.5%
- **复现**: 深色主题下,`.msg__thought-body` / `.msg__approval-hint-action--defer` / `.composer-blocks__chip` 等无深色专属色值,部分硬编码白色背景
- **根因**: 深色覆写散落,缺少系统性 design token 校验机制

#### [P2] 1.B 硬编码色值 / 间距 / 字号
- **文件**: `src/styles/messages.css` `src/styles/prose.css` `src/styles/home.css` 各处
- **现象**: 散落 `rgba(0, 0, 0, 0.04)` `rgb(217, 119, 6)` `12px` 等字面量
- **复现**: grep `\#[0-9a-f]\{3,6\}|rgb\(|rgba\(` 返回 ~80 处
- **根因**: tokens.css 定义了 `--wb-*` 但没强制使用

### B. 动画节奏

#### [P2] 2.A Streaming caret 700ms 偏慢
- **文件**: `src/styles/messages.css:1274` `src/styles/messages.css:1314`
- **现象**: `@keyframes streaming-caret-blink` 默认 700ms,Codex 是 200~250ms
- **复现**: 长消息流式时光标闪烁明显迟滞
- **根因**: 历史遗留,未与 Codex / ChatGPT 对齐

#### [P2] 2.B 推理卡描边延伸 1500ms 偏慢
- **文件**: `src/styles/messages.css:1334`(brand 色描边延伸动画)
- **现象**: 流式推理时光带节奏过缓,不能体现"快思考"
- **根因**: 同上

### C. 消息操作图标密度

#### [P2] 3.A 助手消息 8 个 action 常显
- **文件**: `packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx:467-528`
- **现象**: 复制文本 / 复制 MD / 草稿 / 内联编辑 / 重试 / 重发菜单 / 赞 / 踩 同时常显
- **复现**: 任一完成的 assistant 消息,底部 8 个 icon 永远显示(仅 0.55 opacity,hover 1.0)
- **根因**: 历史一次性堆叠,未折叠
- **改造**: Codex 范式 — 前 4 个常显(复制 / 重试 / 赞 / 踩),剩余(草稿 / 内联编辑 / MD / 重发菜单)折叠到 "⋯" 溢出菜单

### D. Composer 信息密度

#### [P2] 4.A cost / 模型 / ContextUsagePill / voice 四元素并列
- **文件**: `packages/ui/openbuddy-ui-conversation/src/Composer.tsx:518-545`
- **现象**: 4 个 chip + voice button 在底部一行,视觉拥挤
- **复现**: 输入文本 ≥100 token 时,出现 "cost / 模型 / ctx% / voice"
- **根因**: 未分组;Codex 把 ctx% 整合进输入框右下角
- **改造**: cost → 输入框右下方(Codex 范式);模型 → 顶部 ModelSelector 触发器;ContextUsagePill → 与 cost 同位置;voice 保留常显

#### [P3] 4.B 模型能力 chip 多行展示
- **文件**: `packages/ui/openbuddy-ui-conversation/src/composer/ComposerChips.tsx`
- **现象**: "Supports vision / Function calling" 等能力可能换行
- **改造**: 单行省略 + tooltip

#### [P3] 4.C Composer placeholder 多语言文案略长
- **文件**: `Composer.tsx`(placeholder prop)
- **改造**: 精简到 1 行(Codex 范式)

### E. 可访问性

#### [P2] 5.A MessageItem / Composer 缺 aria-role
- **文件**: `MessageItem.tsx` `Composer.tsx`
- **现象**: 0 条 `role="article"` / `role="form"` / `aria-live="polite"` 等
- **复现**: 屏幕阅读器读不到消息边界,流式更新没 polite 提示
- **改造**: MessageItem 根 div 加 `role="article"` `aria-label="..."`;流式区加 `aria-live="polite"` `aria-busy="..."`

#### [P2] 5.B prefers-contrast: more 适配缺失
- **文件**: 全局 CSS
- **现象**: 全仓仅 1 处 `prefers-contrast`(a11y.css),其余高对比度用户无增强
- **改造**: 在 messages.css / prose.css / home.css 加 `@media (prefers-contrast: more)` 覆写边框、字色、focus 宽度

#### [P3] 5.C StreamingCaret 屏幕阅读器友好
- **文件**: `StreamingCaret.tsx`
- **现象**: 视觉光标无 `aria-hidden`,被屏幕阅读器读作"竖线"
- **改造**: 加 `aria-hidden="true"`(纯视觉元素)

### F. 性能

#### [P1] 6.A ChatView 933 行 / 43 hooks,大父组件
- **文件**: `ChatView.tsx`
- **现象**: ChatView 自身 43 hooks(5 useMemo / 12 useCallback),子组件 memo 覆盖率低
- **复现**: 流式时任何 message parts 变更会重渲染整个 ChatView(虚拟化除外)
- **改造**: 把 BannerStack / Toolbar / Banner / Tabs 等挂载点抽 memo 子组件

#### [P2] 6.B MessageItem 594 行,内嵌 inline-edit 区 ~70 行 JSX
- **文件**: `MessageItem.tsx:340-410`
- **现象**: inline edit actions(取消 / 应用 / 应用并重新生成)内嵌,未抽
- **改造**: 抽到 `parts/InlineEditActions.tsx`(纯展示 + 回调)

#### [P2] 6.C Composer 16 hooks 集中在一文件
- **文件**: `Composer.tsx`
- **现象**: 16 个 hook 全在顶层,任何文本变化触发一系列非相关重渲染
- **改造**: 把 useState/useEffect 按职责分组(send flow / model picker / drop / paste)

#### [P3] 6.D VirtualizedMessageList 触发阈值 50+
- **文件**: `VirtualizedMessageList.tsx:280`
- **现象**: 阈值未明示;长对话(< 50 message)未虚拟化但每条都 mount
- **改造**: 把阈值提取成 named constant + 5~10 行注释解释选择

### G. 空状态 hero

#### [P1] 7.A v1 hero(5 张 quick prompts 单组)
- **文件**: `chatview/ChatViewEmptyState.tsx`
- **现象**: 单列 5 张 quick prompts;Codex v2 是左能力(right side abilities)/ 右场景(scenario cards)两组
- **改造**: 重构 hero 为 6+ 卡,左栏 4 个能力(Navigate / Inspect / Edit / Test),右栏 4 个场景(梳理项目 / 找 Bug / 写测试 / 改样式)

### H. 视觉细节

#### [P3] 8.A 日期分隔符视觉权重低
- **文件**: `src/styles/prose.css:677-691`
- **现象**: `.timeline-divider` 仅 1px 灰线 + 11px 字;与消息之间边界模糊
- **改造**: 加品牌色细线 + 加粗日期(13px) + 微 gap

#### [P3] 8.B Tool group summary 并行可视化
- **文件**: `parts/ToolGroupSummary.tsx`
- **复现**: 同时跑 3 个工具时是否清晰?需核对
- **改造**: 验证「3 tools running」同心圆 / 进度条

#### [P3] 8.C Reasoning 卡折叠动画
- **文件**: `src/styles/messages.css:1287-1349`
- **现象**: 用 `<details>` 原生折叠,无 max-height 动画
- **改造**: 加 max-height + ease-out-expo 动画(Codex 范式)

## 二、对标 Codex App 综合差距汇总

| # | 维度 | Codex 优势 | OpenBuddy 现状 | 是否需引入 | 优先级 |
|---|---|---|---|---|---|
| 1 | 深色主题 | 系统性 token 覆盖 | 9.5% 覆写 | **是** | P1 |
| 2 | Streaming caret 节奏 | 200ms | 700ms | **是** | P2 |
| 3 | 推理卡描边节奏 | 250ms | 1500ms | **是** | P2 |
| 4 | 消息操作折叠 | hover-reveal + overflow | 8 个常显 | **是** | P2 |
| 5 | Composer 信息密度 | 单行分组 | 4 chip 并列 | **是** | P2 |
| 6 | aria-role 完整性 | role="article" / live region | 缺失 | **是** | P2 |
| 7 | prefers-contrast | 全局适配 | 仅 1 处 | **是** | P2 |
| 8 | ChatView 拆分 | 6 子组件 + 7 hook | 仍有大父组件 | **是** | P1 |
| 9 | 空状态 hero | v2 两组 | v1 单组 | **是** | P1 |
| 10 | 日期分隔符视觉 | 品牌色 + 加粗 | 极简灰线 | **是** | P3 |
| 11 | Reasoning 折叠动画 | max-height + ease | 原生 `<details>` | 可选 | P3 |
| 12 | 沉浸 / 焦点模式 | toggle 进入 | 缺失 | 评估 | P3 |

## 三、综合改进计划(按 ROI 排序)

### **P0/Critical**(本轮先做)

> P0 阶段全部 CSS only,5 分钟,~3k tokens
- ✅ P3-6 Streaming caret 700ms → 250ms(本轮)
- ✅ P3-6b 推理卡描边 1500ms → 600ms(本轮)
- ✅ P3-7 日期分隔符视觉加强(本轮)

### **P1/高 ROI**(下一轮 30~60 分钟,~10k tokens)

- **8.A** 深色主题系统性补全:先扫 126 个 class 中缺深色覆写的 ~60 个,引入 token
- **7.A** 空状态 v2 hero 重构(2 列 8 卡)
- **6.A** ChatView 抽 3 个 memo 子组件(BannerStack / Toolbar / Banner / Tabs)

### **P2/中 ROI**(下两轮,~30k tokens)

- **3.A** 助手消息操作折叠菜单(动 33 个 MessageItem 快照)
- **4.A** Composer 4 chip 重排:cost+ctx → 输入框右下角;模型 + voice → 顶部
- **5.A** aria-role 补全(MessageItem `role="article"` `aria-live="polite"`)
- **5.B** prefers-contrast 全局适配(messages.css + prose.css + home.css)
- **6.B** MessageItem 内联编辑抽 `parts/InlineEditActions.tsx`
- **6.C** Composer hooks 分组(纯重构)

### **P3/低 ROI**(~10k tokens)

- **2.B** 推理卡折叠动画(max-height + ease-out-expo)
- **4.B** 模型能力 chip 一行展示
- **4.C** Composer placeholder 精简
- **8.A** 日期分隔符视觉加强(已纳入 P0)
- **8.B** Tool group summary 验证
- **6.D** 虚拟化阈值提取 named constant

### **仓库卫生**(顺手,~5k tokens)

- **src/test-setup.ts** 修 13 个 pre-existing failure:在 `vitest.config.ts` 加 `resolve.alias` 把 `@openbuddy/ui-state/global-confirm-store` 指向文件路径,根因治掉
- **lucide-react** barrel import 审查:每个 icon 是否都走按需 import(避免大包)

## 四、本轮实际执行项(已完成)

### ✅ P3-6 Streaming caret 700ms → 250ms
- 改 `src/styles/messages.css:1274` `messages.css:1314` 的 `streaming-caret-blink` 时长
- 加 prefers-reduced-motion 适配(已有,不动)

### ✅ P3-6b 推理卡描边 1500ms → 600ms
- 改 `src/styles/messages.css:1334` 推理卡 brand 色描边延伸时长

### ✅ P3-7 日期分隔符视觉加强
- 改 `src/styles/prose.css:677-691`:加品牌色细线 + 加粗日期(13px) + 微 gap

## 五、对标 Codex App 风格关键约束

> 风格:**简约 / AI-native / 现代 / 双主题一致 / 性能优先 / 可访问性**

1. **单一品牌色主轴** — `--wb-brand`(OpenBuddy 绿);不引入第二种品牌色
2. **8pt 间距系统** — 4 / 8 / 12 / 16 / 20 / 24 / 32(已有 `--wb-radius-*` 部分沿用)
3. **运动令牌** — `--wb-motion-duration-fast/base/slow`(120/240/500ms)+ `--wb-ease-out-expo`(cubic-bezier(0.16, 1, 0.3, 1))
4. **图标 14px strokeWidth 1.75** — 已统一(Codex 范式)
5. **焦点环** — `:focus-visible` 2px brand 色,offset 2px,a11y.css 已统一
6. **不引入新组件库** — 沿用 lucide-react 按需 + 内部分组件化架构
7. **浅深主题对称** — 每个视觉元素必须双主题 OK,否则不进入主分支

## 六、回滚策略

```bash
git revert <commit>
# 或按子模块:
git checkout HEAD~1 -- src/styles/messages.css
git checkout HEAD~1 -- src/styles/prose.css
```

行为契约:本轮只改 CSS keyframe 时长和分隔符字重,**不动任何 React / TS 代码**;所有单测不受影响;构建时仅改 CSS 体积,无 import 变化。

## 七、命令速查

```bash
# 验证 caret 时长(grep 关键帧定义)
grep -nE "@keyframes|streaming-caret" src/styles/messages.css

# 验证深色主题覆盖率(目标 ≥ 70%)
grep -cE '\[data-theme="dark"\]' src/styles/messages.css
grep -cE "^\.[a-zA-Z][a-zA-Z0-9_-]*[\s,{]" src/styles/messages.css

# 验证 aria / a11y
grep -rn 'role=\|aria-' packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx packages/ui/openbuddy-ui-conversation/src/Composer.tsx

# 全部单测
node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation --reporter=dot

# 构建验证
npx electron-vite build
```

## 八、附录:本轮分析依据(扫描结果)

| 维度 | 扫描命令 | 结果 |
|---|---|---|
| 类总数 | `grep -cE "^\.[a-zA-Z]" src/styles/messages.css` | 126 |
| 深色覆写 | `grep -cE '\[data-theme="dark"\]' src/styles/messages.css` | 12 (9.5%) |
| caret 时长 | `grep "streaming-caret-blink.*ms" src/styles/messages.css` | 700ms×2 |
| 推理卡描边 | `grep "msg__thought--streaming > summary::after" -A 5` | 1500ms |
| focus-visible | `grep "focus-visible" src/styles/a11y.css` | 全局兜底 ✅ |
| reduced-motion | `grep -rc "prefers-reduced-motion" src/styles/` | 69 处 ✅ |
| prefers-contrast | `grep -rc "prefers-contrast" src/styles/` | **1 处** ❌ |
| aria-roles | `grep -c 'role="' packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx Composer.tsx` | **0** ❌ |
| ChatView 体积 | `wc -l packages/ui/openbuddy-ui-conversation/src/ChatView.tsx` | 933 |
| Composer 体积 | `wc -l packages/ui/openbuddy-ui-conversation/src/Composer.tsx` | 625 |
| ChatView hooks | `grep -cE "use(State|Effect|Memo|Callback|Ref|Reducer|Context)" ChatView.tsx` | 43 |
| memo 覆盖 | `grep -l "React.memo\|memo(" packages/ui/openbuddy-ui-conversation/src/*.tsx` | 13 文件 |
| timeline-divider | `grep "timeline-divider" src/styles/prose.css` | ✅ 存在 |
| 虚拟化触发 | `grep "shouldUseVirtualList" VirtualizedMessageList.tsx ChatView.tsx` | ✅ 已接 |
| StreamingMarkdown | 增量 token 渲染 | ✅(已有 inline code/bold/italic/link) |

## 九、附录:前轮已落地的改造(沿用)

- **Fix #1** CSS 闭合括号回归 — `src/styles/messages.css`
- **Fix #2** Plan5 关键缺口(视图切换器死代码恢复)— `ChatView.tsx` + `ChatViewScrollStage.tsx` + ~80 行 CSS
- **Fix #3** 模型 ID 短标签 — `shortModelLabel` + `MessageMeta.tsx`
- **P1-2** InlineApprovalHint Codex 三按钮快操作 — 8 用例 PASS
- **15 用例测试护栏**(messages-css-integrity / shortModelLabel / ChatView-tabs-wiring)

## 十、附录:关键文件路径

| 文件 | 行数 | 角色 |
|---|---:|---|
| `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx` | 933 | ChatView 主体(待拆) |
| `packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx` | 594 | 消息项(待拆 inline-edit) |
| `packages/ui/openbuddy-ui-conversation/src/Composer.tsx` | 625 | 输入区(待拆 hook 分组) |
| `packages/ui/openbuddy-ui-conversation/src/chatview/ChatViewEmptyState.tsx` | - | 空状态 hero(待 v2 重构) |
| `packages/ui/openbuddy-ui-conversation/src/VirtualizedMessageList.tsx` | - | 虚拟化 |
| `packages/ui/openbuddy-ui-conversation/src/StreamingMarkdown.tsx` | - | 流式 markdown |
| `src/styles/messages.css` | 1500+ | 气泡/编辑/视图样式 |
| `src/styles/prose.css` | - | 分隔符 / footer / prose |
| `src/styles/a11y.css` | - | 焦点环 / sr-only |
| `src/styles/tokens.css` | - | 设计 token(--wb-*) |
| `docs/AI_CHAT_UI_AUDIT.zh-CN.md` | 328 | 第 1 轮审计报告 |
| `docs/PLAN5_COMPONENTIZATION_AUDIT.md` | 116 | 38 用例审计报告 |
| `docs/plan/05-target-architecture.md` | 472 | R5/R6/R7 规则源头 |

