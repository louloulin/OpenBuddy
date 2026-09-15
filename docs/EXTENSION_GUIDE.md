# OpenBuddy 插件开发指南

> 中文版本（默认） · 英文版见 `EXTENSION_GUIDE.en.md`
>
> 本指南带你 10 分钟写出一个 hello-world 插件，并解释 OpenBuddy 微内核扩展 API 的关键概念。

## 前置知识

- TypeScript / React 基础
- Node ≥ 20，pnpm ≥ 9
- 了解 OpenBuddy 整体架构（参见 `WORKBUDDY_UI_REFERENCE.md`）

## 微内核回顾

OpenBuddy 内部已经实现了 Cordis + Slot 微内核总线：

- **ui-runtime** 提供 `SlotProvider` 上下文 + `BUILTIN_UI_APPLIES` 表
- 26 个 `ui-*` 包通过 `apply(ctx)` 注册 slot / theme / locale / store
- 第三方插件通过相同 API 注册新 slot

详细 slot 列表见 [`EXTENSION_POINTS.md`](./EXTENSION_POINTS.md)。

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

1. 启动 OpenBuddy dev 模式：
   ```bash
   pnpm dev
   ```
2. 打开设置 → 已安装扩展 → 「开发模式」自动加载列表 → 看到 `openbuddy-plugin-hello`。
3. 回到 HomePage，场景切换栏出现 `👋 Hello` tab。点击弹出 alert。

### 第 5 步：调试技巧

- 浏览器 DevTools → Console 过滤 `openbuddy:register-slot` 事件
- `window.dispatchEvent(new CustomEvent('openbuddy:list-slots'))` 可查看当前所有 slot
- 插件 reload：设置 → 已安装扩展 → 「刷新」按钮

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

- `name`：string，参见 `EXTENSION_POINTS.md` 中的 slot 名
- `kind`：`'list'` | `'keyed'`
- `scope`：`'root'` | `'session'`
- `payload`：slot 载荷（参见 `EXTENSION_POINTS.md` 详细说明）

### `api.registerCommand(id, label, onExecute)`

注册一个 slash 命令。`onExecute` 接收 `{ args: string }` 上下文。

### `api.unregisterAll()`

清空本插件注册的所有 slot / command。一般不需要手动调用 — `defineExtension` 返回的 `Extension.dispose()` 会自动调用。

## 进阶话题

### 监听 slot 变化

通过 `window.addEventListener('openbuddy:register-slot', handler)` 监听其他插件注册的事件（注意性能：节流到 100ms）。

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
