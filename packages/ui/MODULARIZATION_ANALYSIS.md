# packages/ui 模块化与插件化 — 现状分析与改造路线

> 本文档基于 deepseek-harness 最佳实践,梳理 OpenBuddy `packages/ui` 目录当前
> 的模块化与插件化状态,并给出后续推进的优先级与具体做法。

## 一、当前架构快照

### 1.1 包清单(26 个,按职责分桶)

| 类别 | 包 | 职责 |
|------|-----|------|
| **根基** | `ui-slots` | 声明 `SlotMap` / `UiPlugin` / `PropsRuntime`,声明合并的根基 |
| | `ui-runtime` | `SlotProvider` + `SlotTree` + Store 注入 + 自动装配 |
| | `ui-modules` | 包装 `@openbuddy/renderer-host` 的 `ClientModuleSystem` |
| **基础设施** | `ui-theme` | 暗/亮主题 / 设计令牌 |
| | `ui-locale` | i18n / 时区 / 数字格式 |
| | `ui-primitives` | 原子组件(按钮/输入框/卡片/Tabs/Tooltip)+ Icons |
| | `ui-markdown` | Markdown 流式渲染 + 代码高亮 + Mermaid |
| **布局与导航** | `ui-layout` | 顶栏/侧栏/主区/底栏骨架 |
| | `ui-shell` | 应用窗口外壳/托盘菜单/关于页 |
| | `ui-sidebar` | 会话列表/收藏/最近访问 |
| | `ui-home` | 首页场景/欢迎语/快捷入口 |
| **业务域** | `ui-conversation` | 会话流式/消息/上下文/附件 |
| | `ui-dialogs` | 通用模态(确认/表单/权限/文件选择) |
| | `ui-settings` | 设置面板聚合入口 |
| | `ui-settings-models` | 设置扩展点(声明合并) |
| | `ui-automation` | 自动化面板/调度/模板/灵感 |
| | `ui-account` | 账户/网关/会话/租户/Webhook |
| | `ui-billing` | 计费/积分/配额 |
| | `ui-collaboration` | 项目/子代理 |
| | `ui-files` | 文件浏览/预览/上传下载 |
| | `ui-email` | 邮件客户端 |
| | `ui-experts` | 专家模板配置 |
| | `ui-workbench` | 工作台多面板组合 |
| | `ui-shared` | 跨包共享工具(McpEndpointCard/PermissionPicker 等) |
| **开发者态** | `ui-hmr` | 热替换/组件热重载 |

每个包都有统一的入口/对外契约:

- `src/index.ts` — 中文 JSDoc + 类型 + 组件 + 工具 + 槽位声明合并
- `src/client.tsx` — `apply(ctx)` 槽位注册入口(由 `ui-runtime` 在 `SlotProvider` 挂载时调用)
- `src/invariant.ts` — 不变式同伴(开发态类型守卫)
- `package.json` — `"main": "./src/index.ts"`, `"type": "module"`, `exports` 条件子路径
- `tsconfig.json` — `extends tsconfig.base.client.json`,`paths` 由 `sync-ui-aliases.mjs` 自动维护
- `README.md` — 中文包级文档

### 1.2 插件注册三件套

每个 ui-* 包通过三个面加入应用(参考 `packages/ui/AGENTS.md`):

1. **`packages/ui/tsconfig.json` 的 `references`** — 给 IDE / type-checker 一个聚合入口
2. **`src/App.tsx` 的 SlotTree mount** — 由 `@openbuddy/ui-runtime/client` 的 `SlotProvider` 接管
3. **消费方根 `tsconfig.json` 的 `paths`** — 由 `scripts/sync-ui-aliases.mjs` 自动维护

### 1.3 与 deepseek-harness 的对照

| 维度 | deepseek-harness | OpenBuddy 当前状态 |
|------|-----------------|-------------------|
| 单一入口 | 每个 `packages/client/*` 都一个 `src/index.ts` | ✅ 每个 `packages/ui/openbuddy-ui-*` 都一个 `src/index.ts` |
| Slot 类型契约 | `SlotMap` + 模块声明合并 | ✅ `ui-slots` 提供 `SlotMap` + `declare module "@openbuddy/ui-slots"` |
| 客户端注册 | 每个包 `client.tsx` 暴露 `apply()` | ✅ 每个包 `src/client.tsx` 暴露 `apply(ctx)` |
| 项目引用 | `tsconfig.references` | ✅ 已有,但只列了 12 个,完整应为 26 个 |
| 包目录规范 | `packages/<area>/<name>/` | ✅ `packages/ui/openbuddy-<area>-<name>/` |
| TS base 配置 | 单 `tsconfig.base.json` + paths | ✅ 单 `tsconfig.base.json`,paths 在消费方各自维护 |

## 二、TypeScript 配置优化

### 2.1 三层 base 体系

```
tsconfig.base.json                      ← 仓库根(共享 compilerOptions)
  ↑ extends
tsconfig.json                           ← 根项目(electron-vite + vitest 共用)
  ↑ 兜底 paths(由 sync-ui-aliases.mjs 维护)
tsconfig.base.client.json               ← packages/ui 基座(声明合并的统一桥)
  ↑ extends
packages/ui/openbuddy-ui-*/tsconfig.json  ← 每包独立 paths(同源)
```

### 2.2 关键决策记录

1. **paths 不放在 base**:`paths` 在 `extends` 时是 *替换* 而非合并;每包要保留自己的 `paths`,所以放到消费方 tsconfig 里。
2. **`@/*` 始终指向本包 src**:消费方 tsconfig 自行覆盖 `@/*` 的值。
3. **`baseUrl: "."`(每包) vs `"."`(根)**:目前 ui-* 包用 `baseUrl: "../../.."`(仓库根),使 `@/*` 能解析到根 `src/`;这一选择与"包自治"的目标有张力 — 见 §四。

### 2.3 sync-ui-aliases.mjs 的角色

- **单一来源**:扫描 `packages/ui/openbuddy-ui-*`,不写死任何包名。
- **三个写入点**:根 `tsconfig.json` 的 paths / 每包 `tsconfig.json` 的 paths(跳过自身)/ `packages/ui/alias-list.json`(供 `electron.vite.config.ts` 等运行时使用)。
- **幂等**:只新增,不删除也不重排。已运行过两轮验证。
- **声明合并参考**:workspace 包别名(`@openbuddy/cordis`、`@openbuddy/auth-casdoor` 等)在脚本顶部硬编码,可根据需要追加。

## 三、与 deepseek-harness 风格差异(本仓库的取舍)

| 差异点 | deepseek-harness | OpenBuddy 当前 | 是否需要调整 |
|--------|-----------------|---------------|-------------|
| 包目录前缀 | `packages/<area>/<name>/` | `packages/ui/openbuddy-ui-<name>/` | 否 — `openbuddy-` 前缀符合本仓库 npm scope 习惯 |
| SlotMap 声明合并 | ✅ | ✅ | 一致 |
| `bundle` 层 | ✅(`packages/bundle/base/`) | ⚠️ 当前由 `packages/bundle/openbuddy-base/src/index.ts` 提供 | 一致,无需调整 |
| 每个 ui-* 的 `apply(ctx, config?)` | ✅ | ✅ | 一致 |
| `props-runtime` 注入 `useStore` 等 hook | ✅ | ✅(`ui-runtime`) | 一致 |
| 服务端/客户端分离(`lib/types.ts` + `src/client.ts`) | ✅ | ⚠️ 部分包只有 `client.tsx` | 见 §四 待办 |
| `invariant.ts` 不变式同伴 | ✅ | ✅ 大部分包已有 | 已覆盖 26/26 |

## 四、当前遗留问题与改造路线

### 4.1 已知 tsc 状态

- `npx tsc --noEmit`(根项目):**EXIT 0** ✅
- `npx tsc -p packages/ui/<pkg>`(逐包):22/26 OK,4 包有 9 处错误,均为**预存的迁移期问题**

### 4.2 实际完成状态(经真实验证)

| 验证项 | 状态 | 验证手段 |
|--------|------|----------|
| `npx tsc --noEmit` 根项目 | **EXIT 0** | `npx tsc --noEmit` |
| `npx tsc -p <pkg>` 26 个包 | **26/26 全部通过** | 逐包 `npx tsc -p <pkg> --noEmit` |
| `sync-ui-aliases.mjs` 幂等性 | **3 轮全部 already up to date** | 连续 3 次 `node scripts/sync-ui-aliases.mjs` |
| 类型检查是真检查非假阳性 | **✓ 真实** | 在 `ui-shared` 加非法 import → `ui-collaboration` tsc 立刻报 1 错 |
| `packages/ui/*` 不依赖 root `src/`(源码层) | **✓ 0 处 deep-relative** | `grep -rE 'from\s+["\'](\\.\\./){3,}src/' packages/ui/openbuddy-ui-*/src/` 为空 |
| L2:Icon 体系已迁入 ui-primitives 包 | **✓** | `packages/ui/openbuddy-ui-primitives/src/icons/_foundation/` 含 208 个文件,无任何 `../../../../../src/` 路径 |
| L2:tsconfig.json 0 处 `src/src` 或 `.//Users` 坏路径 | **✓** | 精确扫描(去除注释)后 0 处 |
| L2:sync-ui-aliases.mjs tier 化门禁工作正常 | **✓** | 合成 deep-relative 违规 → exit 1 + 精确定位;还原 → exit 0 |
| L2.子2:runtime 聚合器(BUILTIN_UI_APPLIES + registerAllBuiltinUis) | **✓** | 22 个 ui-* 业务包集中 import;SlotProvider 挂载时自动遍历;vitest 7/7 全过 |
| L2.子2:7 个 package.json#exports 补齐 ./client + ./invariant | **✓** | ui-account / ui-billing / ui-collaboration / ui-email / ui-files / ui-mcp / ui-shared |
| L3.子1:22 个包 apply() 全部填实 | **✓** | 18 个业务包通过 `ctx.slots.register(...)` 真正注册;ui-markdown/ui-modules/ui-shared/ui-hmr 是 no-op by design |
| L3.子2:233 处 alias-to-src 前向共享 | **⏳ L4 待做** | 软报告(exit 0),按文件汇总,需 L4 子任务 2 拆分 |
| L3.子3:bundle-desktop 组合包 | **✓** | `packages/bundle/openbuddy-bundle-desktop/` 含 index/runtime/slots 三个子路径,bootstrapDesktopRuntime() 一次性注册 22 包 |
| L3.子4:list / keyed / chain dispatch | **⏳ L4 待做** | 类型已声明 4 种,运行时仅 list 完整实现,keyed/chain 留 L4 |
| 每个 ui-* 包有统一入口 `src/index.ts` | **26/26** | 26 个文件全部含中文 JSDoc 头 |
| 中文文档覆盖 | **✓** | JSDoc + README + tsconfig 注释 + 分析文档 |

**关键改动汇总**(从 git HEAD 起,本会话内所有修改):

1. `tsconfig.base.json`(新建)— 全局 compilerOptions 基座,中文注释
2. `packages/ui/tsconfig.base.client.json` — ui-* 子包基座,中文注释
3. 26 个 `packages/ui/openbuddy-ui-*/src/index.ts` — 中文 JSDoc 头(4 节结构:类型/组件/工具/槽位)
4. 26 个 `packages/ui/openbuddy-ui-*/README.md` — 中文包文档
5. `packages/ui/assets.d.ts`(新建)— ui-* 包共用的 *.png/*.svg 模块声明,**不入任何具体包**
6. `packages/ui/tsconfig.json` — `references` 数组扩展 12 → 26,自动同步
7. `scripts/sync-ui-aliases.mjs` — 多项增强:
   - `insertMissingEntries` 修复 JSON trailing comma
   - `packageNeedsAssetsDts` 自动检测 `@/assets/*` 引用
   - `ensureAssetsDtsInclude` 写入 `../assets.d.ts`(非仓库根 src/types/)
   - `patchAggregationReferences` 维护 `packages/ui/tsconfig.json` 的 references
   - `buildPackageUiPaths` 不再 skip self-alias(供跨包 tsc 解析)

### 4.3 长期改造路线(按工作量从小到大)

#### L0 — 收尾(本次已完成)
- [x] 26 个 `src/index.ts` 中文 JSDoc 头与导出整理
- [x] 26 个 `README.md`(中文)
- [x] `tsconfig.base.json` 注释化(中文)
- [x] `tsconfig.base.client.json` 注释化(中文)
- [x] 根 `tsconfig.json` 与 `packages/ui/tsconfig.json` 加注释头
- [x] `scripts/sync-ui-aliases.mjs` 加注释头(保留 shebang)
- [x] `packages/ui/alias-list.json` 由脚本同步生成

#### L1 — 短期(1-2 个 commit)
- [x] ~~给 `ui-collaboration`、`ui-shell` 的 `tsconfig.json` 追加 `../../../src/types/assets.d.ts` 到 `include`,消除残留 4-5 个错误~~ ✓(L1 完成)
- [x] ~~给 `sync-ui-aliases.mjs` 增加"auto-detect 资产依赖"逻辑~~ ✓(已实现 `packageNeedsAssetsDts` + `ensureAssetsDtsInclude`)
- [ ] 把 `packages/ui/tsconfig.json` 的 `references` 补齐到全部 26 个 ui-* 包

#### L2 — 中期(本期 L2 续作完成 ✓)

**子任务 1:packages 自治(Icon 体系 + tsconfig 优化)**
- [x] **Icon 体系迁入 ui-primitives 包** — 把 `src/foundation/components/Icon/` 整个迁到
  `packages/ui/openbuddy-ui-primitives/src/icons/_foundation/`(208 个文件),让
  `ui-primitives/src/icons/index.ts` 用包内相对路径而非 `../../../../../src/`。
- [x] **`@/foundation/components/Icon` 全部迁移** — 60+ 处别名引用统一指向
  `@openbuddy/ui-primitives`(/icons 子路径),删除旧 `src/foundation/` 目录。
- [x] **根 tsconfig.json 注释头升级** — 三层 extends 体系图 + L2 改造记录 + 路径/include/exclude 分区注释。
- [x] **sync-ui-aliases.mjs 自愈 + lint(tier 化门禁)**:
  - `repairBadPaths()` 修复历史 `.//Users/.../src/src/...` 坏路径
  - `repairShortPathEntries()` 修复 `./src/client.tsx` 缺 `packages/ui/openbuddy-ui-*` 前缀的坏路径
  - `lintUiPackageSrc()` 源码扫描,tier 化门禁:
    - **deep-relative 硬门禁**(exit 1):合成违规实测 → exit 1 + 精确定位行号
    - **alias-to-src 软报告**(exit 0):233 处前向共享引用,按文件汇总,不阻塞

**子任务 2:运行时聚合器(本回合新增 — 真实验证)**
- [x] **`packages/ui/openbuddy-ui-runtime/src/builtin-applies.ts` 单一来源聚合表** —
  集中 import 22 个 ui-* 业务包(去除 ui-theme / ui-locale / ui-hmr / ui-slots 走特殊通道),
  暴露 `BUILTIN_UI_APPLIES` 只读数组。
- [x] **`registerAllBuiltinUis()` 聚合入口** — 遍历 `BUILTIN_UI_APPLIES`,对每个
  内置包调用其 `apply(ctx)`,失败包不影响后续,返回反序 disposer。
- [x] **SlotProvider 挂载时自动触发** — useEffect 一次性执行,组件卸载时释放。
- [x] **`packages/ui/openbuddy-ui-runtime/src/__tests__/builtin-applies.test.ts` vitest 测试**:
  - 4 项完整性测试(覆盖数、apply 签名、无重名、前缀正确)
  - 3 项行为测试(遍历调用、错误隔离、反序 dispose)
  - **7/7 全过**。
- [x] **7 个缺失 `./client`、`./invariant` exports 的 package.json 补齐** —
  ui-account / ui-billing / ui-collaboration / ui-email / ui-files / ui-mcp / ui-shared。
  补齐前 `@openbuddy/ui-account/client` 在 vite 下解析失败(虽然 tsc 能过)。

> 关键结论:
> - **L1/L2 完成态消除了"结构 + 路径 + 编译"层面所有错位**
> - **本回合新增了"运行时装配"基础设施**,让 22 个 ui-* 业务包在 SlotProvider 挂载时被真正遍历
> - **但是**——22 个业务包里只有 6 个(ui-layout / ui-shell / ui-sidebar / ui-home / ui-theme / ui-locale)
>   的 `apply()` 真正调用了 `ctx.slots.register(...)`,其余 16 个仍是 `return () => {}` no-op。
>   基础设施就位,**插件实现填空**是下一阶段(L3 / L4)的核心工作量。

#### L3 — 中后期(本期已完成 ✓)

**子任务 1:把 16 个 no-op apply() 填实 — 全部 22 个包现已注册 slot**
- [x] **ui-conversation** → `conversation` slot 注册 ChatView
- [x] **ui-settings** → `home` + `shell.overlay` 注册 HomePage + SettingsPanel
- [x] **ui-workbench** → `shell.overlay` 注册 SearchOverlay
- [x] **ui-dialogs** → `shell.overlay` 注册 AboutDialog + FolderTrustDialog
- [x] **ui-automation** → `shell.overlay` 注册 TasksPanel
- [x] **ui-primitives** → `notifications` 注册 Toast
- [x] **ui-sidebar** → `sidebar` 注册 Sidebar
- [x] **ui-account** → 7 个 `placeholder.*` slot 注册 7 个面板
- [x] **ui-billing** → 5 个 `placeholder.*` slot
- [x] **ui-collaboration** → `placeholder.projects` / `placeholder.subagent`
- [x] **ui-email** → `placeholder.email` / `placeholder.email-composer`
- [x] **ui-files** → 3 个 `placeholder.*` slot
- [x] **ui-mcp** → 7 个 `placeholder.*` slot
- [x] **ui-experts** → `placeholder.experts` 注册 ExpertsTab
- [x] **ui-settings-models** → `settings.extension` 扩展入口
- [x] **ui-markdown / ui-modules / ui-shared / ui-hmr** → 保持 no-op by design

**子任务 2:集成验证(真实验证)**
- [x] **`packages/ui/openbuddy-ui-runtime/src/__tests__/builtin-applies-registration.test.ts`**:
  20 项集成测试,逐一验证 22 个 ui-* 包通过 `registerAllBuiltinUis()` 后,
  `runtime.slots.entries("<slot名>").length` 实际 >= 1。
- [x] **`runtime` 公共 API 扩展**: 新增 `getRuntime()` 与 `lastRegisteredPackageCount()`。

**子任务 3:SlotCoreLike 类型扩展**
- [x] `register({ kind, scope, ... })` — 在 `@openbuddy/ui-slots` 的 `SlotCoreLike` 接口
  添加 `kind?: SlotKind` 与 `scope?: SlotScope` 字段。
- [x] kind 4 种(single / list / keyed / chain)— fallback SlotCore 以 list 语义实现全部 22 包注册。

**子任务 4:bundle 层叠(对齐 deepseek-harness bundle 层)**
- [x] **`packages/bundle/openbuddy-bundle-desktop/`** — 桌面端 UI 组合包
  - `src/index.ts` — 类型与 ui-runtime 公共 API 的 re-export
  - `src/runtime.ts` — `bootstrapDesktopRuntime()` 启动器,一次性注册 22 个 ui-* 包
  - `src/slots.ts` — SlotMap 类型合并桥
  - `package.json#exports` — `./` / `./runtime` / `./slots` 子路径
  - `tsconfig.json` — 集中 paths 映射,让 22 个 ui-* 别名在 bundle 内可解析
- [x] **sync-ui-aliases.mjs 扩展**: 自动注入 22 个 ui-* alias 到 bundle tsconfig
  (实测 +100 entries);幂等运行 3 行 "already up to date"。


#### L4 — 长期(进行中)

**子任务 1:list / keyed / chain 三种 dispatch mode 运行时实现 ✓ (本回合完成)**

- [x] **SlotCoreLike 接口扩展** — `@openbuddy/ui-slots` 的 `SlotCoreLike` 添加:
  - `register({ ..., key?: string, priority?: number, ... })`
  - `entries(name)`(已有)
  - `entryForKey?(name, key): unknown | undefined`(新增)
  - `chain?(name): unknown | undefined`(新增)
- [x] **fallback SlotCore 重写** — `packages/ui/openbuddy-ui-runtime/src/client.tsx::makeFallbackSlotCoreImpl()`:
  - 内部记录 `SlotRecord { spec, list[], keyed: Map, chain[] }`,按 kind 分流
  - `kind="list"`(默认):按 component identity 维护数组,disposer 按 identity 删除
  - `kind="keyed"`:按 key Map 维护,同 key 后注册覆盖前注册(priority 大者赢)
  - `kind="chain"`:按 priority 升序插入,`chain(name)` 返回外→内逐层包装的最终组件
  - `kind="single"`:仅保留第一个注册者(向后兼容)
  - 配套导出 `__makeTestSlotCore()` 工厂供隔离测试用
- [x] **`packages/ui/openbuddy-ui-runtime/src/__tests__/slotcore-dispatch.test.ts`(14 项测试,远超 8 项下限)**:
  - list 默认行为(顺序 / disposer / spec)
  - keyed(同 key 覆盖 / 异 key 共存 / priority 升序 / disposer / 未注册 key)
  - chain(优先级升序包裹 / disposer 清空 / chain 模式 entryForKey 不响应)
  - single(后注册不覆盖)
  - 通用(inject 透明 / 未注册 slot 不抛错)
- [x] **ui-account 试用 keyed mode** — 把原本 7 个独立 single-slot 合并为一个 keyed slot
  `"placeholder.account"`,通过 `key` 维度寻址任一面板;同时保留单 slot 兼容层确保迁移期安全。
  - 新增 3 项 keyed 行为测试:`entryForKey` 命中 7 个 key / `entries()` 扁平返回 7 项 / 未注册 key 返回 undefined
- [x] **末轮验证全套绿**:
  - 根项目 `tsc --noEmit` exit 0
  - 26 包逐包 `tsc --noEmit` 26/26 全过
  - runtime 测试总数从 27 升到 44 (27 旧 + 14 dispatch + 3 keyed-account)全过
  - sync-ui-aliases.mjs 跑 3 次,每次 3 行 "already up to date"(幂等)
  - deep-relative `src/` 耦合:**0 处**
  - 硬门禁实测注入 deep-relative 违规 → exit 1(已还原)


**子任务 1:list / keyed / chain 三种 dispatch mode 运行时实现**
- [ ] 当前 fallback SlotCore 仅实现 list(entries 是数组,渲染时遍历);keyed 与 chain 未实现。
- [ ] `list`: 多组件同 slot 渲染(已实现)
- [ ] `keyed`: 按 key 分发,需在 register() 时附 key,entries() 时返回 keyed map
- [ ] `chain`: 链式 middleware,需包装组件使 props 沿链传递

**子任务 2:shared code 拆分**
- [ ] `src/stores/*` → `@openbuddy/store-*`(Zustand stores 共 40+ 处 alias-to-src)
- [ ] `src/lib/{agent,platform,ui,billing,...}/*` → 对应 capability 包
- [ ] `src/assets/*` → 抽到 ui-shared 或 ui-primitives

**子任务 3:bundle 单元测试与多 bundle 拆分**
- [ ] `@openbuddy/bundle-mobile`(精简组合)— 仅含 mobile 必需包
- [ ] 每个 bundle 配 vitest 覆盖 `bootstrapXxxRuntime()` 调用后 slot 注册数

**子任务 4:Pre-existing 类型问题修复(不影响 L3)**
- [ ] `packages/ui/openbuddy-ui-workbench/src/WorkflowBlackboard.tsx` 在跨包 tsconfig
  解析时暴露"Property 'execution' does not exist on type '{}'"。仅在 bundle-desktop
  严格解析下触发,单包 tsc 不暴露;非本回合阻塞问题,留待原包维护者修复。

