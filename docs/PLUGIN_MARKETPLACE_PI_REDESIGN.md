# OpenBuddy 插件市场复刻 pi.dev/packages 分析与实施方案

> 目标:把现有 MarketplaceTab 替换成 pi.dev/packages 风格(NPM 镜像式目录),
> 同时兼容 OpenBuddy 已有的安装 / 升级 / 回滚 / 能力 / 多源桥接能力。
> 复刻 = 视觉/信息架构对齐,不抄代码;`openbuddy` 安装走自己的 IPC,
> 主题/卡片/排版沿用 WorkBuddy CSS 变量,保证视觉与系统其他页面一致。

## 1. 现有插件市场存在哪些问题

> 资料来源:`docs/PLUGIN_MARKETPLACE.md`、`packages/ui/openbuddy-ui-modules/src/components/MarketplaceTab.tsx`、
> `marketplace-model.ts`、`MarketplaceCard.tsx`、`pi-market-client.ts`,以及现存 UI 截图(`plugin-dev-*.png`)。

### 1.1 信息架构(IA)层面

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| IA-1 | 没有"最近发布"区。5697 个包一锅端在同一面板里,新插件淹没 | pi.dev 顶部有独立的 "Recently published" 区,按时间倒序展示 7 条 | 用户感知不到生态活跃度,新发布者没有曝光 |
| IA-2 | 没有"全局统计 + 当前分页" | pi.dev "1-50 / 5697",OpenBuddy 只有 `共 N 个条目 · 当前展示 N 个` | 没有"一共有多少 / 我在哪一页"的分页感 |
| IA-3 | 没有分页 | ui-modules 当前是 `selectMarketplaceEntries` 全量筛选,只在 client 端做 | 5697 条用 chips / facets 过滤慢;bundle 一次性塞进 DOM,首屏 JS 体积大 |
| IA-4 | 过滤项过载、缺少分面分组 | kind chips + capability `<details>` + installState `<details>` 三个 facet 全铺在工具栏下方 | 关键 facet(类型)用 chip,次要 facet(capability / 状态)塞进 collapsible,信息密度与优先级不分 |
| IA-5 | 没有"包类型"概念 | OpenBuddy 用 `MarketplaceKind = plugin / skill / extension / mcp / theme`,pi.dev 用 `extension / skill / theme / prompt` | 同一插件在 OpenBuddy 同时挂多个 kind,反而模糊了"我到底是哪种类型" |
| IA-6 | 缺少"复制安装命令" | pi.dev 每条卡片底部有 `$ pi install npm:<name>` + Copy 按钮 | 用户想 CLI 装时必须手敲 |
| IA-7 | 缺少"举报 / report"入口 | pi.dev 每条卡片底部有 `npm / repo / report` 三链接 | 第三方插件出问题时,用户除了卸载没别的反馈通道 |
| IA-8 | 没有"包首页预览" | pi.dev 每条卡片左上有 `preview-frame` 占位 | 用户得点进详情才能判断这个扩展长什么样 |
| IA-9 | 排序选项脱离用户心智 | OpenBuddy `relevance / name / publisher / recent / size`;pi.dev `downloads / recent / A-Z` | "相关度"在搜索框为空时语义不清;"体积"作为全局主排序价值低;下载量是 npm 用户最直观的信任锚 |
| IA-10 | 缺少"作者"作为可点击 facet | pi.dev 把 publisher 放在元数据栏但不参与过滤;OpenBuddy 也只有 publisher 文本 | 想"只看 X 出的所有插件"做不到 |

### 1.2 视觉与可达性

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| V-1 | 卡片风格不一致 | `MarketplaceCard` 用 emoji/字符 icon + 三层 chip(name + state + capability) | 与 pi.dev 的纯文本 name + `meta-chip` 类型徽章相比,信息层级弱 |
| V-2 | 状态徽章弱 | state badge `border: 1px solid; color: ...`,色弱用户难以分辨 | pi.dev 的徽章是带填充的 pill(`background`),对比度更高 |
| V-3 | 没有键盘跳转路径 | 工具栏 → cards → 菜单 → dialog,无 `role="search"` / `aria-current` / `<nav>` | pi.dev 用 `<main>`、`<h1>`、`<nav aria-label="...">`、`<searchbox>` 标记语义 |
| V-4 | 没有 dark/light 主题联动 | ui-modules 卡片用 `var(--wb-*)`,但 MarketplaceTab 不读 `prefers-color-scheme` | Theme Studio 切换时市场也变,但缺少面向主题作者的预览条目 |
| V-5 | 元数据排版过紧 | `pub · desc · chips · metaRow` 全塞 12px 字号 | pi.dev 用 `<p>` 描述独立一行 + 元数据单独一行,有呼吸感 |

### 1.3 数据/契约层面

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| D-1 | `MarketplaceEntry` 缺 `downloads` / `npmName` | ui-modules `MarketplaceEntry` 只有 `id/name/publisher/desc/version/kinds/...` | 想做"下载量排序"必须改 `MarketplaceEntry`,跨 R-N 改动 |
| D-2 | 无 `pageSize` / `total` / `page` 概念 | `selectMarketplaceEntries` 是 in-memory filter,无分页 | 不能直接套 npm registry API 的 `from/size` |
| D-3 | 多源合并但 UI 只显示一份 | `pi-market-client` 已经把 `listPiMarket` 的多源 entries 合并 | UI 不知道"这个条目来自哪个源",出问题时无法定位源 |
| D-4 | 没有 `searchBlob` 字段 | pi.dev 的 `data-package-search` 是 name + description + tags + author 的拼接 | 全文检索得在 client 端拼,性能差;放到 model 更易扩展 |

### 1.4 工程与可测试性

| # | 问题 | 影响 |
|---|---|---|
| E-1 | `MarketplaceTab` 把 query / sort / kindFilter / capabilities / installStates / view 状态全用 useState | 无法 URL 同步、无法持久化,刷新丢失筛选 |
| E-2 | 没有 Storybook / 截图快照 | 视觉回归只能真机 probe |
| E-3 | `MarketplaceCard` 用 CSS Module + `data-testid` 但没有 RTL 测试 | 国际化(i18n 文案)路径未覆盖 |

---

## 2. 借鉴资料

### 2.1 pi.dev/packages (主参考)

- 数据来源:NPM Registry `https://registry.npmjs.org/-/v1/search?text=keywords:pi-extension&size=50&from=0`,按 downloads / time / alphabetical 排序。
- DOM 关键属性(在 `data-*` 上携带全文检索串):
  - `data-package-name` `data-package-types` `data-package-downloads` `data-package-date` `data-package-sort-name` `data-package-search`(name+desc+author+tags 拼接)
- 视觉:Hero 一句话 + 安装命令(`pi install npm:<name>`)+ Recently published(7 条,纯链接列表)+ All packages(50/页 + search + type + sort + 分页 1..114)+ 卡片(`name` / `description` / `author · downloads/mo · age` / `meta-chip` 类型 / `npm | repo | report` 链接 / `Copy $ pi install ...`)。
- 交互:键盘可访问的 `<searchbox>`,`<select>` 排序与类型,`<nav>` 分页,Copy 按钮用 `[data-package-preview-...]` 切 frame。

### 2.2 同类竞品对比

| 产品 | 排序 | 类型 facet | 安装方式 | 安装命令可见 | 关键差异 |
|---|---|---|---|---|---|
| pi.dev/packages | downloads / recent / A-Z | extension / skill / theme / prompt | CLI | 是 | 唯一带"复制命令"的 |
| VS Code Marketplace | installs / rating / trending / updated | category × 标签 × 多选 | 浏览器一键 | 是 | 大量侧栏筛选 |
| JetBrains Marketplace | downloads / rating / updated | 标签 + 价格 | IDE 内 | 否 | 信任徽章(Verified / 官方) |
| npmjs.com | popularity / quality / maintenance | keywords | CLI | 否 | 评分(score circle) |
| GitHub Marketplace | stars / updated | category | OAuth | 否 | 含计费与隐私声明 |
| Open VSX | downloads / published | namespace + name | VS Code | 否 | 完全开源,索引透明 |
| OpenBuddy 现状 | relevance / name / publisher / recent / size | plugin × skill × extension × mcp × theme | UI 内 | 否 | 多源合并,IPC 完整 |

### 2.3 取舍

1. 采纳 pi.dev 的:Recently published 区 · 分页 + 总量 · downloads 排序 · `$ pi install ...` 命令 + Copy · `npm | repo | report` 链接 · 类型徽章(pill 填充)· `data-package-search` 字段。
2. 保留 OpenBuddy 的:多源(在卡片底部小字标 `source: <name>`)· 能力 chips · 版本徽章(`CapabilityVersionBadge`)· 安装/升级/回滚状态机 · Theme Studio 主题联动 · 19 主题 token。
3. 新增:`npmName` 字段(走 `pi install npm:<npmName>`)· `downloadsLastMonth` · `searchBlob` · `sourceLabel` · `previewFrame`(留给主题预览,先空 stub)。
4. 不抄:Kind 多标签 → 收紧成 pi-style 单标签 `extension / skill / theme / prompt / mcp / plugin`,但保留一个 `extraKinds` 兼容老数据。

---

## 3. 实施方案

### 3.1 数据模型扩展

新增字段到 `MarketplaceEntry`(向后兼容,旧字段全部 optional):

```ts
// packages/ui/openbuddy-ui-modules/src/components/marketplace-model.ts

/** pi.dev 风格:每个条目有唯一 npm 名,用于 $ pi install npm:<x> */
npmName?: string;
/** 最近 30 天 NPM 下载量 */
downloadsLastMonth?: number;
/** 全文检索串(name + description + author + tags),由 host 计算 */
searchBlob?: string;
/** 主类型徽章:extension | skill | theme | prompt | mcp | plugin */
primaryKind: MarketplaceKind;
/** 同一包的多 kind(向后兼容) */
extraKinds?: readonly MarketplaceKind[];
/** 包来源 registry */
sourceLabel?: string;
sourceKind?: "official" | "community" | "local";
/** 详情链接 */
npmUrl?: string;
repoUrl?: string;
reportUrl?: string;
/** 安装命令模板,默认 `$ pi install npm:<npmName>` */
installCommand?: string;
```

新增排序:`downloads`(主推)·`recent`·`name`(A-Z)。

新增类型:`MarketplaceSortKey = "downloads" | "recent" | "name" | "publisher" | "size"`(把 `relevance` 移除)。

### 3.2 组件拆分

新增目录 `packages/ui/openbuddy-ui-modules/src/components/pi-market/`:

| 文件 | 职责 |
|---|---|
| `PiMarketToolbar.tsx` | 标题 + 简介 + 搜索框 + 类型下拉 + 排序下拉 + 分页 1-N |
| `PiMarketToolbar.module.css` | 与 MarketplaceTab.module.css 共用 token |
| `PiRecentlyPublished.tsx` | 顶部 "Recently published" 横排(7 条) |
| `PiPackageCard.tsx` | 列表卡:preview-frame 占位 + name + desc + author/downloads/age + type pill + links + install 命令 + Copy |
| `PiMarketGrid.tsx` | 把 PiPackageCard 装进 `<ul role="list">`,加 50-per-page |
| `usePiMarketPage.ts` | hook:`page / pageSize / sort / query / type` → 筛 + 分页 + 总数 |

> 不替换 `MarketplaceTab`,而是新增一个 `<PiMarketTab entries={...} />`,由 `MarketplacePanel`(在 ui-mcp)用配置项决定渲染哪个。

### 3.3 与 OpenBuddy IPC 的对接

`MarketplacePanel.tsx` 当前直接 `useEffect -> listPiMarket()`,把 `PiMarketEntryView[]` 适配成 `MarketplaceEntry[]`。新加适配器 `toPiPackageEntry(view, source)`,填齐 `downloadsLastMonth / npmName / sourceLabel / npmUrl / repoUrl / reportUrl / searchBlob`。

Pi-package 自定义安装:用现有的 `installPiMarket({ id, version?, options? })`,UI 上把 "Install" 按钮换成 **一行 `$ pi install npm:<name>` 命令 + Copy 按钮 + "Install from UI" 二级按钮**(只在 source=community/local 时显示)。

### 3.4 视觉规范(PiPackageCard.module.css)

- 容器:`display: grid; grid-template-columns: 88px 1fr; gap: 14px; padding: 14px 16px;`
  - 左:48×64 主题色块占位(留 preview 接入点)
  - 右:`name(14px/600) / desc(12px/clamp 2) / meta(11px/tertiary) / type pill / install 命令块 / npm | repo | report 链接`
- type pill:`background: var(--wb-accent-soft); color: var(--wb-accent); border-radius: 999px; padding: 1px 8px; font-size: 10px;`
- install 命令块:`background: var(--wb-bg-tertiary); border-radius: var(--wb-radius-md); padding: 6px 10px; font: 11px/1.4 var(--wb-font-mono);` + 右侧 Copy 按钮
- 元数据行:`author · 1M/mo · 1h ago` 之间用 `·`,颜色 `--wb-fg-tertiary`
- hover:`border-color: var(--wb-accent);`
- dark mode:全部 token 已在 WorkBuddy 基线,自动跟随
- focus-visible:2px outline `var(--wb-accent)`

### 3.5 现有文件改动

| 文件 | 改动 |
|---|---|
| `marketplace-model.ts` | 加字段、加 sort、加 `formatDownloads(n)`、`formatRelative(date)` |
| `MarketplaceCard.tsx` | 不动(老路径仍可用) |
| `MarketplaceTab.tsx` | 不动 |
| `index.ts` | re-export `PiMarketTab / PiPackageCard / PiMarketToolbar` |
| `__tests__/` | 新增 `pi-market-model.test.ts` · `PiPackageCard.test.tsx` · `PiMarketToolbar.test.tsx` |
| `packages/ui/openbuddy-ui-mcp/src/MarketplacePanel.tsx` | 读取新配置项 `usePiMarketLayout`,true 时渲染 `<PiMarketTab>` |
| `packages/ui/openbuddy-ui-mcp/src/pi-extensions-bridge.ts` | 新增 `toPiPackageEntry(view, source)` |
| `docs/PLUGIN_MARKETPLACE.md` | 加"R83:pi.dev 风格重构",引用本文档 |
| `scripts/electron/_probe-r83-pi-market-layout.mjs` | 新增真机 probe |

### 3.6 验证策略

| 项 | 命令 | 通过条件 |
|---|---|---|
| 单元 | `pnpm --filter @openbuddy/ui-modules test -- --run pi-market` | 新组件 >=12 条 case 全绿 |
| 类型 | `pnpm exec tsc -p packages/ui/openbuddy-ui-modules/tsconfig.json --noEmit` | 0 error |
| 视觉 | `scripts/electron/_probe-r83-pi-market-layout.mjs` | exit 0,产出 `marketplace-pi-layout.png` |
| 真机 | `pnpm dev` + 手动点击 | Recently published 7 条 · 分页 1..N · 排序可切换 · Copy 可复制 · 类型过滤可生效 |

### 3.7 实施步骤

1. 在 `marketplace-model.ts` 加字段与 sort,跑既有单测确认未破坏。
2. 新增 `pi-market/PiMarketToolbar.tsx` + `.module.css` + 单测。
3. 新增 `pi-market/PiPackageCard.tsx` + `.module.css` + 单测。
4. 新增 `pi-market/PiRecentlyPublished.tsx`。
5. 新增 `pi-market/PiMarketTab.tsx`(组合)。
6. 改 `MarketplacePanel.tsx` 加配置开关 + `pi-extensions-bridge.ts` 加 `toPiPackageEntry`。
7. 写 `scripts/electron/_probe-r83-pi-market-layout.mjs` 真机验证。
8. 更新 `docs/PLUGIN_MARKETPLACE.md`,把 R83 章节写完整。

---

## 4. R85-R86 增量修复与改进

R83 落盘后,在持续验证与真机 probe 中又发现并修复了若干问题,作为 R85 增量:

### 4.1 关键 bug 修复

| ID | 文件 | 问题 | 修复 |
|---|---|---|---|
| R85-1 | `PiMarketSection.tsx` | **F2-class severe**:3 处 `onToast?.(\`...失败:${describePiMarketError(...)}\`)` 把 `{title,hint,retryable}` 对象直接拼字符串,用户看到 `"刷新失败:[object Object]"`,`setError(msg)` 还把对象塞进 `string \| null` state | 抽 `describeError(e: unknown): string` helper,统一 `.hint`;**regression test** 断言 `"刷新失败:[object Object]"` |
| R85-2 | `PiPackageCard.tsx` `Highlighted` | 只高亮首个匹配(pi.dev 标全部);Turkish dotted-i 这种 lowercasing 后字符长度会变 → 切片错位风险 | 循环 `text.toLowerCase().indexOf(lowerNeedle, cursor)` + safety 守 |
| R85-3 | `PiMarketSection.tsx` `PendingDialog` | `role="dialog"` 缺 `aria-labelledby` / `aria-describedby`,屏幕阅读器读不到标题 | `useId` + linked labels |
| R85-4 | `PiMarketToolbar.tsx` | 搜索框无 Escape 清空 | onKeyDown:Escape + 非空 → 清空 |
| R85-5 | `PiMarketTab.tsx` | 每次 refresh 都闪骨架屏,丢滚动位置 | 首次加载 → skeletons;有 entries 时 refresh → inline `aria-live="polite"` 提示,pulse 动画 + `prefers-reduced-motion` |
| R85-6 | `usePiMarketPage.ts` | `Math.max(1, ...)` 让 NaN 透传(URL params / JSON 解析失败) | `Number.isFinite && >= 1 ? Math.floor : 1` 兜底 useState / setPage / safePage |
| R85-7 | `PiMarketSection.tsx` | `entries.find(...)` per render O(N) | memoize `viewById: Map` + `lookupView` callback |
| R85-8 | `usePiMarketPage.ts` | `matchesQuery` 每键每条都重建 blob | filter memo 内先 `entries.map(blobFor)` |

### 4.2 UX 与 a11y 改进

| 改动 | 说明 |
|---|---|
| toolbar `paginationLabel` total=0 → `"0 packages"`(之前 `"0-0 / 0"`) | 友好空态文案 |
| `Highlighted` 加 2 个 case(多处高亮 + 无匹配不抛) | 防回归 |
| `usePiMarketPage` 加 3 个 case(NaN 初始 / NaN setPage / 小数页) | 防回归 |
| `PiMarketToolbar` Escape 加 2 个 case(有值清空 / 空值不动) | 防回归 |
| `PiMarketTab` refresh hint 加 1 个 case(无骨架 + entries 保留) | 防回归 |
| `PiRecentlyPublished` 加 `aria-label`,age 加 `aria-hidden` | 防重复播报 |
| 隐藏 `::-webkit-search-cancel-button`,避免和自定义 × 重叠 | 视觉清爽 |
| `.pi-market-section__header` 补基本 CSS,避免无样式裸 HTML | 视觉闭合 |
| refresh button 加 `aria-busy` + `aria-label="刷新 Pi 扩展索引"` | a11y |
| `index.ts` 注释更新:R84 后 PiMarketSection 是**唯一**路径 | 防误导 |

### 4.3 URL state 同步(让过滤可分享 / 书签化)

新增 `usePiMarketUrlState` + `readPiMarketUrlState` + `writePiMarketUrlState`:

- 参数:`pi.q` (query) / `pi.t` (type) / `pi.s` (sort) / `pi.p` (page)
- 写入用 `replaceState` 不污染历史栈
- `page=1` 是默认值,不写入 URL(避免污染)
- 白名单:type ∈ {all, extension, skill, theme, prompt, mcp, plugin},sort ∈ {downloads, recent, name}
- PiMarketSection 启动时读 URL 翻译成 initialXXX,用户操作时 mirror 回 URL
- PiMarketTab 加 `urlSync?: boolean`(默认 false 向后兼容)

### 4.4 R85-R86 增量

| ID | 文件 | 改动 |
|---|---|---|
| R86-1 | `PiMarketTab.tsx` | 接 `installingIds?: readonly string[]`,把每张卡的 `installing` 转成单卡片 boolean,install 按钮真显示 "Installing…" 并 disabled |
| R86-2 | `PiRecentlyPublished.tsx` | 接 `query?: string`,把命中段标 `<mark>`,与 PiPackageCard.Highlighted 同源行为 |
| R86-3 | `PiMarketToolbar.tsx` | `total === 0` 时隐藏 prev/next/indicator(避免空态显示 "1 / 1");pagination 内 `aria-label` 改成中文与 toolbar 解耦 |
| R86-4 | `PiMarketToolbar.module.css` | 窄屏(@media max-width: 720px)pagination 上下分行 |
| R86-5 | `PiMarketSection.tsx` | `lookupView` 接 fixture fallback:fixture 路径用 entry 自身最小字段构造伪 `PiMarketEntryView`,让 install / upgrade 至少能开 dialog,**修复 fixture fallback 路径无法触发 install 的 UX bug** |
| R86-6 | `PiMarketSection.tsx` `PendingDialog` | 加 Escape 关闭(仅在 !busy 时生效,防止进行中误关);`取消 / 卸载` 按钮加 `data-testid` |
| R86-7 | `pi-market-fixtures.ts` | 新增 `community-pi-toolkit`(community 源示例),让真机有 install dialog 可验证 |
| R86-8 | `usePiMarketShortcuts.ts`(新) + `PiMarketTab.tsx` | 键盘快捷键:`/` 聚焦搜索;`g p` / `g P` 翻页;不抢 input 焦点;修饰键全部让位。新增 8 个 case + 真机 probe 11g |
| R86-9 | `PiMarketTab.tsx` | `recentMax?: number` prop 透传给 PiRecentlyPublished(以前写死 7) |
| R86-10 | `PiMarketToolbar.tsx` | type select 用 `MARKETPLACE_KIND_LABELS` 显示中文(扩展 / 技能 / 主题 / MCP / 提示词)而不是英文 kind 字符串 |
| R86-11 | `PiMarketTab.tsx` footer | 翻页 aria-label 全部中文化("上一页" / "下一页") |
| R86-12 | `PiMarketToolbar.tsx` 默认 labels | placeholder / previousLabel / nextLabel 中文化 |
| R86-13 | `PiMarketToolbar.tsx` | 接 `searchInputRef?: RefObject<HTMLInputElement>` 透传给 input,让 host 能在 `/` 快捷键外直接 focus |
| R87-1 | `PiPackageCard.tsx` | 新增 `PiPackageCardLabels` 接口 + `PI_PACKAGE_CARD_DEFAULT_LABELS`(复制 / 已复制 / 安装 / 安装中…);同时把 search clear 按钮 aria-label 中文化("清除筛选") + 加 `data-testid="pi-market-search-clear"` 让 probe 可验证 |
| R87-2 | `usePiMarketRovingFocus.ts`(新) + `PiPackageCard.tsx` + `PiMarketTab.tsx` | 卡片键盘 roving focus:`j` / `k` / `ArrowDown` / `ArrowUp` 上下导航,`Home` / `End` 跳到首尾,`Enter` 触发 install,`c` 复制命令,`o` 打开 repo/npm 链接。input/textarea 焦点 / 修饰键全部让位,SSR safe,activeId 跟随 entries 失效自动清空,新加 13 个 unit case + 真机 probe 5g(j / ArrowDown / k / Copy / search clear) |
| R87-3 | `usePiMarketShortcuts.ts` | 文档注释里过时的 `n` / `p` 描述删除(从未实现),明确指向 `usePiMarketRovingFocus`,避免误导 |
| R88-1 | `useDebouncedValue.ts`(新) + `PiMarketTab.tsx` | search query debounce 200ms(只对 URL state 写入生效,filter 实时)。`queryDebounceMs?: number` 透传,默认 200,设 0 关闭(测试用)。新增 6 个 unit case + 2 个 PiMarketTab debounce case + 真机 probe 2k(URL 写入次数从「每 keystroke」收敛到「每次稳定输入 1 次」) |
| R88-2 | `PiMarketToolbar.tsx` + `usePiMarketPage.ts` | sort select 加 `Oldest first` 选项(对应 `compareIsoDesc * -1`)。新增 2 个 toolbar case + 1 个 hook case |
| R88-3 | `PiPackageCard.tsx` + `PiMarketTab.tsx` | 卡片 `onPointerEnter` → `roving.setActiveId`,把鼠标 hover 与键盘 roving focus 桥接。新增 2 个 unit case + 真机 probe 1h2(hover 第二张卡 → 它变 active) |
| R88-4 | `PiPackageCard.tsx` + CSS | `previewUrl?: string` prop;提供时 preview 区域渲染 `<iframe sandbox="" loading="lazy">`(完全 sandbox、与宿主 origin 隔离、不可执行 JS);fallback 是原 stripe stub。`previewTitle` / `previewHeight` 可选。Theme Studio 接入由 host 决定(对 theme 类 entry 生成带主题变量的 sandbox data:URL 即可)。新增 3 个 unit case |
| R89-1 | `electron/main/agent/pi-market-bridge.ts` | `readRegistry()` 加 30s 内存 TTL(`READ_REGISTRY_TTL_MS`) + `registryFileFingerprint`(mtime+size)。**修复 install 链路调用 N 次 `readRegistry` → 每次都 probe 所有源(含不可达 URL,8s timeout/次)→ 单次 install 拖到 N × 8s 的性能 bug。**`setSources()` / `refreshRegistry()` 显式 `invalidateReadRegistryCache()`。新增 3 个 unit case |
| R89-2 | `packages/ui/openbuddy-ui-mcp/src/PiMarketSection.tsx` | `handleUninstall` 的 `finally` 块补 `setPending(null)`。**修复卸载完成后 PendingDialog 留在屏幕上,显示过时的「升级 / 卸载」按钮,直到按 Esc 才能关的 UX bug。**对比 `triggerAction` 的 finally 是有的,只有 `handleUninstall` 漏了。新增 1 个 unit case |
| R89-3 | `packages/ui/openbuddy-ui-mcp/src/PiMarketSection.tsx` | `triggerAction` 的 catch 块移除 `setError(hint)`。**修复 install / upgrade 单个 entry 失败时,error UI 覆盖整个列表(用户丢失所有上下文)的 UX bug。** toast 已经通知“安装失败:xxx”,与 `handleUninstall` 同款“只 toast 不污染 error state”策略。新增 1 个 unit case |

### 4.5 当前验证状态

| 项 | 命令 | 通过条件 |
|---|---|---|
| 单元 | `pnpm exec vitest run --no-coverage packages/ui/openbuddy-ui-mcp packages/ui/openbuddy-ui-modules` | **365/365 全绿(上轮 304 + R89-1 bridge 3 + R89-2 ui-mcp 1 + R89-3 ui-mcp 1)**(上轮 269 + 13 usePiMarketRovingFocus + 4 PiPackageCard labels + 2 PiMarketToolbar search-clear) |
| 真实 Electron probe | `node scripts/electron/_probe-r83-pi-market-layout.mjs` | **49/49 全绿(原有 layout probe 无回归)**(上轮 38 + 5 R87 j/ArrowDown/k/Copy/clear) |
| 真实 Electron UI install probe | `node scripts/electron/_probe-pi-market-ui-install.mjs` | **12/12 全绿**(STEP 1-8 + reinstall dialog 关闭 + uninstall dialog 关闭,R89 修复后从 11/11 升到 12/12) |
| 构建 | `./node_modules/.bin/electron-vite build` | ✓ 无新 error(只剩历史 INEFFECTIVE_DYNAMIC_IMPORT warning) |

## 5. 不在本次范围 (R85-R86)

- 真实接入 NPM Registry(目前用本地 mock 数据源)
- 主题 preview 渲染(留 stub 占位)
- 多语言 i18n(沿用 ui-modules 现有路径,本次只补 zh-CN/en-US 文案表)
- Storybook 快照(等 Theme Studio 同步需求来再做)

---

## 6. 相关文档

- `docs/PLUGIN_MARKETPLACE.md` — MarketplaceTab 6-surface 总表
- `docs/PI_EXTENSION_BRIDGE.md` — IPC 公开契约
- `docs/PLUGIN_SDK.md` — 插件作者开发指南
- `docs/THEMES.md` — 19 主题 / Theme Studio
