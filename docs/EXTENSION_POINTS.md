# OpenBuddy 扩展点登记表 (Extension Points Registry)

> `version: 1` · 契约 id `openbuddy.plugin.v1` · 表体自动生成
>
> 事实来源是 **代码本身**:`node scripts/ui-slot-audit.mjs` 扫描全部 `ui-*` 包的
> SlotMap 声明、`ctx.slots.register(...)` 调用与消费点(`<SlotOutlet>` /
> `useSlot*` / `slotCore.get`),把「谁声明、谁注册、谁消费」三个集合对齐。
> 下面的表体由 `--md` 模式产出,CI 由
> `packages/ui/openbuddy-ui-runtime/src/__tests__/extension-points.test.ts`
> 校验新鲜度 —— **手改表体一定会让 CI 变红**。

## 两条总线

OpenBuddy 的插件 UI 插入点分两条总线,同一份 manifest 都可以贡献,但注册 API 与
契约强度不同 —— 只读其中一条会漏掉一半的可用位置。

| | 总线 A:SlotCore(微内核) | 总线 B:渲染端贡献 |
|---|---|---|
| 注册 API | `api.registerSlot(name, kind, scope, payload)` | `rendererContributions.register({ kind, id, payload })` |
| 契约 | `declare module "@openbuddy/ui-slots"` 的 `SlotMap`,kind/scope 强校验 | `kind` 是封闭联合(`@openbuddy/renderer-host`),payload 自由 |
| 覆盖能力 | 可**替换**内置实现(`single` + priority) | 只能**追加**(宿主不提供内置实现) |
| 本文档 | 下面「SlotCore 槽位总表」 | 同一生成区块里的「渲染端贡献总线」两节 |

还有少量**渲染端字符串槽**(`sidebar.footer.action` / `settings.section` …):它们走
Cordis 的 `slots` 服务,名字由消费方约定、插件自由注册,没有 SlotMap 契约。
宿主会在哪些位置渲染它们,同样列在下面 —— 但**不要**用 `registerSlot` 往里注册。

## 如何读这张表

**Kind(同名槽只能有一种 kind,注册时不一致会被内核拒绝并告警)**

| Kind | 语义 | 插件通常怎么用 |
|---|---|---|
| `single` | 单值,可被替换 | 注册一个组件 → 整体替换该块 UI(卸载后内置实现自动恢复) |
| `list` | 多值追加 | 注册一个描述对象 → 追加一项(按钮/条目/浮层) |
| `keyed` | 按 key 唯一 | 注册 `{ key, render }` → 接管某个具名位置 |
| `chain` | 责任链 | 逐级转换/拦截(少见) |

**Scope(决定这块 UI 的存活范围)**

| Scope | 语义 |
|---|---|
| `root` | 跨会话共享,全局只渲染一次 |
| `session` | 每个会话各自一份状态 |
| `session-maybe` | 根级渲染,但只在会话激活时有内容 |

**状态**

| 状态 | 含义 | 该做什么 |
|---|---|---|
| `ok` | 有人注册、有人消费 | 直接向该槽注册即可生效 |
| `ext` / `ext-default` | 零注册是设计如此 | `ext` 留给本产品外壳之外的装配方;`ext-default` 的消费方自带内置 fallback,你注册同名单例槽就是替换它 |
| `dead` | 有人注册但无人消费 | **bug**,能力对用户不可见 |
| `no-impl` | 有人消费但无人注册 | 接线缺口,插件替换收益为 0 |

<!-- BEGIN GENERATED: extension-points -->

> 本区块由 `node scripts/ui-slot-audit.mjs --md` 生成,**请勿手改**。
> 新增/删除槽位后重跑该命令;CI 由 `packages/ui/openbuddy-ui-runtime/src/__tests__/extension-points.test.ts` 校验新鲜度。

### SlotCore 槽位总表

**共 43 个槽位** — `ok=25` · `ext=18` · `dead=0` · `no-impl=0`

| Slot | Kind | Scope | 状态 | 声明于 | 注册方 | 消费方 |
|---|---|---|---|---|---|---|
| `composer.toolbar.action` | `list` | `session` | 🔌 ext-default | @openbuddy/ui-conversation | — | @openbuddy/ui-conversation |
| `conversation` | `single` | `session-maybe` | ✅ ok | @openbuddy/ui-layout | @openbuddy/ui-conversation | app(src) |
| `conversation.body` | `single` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-conversation | — | @openbuddy/ui-conversation |
| `conversation.composer` | `single` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-conversation | — | @openbuddy/ui-conversation |
| `conversation.message.markdown` | `single` | `session` | 🔌 ext-default | @openbuddy/ui-conversation | — | @openbuddy/ui-conversation |
| `conversation.toolside` | `list` | `session` | 🔌 ext-default | @openbuddy/ui-conversation | — | @openbuddy/ui-conversation |
| `details` | `single` | `session-maybe` | ✅ ok | @openbuddy/ui-shell | @openbuddy/ui-shell | app(src) |
| `editor.body` | `single` | `session-maybe` | ✅ ok | @openbuddy/ui-editor | @openbuddy/ui-editor | @openbuddy/ui-conversation |
| `editor.mention-sources` | `list` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-editor | — | @openbuddy/ui-editor |
| `editor.slash-commands` | `list` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-editor | — | @openbuddy/ui-editor |
| `editor.toolbar` | `list` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-editor | — | @openbuddy/ui-editor |
| `experts.panel` | `single` | `root` | 🔌 ext-default | @openbuddy/ui-experts | — | app(src) |
| `files.tree` | `single` | `session-maybe` | ✅ ok | @openbuddy/ui-files-tree | @openbuddy/ui-files-tree | @openbuddy/ui-conversation |
| `home` | `single` | `session-maybe` | ✅ ok | @openbuddy/ui-settings | @openbuddy/ui-settings | app(src) |
| `home.page` | `single` | `root` | 🔌 ext-default | @openbuddy/ui-home | — | — |
| `home.practice-cases` | `single` | `root` | 🔌 ext-default | @openbuddy/ui-settings | — | @openbuddy/ui-settings |
| `home.scene-tabs` | `single` | `root` | 🔌 ext-default | @openbuddy/ui-settings | — | @openbuddy/ui-settings |
| `home.scene.tab` | `list` | `root` | 🔌 ext-default | @openbuddy/ui-settings | — | @openbuddy/ui-settings |
| `library.section` | `list` | `root` | ✅ ok | @openbuddy/ui-library | @openbuddy/ui-library | @openbuddy/ui-library |
| `modules.marketplace` | `single` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-modules | — | @openbuddy/ui-experts |
| `modules.marketplace.item` | `list` | `session-maybe` | 🔌 ext-default | @openbuddy/ui-modules | — | — |
| `notifications` | `list` | `root` | 🔌 ext | @openbuddy/ui-primitives | @openbuddy/ui-primitives | — |
| `onboarding.data-dir` | `single` | `session-maybe` | ✅ ok | @openbuddy/ui-onboarding | @openbuddy/ui-onboarding | app(src) |
| `onboarding.feedback` | `single` | `root` | ✅ ok | @openbuddy/ui-onboarding | @openbuddy/ui-onboarding | app(src) |
| `onboarding.tour` | `single` | `root` | ✅ ok | @openbuddy/ui-onboarding | @openbuddy/ui-onboarding | app(src) |
| `onboarding.whats-new` | `single` | `root` | ✅ ok | @openbuddy/ui-onboarding | @openbuddy/ui-onboarding | app(src) |
| `onboarding.wizard` | `single` | `root` | ✅ ok | @openbuddy/ui-onboarding | @openbuddy/ui-onboarding | app(src) |
| `overlay.about` | `single` | `root` | ✅ ok | @openbuddy/ui-dialogs | @openbuddy/ui-dialogs | app(src) |
| `overlay.folder-trust` | `single` | `root` | ✅ ok | @openbuddy/ui-dialogs | @openbuddy/ui-dialogs | app(src) |
| `overlay.search` | `single` | `root` | ✅ ok | @openbuddy/ui-workbench | @openbuddy/ui-workbench | app(src) |
| `overlay.settings` | `single` | `root` | ✅ ok | @openbuddy/ui-settings | @openbuddy/ui-settings | app(src) |
| `overlay.sign-in` | `single` | `root` | ✅ ok | @openbuddy/ui-dialogs | @openbuddy/ui-dialogs | app(src) |
| `overlay.tasks` | `single` | `root` | ✅ ok | @openbuddy/ui-automation | @openbuddy/ui-automation | app(src) |
| `placeholder.experts` | `single` | `root` | ✅ ok | @openbuddy/ui-experts | @openbuddy/ui-experts | @openbuddy/ui-experts |
| `placeholder.library` | `single` | `root` | ✅ ok | @openbuddy/ui-library | @openbuddy/ui-library | app(src) |
| `plugin.command` | `list` | `root` | ✅ ok | @openbuddy/ui-runtime | @openbuddy/ui-runtime | @openbuddy/ui-conversation, app(src) |
| `root` | `single` | `root` | 🔌 ext-default | @openbuddy/ui-layout | — | app(src) |
| `settings.appearance.language` | `single` | `root` | ✅ ok | @openbuddy/ui-locale | @openbuddy/ui-settings | @openbuddy/ui-settings |
| `settings.appearance.theme` | `single` | `root` | ✅ ok | @openbuddy/ui-theme | @openbuddy/ui-settings | @openbuddy/ui-settings |
| `settings.policy.section` | `list` | `root` | ✅ ok | @openbuddy/ui-settings | @openbuddy/ui-settings | @openbuddy/ui-settings |
| `shell.overlay` | `list` | `root` | 🔌 ext | @openbuddy/ui-layout | @openbuddy/ui-automation, @openbuddy/ui-dialogs, @openbuddy/ui-settings, @openbuddy/ui-workbench | — |
| `shell.statusbar` | `single` | `root` | ✅ ok | @openbuddy/ui-shell | @openbuddy/ui-shell | app(src) |
| `sidebar` | `single` | `root` | ✅ ok | @openbuddy/ui-layout | @openbuddy/ui-sidebar | app(src) |

**状态含义**

- `ok` — 有人注册、有人消费,插件注册同名单例槽即可替换。
- `ext` / `ext-default` — 零注册是设计如此:前者留给本产品外壳之外的装配方,后者消费方自带内置 fallback。
- `dead` — 有人注册但无人消费(能力不可见,属于 bug)。
- `no-impl` — 有人消费但无人注册(插件替换收益为 0,属于接线缺口)。

**非 ok 槽位的判据**

- 内置即默认:消费方自带 fallback,插件注册同名单例槽即整体替换 — `composer.toolbar.action`, `conversation.body`, `conversation.composer`, `conversation.message.markdown`, `conversation.toolside`, `editor.mention-sources`, `editor.slash-commands`, `editor.toolbar`, `experts.panel`, `home.practice-cases`, `home.scene-tabs`, `home.scene.tab`, `root`
- 已废弃:仅为兼容旧插件的类型引用保留,不要再接线 — `home.page`
- 参考实现:声明包只导出组件,apply() 有意 no-op — `modules.marketplace`, `modules.marketplace.item`
- 有意扩展点:留给本产品外壳之外的装配方(第三方外壳/插件可整块接管) — `notifications`, `shell.overlay`

### 渲染端贡献总线(第二条总线,与 SlotCore 并列)

由 `@openbuddy/renderer-host` 的 `RendererContributionRegistry` 承载:插件以
`{ kind, id, payload }` 注册,宿主按 `kind` 渲染。`kind` 是封闭联合,下面按代码核对
**声明 7 个 / 被消费 7 个**。

| Kind | 消费点 |
|---|---|
| `sidebar` | @openbuddy/ui-mcp, @openbuddy/ui-sidebar |
| `assistant` | @openbuddy/ui-shell, app(src) |
| `project` | @openbuddy/ui-workbench |
| `composer` | @openbuddy/ui-conversation, @openbuddy/ui-mcp |
| `message` | @openbuddy/ui-conversation |
| `settings` | @openbuddy/ui-settings |
| `command` | @openbuddy/ui-workbench |

**renderer 字符串槽(10 个)** —— 走 Cordis `slots` 服务,名字由插件自由起,
没有 SlotMap 契约;列在这里是为了让插件作者知道宿主**会**在哪些位置把它们渲染出来。

| Slot | 消费点 |
|---|---|
| `conversation.hero.brand.mark` | @openbuddy/ui-settings |
| `conversation.hero.workspace` | @openbuddy/ui-settings |
| `conversation.input.dock` | @openbuddy/ui-conversation |
| `conversation.message.footer` | @openbuddy/ui-conversation |
| `settings.general.item` | @openbuddy/ui-settings |
| `settings.section` | @openbuddy/ui-settings |
| `sidebar.brand.mark` | @openbuddy/ui-sidebar |
| `sidebar.brand.name` | @openbuddy/ui-sidebar |
| `sidebar.footer.action` | @openbuddy/ui-sidebar |
| `sidebar.workspaces` | @openbuddy/ui-sidebar |

<!-- END GENERATED: extension-points -->

## 已被移除的幽灵槽位(v1 → v1.1)

R31 之前这张表是手写的,里面登记了 4 个**代码里从来没有过**的槽位:任何按旧文档
去注册它们的插件都不会生效,而且不会有任何报错 —— 只会安静地什么都不发生。
它们已从登记表移除(`ui-slot-audit.mjs` 扫不到 = 不存在)。对应的能力其实都在
总线 B 上,用另一套名字注册即可:

| 旧文档里的名字 | 真实能力在哪 | 怎么用 |
|---|---|---|
| `sidebar.nav.item` | 渲染端 contribution kind `sidebar` | `rendererContributions.register({ kind: "sidebar", id, payload: { label, route \| onActivate \| placeholder } })` |
| `settings.page` | kind `settings` + 字符串槽 `settings.section` / `settings.general.item` | 注册 kind `settings` 追加一整块设置内容;字符串槽用于往既有分区里塞一行 |
| `message.toolcall.card` | kind `message` + 字符串槽 `conversation.message.footer` | 前者在消息流里追加自定义卡片,后者只挂消息底部那一行 |
| `workbench.tab` | kind `project`(`payload.projectTab`) | 给项目详情页追加一个页签 |

为什么不再补一组同名的 SlotCore 槽:同一块 UI 出现两个名字只会让插件作者猜哪个
才生效。总线 B 的这 4 个位置已经有消费者、有 UI、有测试,补 SlotCore 槽等于造第二份
实现。

> 顺带说明:`composer.toolbar.action` 与 `home.scene.tab` 是那批"6 个核心扩展点"里
> 唯二真实存在的两个,其余 4 个就是上表这 4 个。

## 注册一个扩展点

### 方式一:插件 SDK(推荐,第三方插件走这条)

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: {
    name: "openbuddy-plugin-toolbar",
    version: "0.1.0",
    contributes: { slots: [{ name: "composer.toolbar.action", kind: "list", scope: "session" }] },
  },
  setup: (api) => {
    api.registerSlot("composer.toolbar.action", "list", "session", {
      id: "insert-timestamp",
      label: "插入时间戳",
      icon: "🕐",
      onClick: (ctx) => ctx?.insertText?.(`\n[${new Date().toISOString()}]\n`),
    });
  },
});
```

`registerSlot(name, kind, scope, payload)` 的 `kind` / `scope` 必须与上表一致。
拿不准时以表为准 —— 表来自代码,不看文档猜。

### 方式二:内置包(维护者改内核时)

```tsx
// 注册侧(client.tsx)
ctx.slots.register(
  { name: "shell.statusbar", kind: "single", scope: "root", registrant: "@openbuddy/ui-shell" },
  StatusBar as never,
);

// 消费侧(宿主组件)
const [StatusBar] = useSlotComponents("shell.statusbar");
return StatusBar ? <StatusBar {...props} /> : null;
```

### 通过 slot 渲染 UI(不要直接 import 具体组件)

```tsx
import { SlotOutlet, useSlotComponents } from "@openbuddy/ui-runtime/client";

// 声明式 —— 整块交给内核
<SlotOutlet name="overlay.search" props={{ open, onClose }} />

// 编程式 —— 自己控制容器时
const [SearchPanel] = useSlotComponents("overlay.search");
return SearchPanel ? <SearchPanel open={open} onClose={onClose} /> : null;
```

两者都**订阅内核变更**:插件运行时注册/卸载后界面立即重渲染,无需刷新。

### 覆盖优先级

- **数值大者胜**;同 `priority` 时**后注册者胜**(插件可以就地接管,不必猜内置用了什么 priority)。
- 内置实现默认 `priority: 0`;不应被替换的内置实现可显式声明高 priority「自保」。
- 插件卸载(disposer 调用)后内置实现**自动恢复** —— 内核为 `single` 槽保留注册栈。

## 观测与自检

- 渲染进程里 `window.__ob_slotcore.snapshot()` 返回全部槽的
  `{ name, kind, entries, registrants }`;`window.__ob_builtin_report` 返回
  21 个内置包的逐包装配结果(成功/失败/注册数/耗时)。
- `node scripts/electron/_probe-microkernel.mjs` 在真实 Electron 里断言装配。
- `node scripts/ui-slot-audit.mjs` 打印上表;`--json` 给结构化输出(逐槽
  `kind` / `scope` / `status` / `reason` / 注册方 / 消费方)。

## 添加新扩展点

1. 在**声明包**的 `src/index.ts` 里 `declare module "@openbuddy/ui-slots"` 补一条
   `{ kind, scope, owner? }` —— 契约先落地。
2. 在实现包 `apply(ctx)` / `client.tsx` 里 `ctx.slots.register(...)`,并在宿主组件里
   消费(否则审计会报 `dead`)。
3. 重跑 `node scripts/ui-slot-audit.mjs --md`,把输出贴回本文件标记区块内。
4. 跑 `npx vitest run packages/ui/openbuddy-ui-runtime/src/__tests__/extension-points.test.ts`。

## Plugin SDK v1

| 资源 | 位置 |
|---|---|
| 十分钟上手(hello-world) | `docs/EXTENSION_GUIDE.md` |
| 可复制 recipe(工具栏 / slash / 面板 / 主题) | `docs/EXTENSION_RECIPES.md` |
| 完整示例工程 | `examples/openbuddy-plugin-hello`、`examples/openbuddy-plugin-toolbar`、`examples/openbuddy-plugin-slash` |
| manifest schema | `openbuddy.plugin.v1`(`packages/runtime/openbuddy-plugin-sdk/src/types.ts`) |
| 四条贡献轨道 | `pi`(PI 扩展工厂)/ `cordis`(DI 服务)/ `ui`(slot 贡献)/ `harness`(DSH 兼容,过渡) |
| 市场与多源 registry | `docs/PLUGIN_MARKETPLACE.md` |
| 站点入口 | `apps/openbuddy-website` → `/docs/extension-points` |

一个插件可以只贡献 `ui`,也可以同时贡献 `pi` + `cordis`;manifest 里没写的轨道不会被装配。

## 兼容性

- 本表 `version: 1`,契约 id `openbuddy.plugin.v1`;SDK 在 manifest 里记录 protocol 版本,
  跨版本不匹配会被序列化器拒绝。
- 破坏性改动(slot 改名 / kind 变更)必须新增槽位而不是改老的 —— `home.page` 就是
  这样的历史包袱,保留声明只为不破坏旧插件的类型引用。
- 后续 v2 计划引入 typed payload schema(基于 Zod),届时 `owner` 形状可被运行时校验。
