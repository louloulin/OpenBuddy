# OpenBuddy 插件开发指南

> 完整 slot 清单见 [`EXTENSION_POINTS.md`](./EXTENSION_POINTS.md);可复制的完整示例见
> [`EXTENSION_RECIPES.md`](./EXTENSION_RECIPES.md) 与 `examples/openbuddy-plugin-*`。
>
> 本指南带你 10 分钟写出一个 hello-world 插件，并解释 OpenBuddy 微内核扩展 API 的关键概念。

## 前置知识

- TypeScript / React 基础
- Node ≥ 20，pnpm ≥ 9
- 了解 OpenBuddy 整体架构（参见 `WORKBUDDY_UI_REFERENCE.md`）

## 微内核回顾

OpenBuddy 的 UI 由微内核（`@openbuddy/ui-runtime` 里的 SlotCore）组合：

- **ui-runtime** 持有内核，`<SlotProvider>` 挂载时把 **21 个内置 `ui-*` 包**
  的 `apply(ctx)` 全部装进去（每个包注册自己的 slot）。
- 结构性 UI 位置（`sidebar` / `conversation` / `home` / `overlay.*` …）由
  AppShell 向内核取用，而不是硬绑到具体组件。
- **第三方插件走同一条注册路径** —— 你注册的 slot 和内置包注册的 slot 在
  内核里没有区别。

### 插件 SDK 的两种贡献形态

| 形态 | 你提供什么 | 宿主做什么 | 例子 |
|---|---|---|---|
| **数据型**（推荐） | 一个描述对象 `{ id, label, icon, onActivate }` | 宿主渲染 UI | 场景 tab、工具栏按钮、命令 |
| **组件型** | 一个 React 组件 | 直接渲染你的组件 | 整块替换侧栏 / 会话区 |

数据型贡献**不需要你打包 React**，插件体积可以只有几 KB。

### 覆盖内置 UI vs 追加内容

- 想**替换**某块内置 UI（如整个侧栏）：向该 `single` slot 注册一个组件。
  卸载后内置实现会自动恢复。
- 想**追加**内容（如往工具栏加按钮）：向对应的 `list` slot 注册数据。
- ⚠️ 同一个 slot 名只能有一种 kind。内置声明为 `single` 时你按 `list` 注册
  会被内核拒绝并告警 —— 应该找那个 list slot，或注册一个自己的新 slot。

优先级规则与完整 slot 清单见 [`EXTENSION_POINTS.md`](./EXTENSION_POINTS.md)。

## 10 分钟写 hello-world

### 第 1 步：创建目录

```bash
mkdir -p ~/openbuddy-plugins/openbuddy-plugin-hello
cd ~/openbuddy-plugins/openbuddy-plugin-hello
```

### 第 2 步：写 manifest.json

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-hello",
  "version": "0.1.0",
  "description": "在 HomePage 注册一个 'Hello' 场景 tab。",
  "author": "Your Name",
  "contributes": {
    "slots": [
      { "name": "home.scene.tab", "kind": "list", "scope": "root" }
    ]
  }
}
```

### 第 3 步：实现 index.tsx

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: {
    name: "openbuddy-plugin-hello",
    version: "0.1.0",
    description: "在 HomePage 注册一个 'Hello' 场景 tab。",
    contributes: {
      slots: [{ name: "home.scene.tab", kind: "list", scope: "root" }],
    },
  },
  setup: (api) => {
    api.registerSlot("home.scene.tab", "list", "root", {
      id: "hello-world-tab",
      label: "👋 Hello",
      icon: "👋",
      onActivate: () => {
        alert("Hello, World! 👋");
      },
    });
  },
});
```

### 第 4 步：加载验证

`defineExtension()` 通过派发 DOM CustomEvent（`openbuddy:register-slot`）表达
贡献，`main.tsx` 里的 `installPluginSdkBridge()` 把它们接进微内核。验证方式：

1. 启动 OpenBuddy dev 模式：`pnpm dev`
2. 打开 DevTools Console，直接派发一次事件即可看到界面变化：

   ```js
   window.dispatchEvent(new CustomEvent("openbuddy:register-slot", {
     detail: {
       name: "home.scene.tab", kind: "list", scope: "root",
       payload: { id: "hello", label: "👋 Hello", icon: "👋" },
     },
   }));
   ```

3. 首页场景栏会立刻多出 `👋 Hello` tab。反注册：

   ```js
   window.dispatchEvent(new CustomEvent("openbuddy:unregister-slot", {
     detail: { name: "home.scene.tab" },
   }));
   ```

自动化验证可直接跑仓库里的两个探针（真实 Electron）：

```bash
node scripts/electron/_probe-microkernel.mjs      # 21 个内置包全部装配 + 结构性 slot 有实现
node scripts/electron/_probe-plugin-sdk.mjs       # 插件注册 → UI 变化 → 反注册 → 还原
node scripts/electron/_probe-plugin-toolbar.mjs   # 工具栏按钮注入 + 点击插入文本
```

### 第 5 步：调试技巧

- **看内核当前状态**：`window.__ob_slotcore.snapshot()` 返回所有 slot 的
  `{ name, kind, entries, registrants, payloadIds }`。
- **看内置包装配结果**：`window.__ob_builtin_report` —— 21 个包各自的
  成功/失败、注册了几个 slot、耗时。
- **看谁注册了哪块 UI**：`snapshot()` 里该 slot 的 `registrants` 字段。
- 插件 reload：设置 → 已安装扩展 → 「刷新」按钮（会先 `unregisterAll` 再重放）。

## API 参考

### `defineExtension(config)`

```typescript
interface ExtensionConfig {
  manifest: PluginManifest;
  setup: (api: ExtensionApi) => void | (() => void);
}
```

`setup` 返回可选的 cleanup 函数，会在插件卸载时被调用。

### `api.registerSlot(name, kind, scope, payload)`

- `name`：string，见 [`EXTENSION_POINTS.md`](./EXTENSION_POINTS.md) 的 slot 清单
- `kind`：`'list'`（追加）| `'keyed'`（按 key 唯一）
  > 想整体替换某块内置 UI 时，直接用内核 API 注册 `single`（见下节）；
  > SDK 的 `registerSlot` 只暴露 list / keyed 两种追加语义。
- `scope`：`'root'` | `'session'`
- `payload`：**数据型贡献的载荷**。约定至少带 `id`；常见字段：
  `label` / `icon` / `description` / `onActivate`。
  宿主会用 `useSlotPayloads(name)` 读取并渲染。

同一 `id` 重复注册是幂等的 —— 插件重复 `setup()` 不会在界面里叠加两份。

### 直接使用内核 API（组件型贡献 / 覆盖内置 UI）

SDK 事件适合数据型贡献。要提供 React 组件或覆盖 `single` slot，直接用内核：

```tsx
import { getRuntime } from "@openbuddy/ui-runtime/client";

const runtime = getRuntime();
const dispose = runtime.slots.register(
  {
    name: "sidebar",          // 覆盖整个侧栏
    kind: "single",
    scope: "root",
    priority: 10,             // 数值大者胜；同 priority 后注册者胜
    registrant: "acme/sidebar-plus",
  },
  MySidebar,                  // 你的 React 组件
);

// 卸载时归还：内置实现自动恢复
dispose();
```

消费端则用 `useSlotComponents(name)` / `<SlotOutlet name="..." />`
（都从 `@openbuddy/ui-runtime/client` 导出），它们会订阅内核变更、
在插件注册或卸载后立即重渲染。

### `api.registerCommand(id, label, onExecute)`

注册一个 slash 命令。`label` 是展示名（会出现在 ⌘K 命令面板与 Composer 的 `/` 菜单里，
所以别只写 `/greet`，写成 `/greet — 输出问候` 更容易被搜到）；`onExecute` 接收
`{ args: string }` 上下文。

命令注册进内核的 `plugin.command` 槽（数据型），由宿主提供 UI：

| 入口 | 行为 |
|---|---|
| ⌘K 命令面板 | 列出全部命令；`/greet Alice` 只保留匹配项，回车执行 |
| Composer 的 `/` 补全 | 与 Pi 自带命令同列（同名时 Pi 优先），回车走发送路径分流执行 |

两个入口都在**渲染端**执行回调，不经过 agent。

### `api.unregisterAll()`

清空本插件注册的所有 slot / command。一般不需要手动调用 — `defineExtension` 返回的 `Extension.dispose()` 会自动调用。

## 进阶话题

### 监听 slot 变化

内核为每个 slot 提供精准订阅（注册 / 反注册时触发一次）：

```ts
const off = getRuntime().slots.subscribe?.("home.scene.tab", () => {
  console.log("场景 tab 变了", getRuntime().slots.entries("home.scene.tab").length);
});
```

宿主组件应该用 `useSlotComponents` / `useSlotPayloads`（它们内部就是这个订阅），
不要自己去轮询 DOM。

### 异步初始化

`setup` 允许返回 Promise（仅在 `setup` 顶层使用 `async` 即可）。Runtime 会等待 Promise resolve 后才标记插件为 ready。

### 持久化数据

通过 `api.registerStore(name, initialState)` 注册一个 zustand store。`unregisterAll` 时自动清理。

### 跨域 / 远程加载

`RendererPluginLoader` 已支持 dsh.client 远程协议。本地 dev 模式优先使用 `~/openbuddy-plugins/`。

## 下一步

- 查看 [`EXTENSION_RECIPES.md`](./EXTENSION_RECIPES.md) 了解更多场景（自定义工具栏 / 侧边栏 / slash 命令 / 工作流）
- 阅读 [`EXTENSION_POINTS.md`](./EXTENSION_POINTS.md) 了解所有可用 slot
- 现有示例插件：`examples/openbuddy-plugin-{hello,toolbar,slash}/`
