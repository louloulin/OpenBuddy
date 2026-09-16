# OpenBuddy 扩展 Recipes

> 常用插件场景的完整可运行示例。每个 recipe 都包含 manifest.json + index.tsx，可直接复制使用。

## Recipe 1: 自定义 Composer 工具栏按钮

在 Composer 输入框工具栏注入一个按钮，点击插入预设文本。

### `manifest.json`

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-toolbar",
  "version": "0.1.0",
  "description": "在 Composer 工具栏注入「插入时间戳」按钮",
  "contributes": {
    "slots": [
      { "name": "composer.toolbar.action", "kind": "list", "scope": "session" }
    ]
  }
}
```

### `index.tsx`

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: { /* same as above */ },
  setup: (api) => {
    api.registerSlot("composer.toolbar.action", "list", "session", {
      id: "insert-timestamp",
      label: "插入时间戳",
      icon: "🕐",
      onClick: (ctx) => {
        const ts = new Date().toISOString();
        ctx?.insertText?.(`\n[${ts}]\n`);
      },
    });
  },
});
```

## Recipe 2: 自定义 Sidebar 导航项

在左侧 sidebar 添加一个新的导航 tab，点击切换到自定义页面。

### `manifest.json`

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-sidebar",
  "version": "0.1.0",
  "description": "在 Sidebar 添加「我的工具」导航 tab",
  "contributes": {
    "slots": [
      { "name": "sidebar.nav.item", "kind": "list", "scope": "root" }
    ]
  }
}
```

### `index.tsx`

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: { /* same as above */ },
  setup: (api) => {
    api.registerSlot("sidebar.nav.item", "list", "root", {
      id: "my-tools",
      label: "🛠 我的工具",
      icon: "🛠",
      page: "my-tools-page",
    });
  },
});
```

被引用的 `my-tools-page` 需要在 main process 注册一个 page route（通过 `appRouter.registerPage()`），此处省略。

## Recipe 3: 注册 Slash 命令

注册一个 `/greet <name>` 命令。它有两个入口，都会真的执行你的 `onExecute`：

- **Composer 的 `/` 补全菜单**：输入 `/gr` 出现 `/greet`（同名时 Pi 自带命令优先），
  补全后输入参数再回车即可发送 —— 发送路径会把 `/greet Alice` 识别成插件命令，
  用 `{ args: "Alice" }` 调用你的回调，**不会**把这段文本当成 prompt 发给模型。
- **⌘K 命令面板**：打开就能看到命令，回车直接执行（带参数时用 `/greet Alice`）。

两条路径都要求插件命令是渲染端动作，所以请在 `onExecute` 里完成全部工作。

### `manifest.json`

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-slash",
  "version": "0.1.0",
  "description": "注册 /greet slash 命令",
  "contributes": {
    "slots": [],
    "commands": [
      { "id": "greet", "label": "/greet — 输出问候", "shortcut": "/greet" }
    ]
  }
}
```

### `index.tsx`

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: { /* same as above */ },
  setup: (api) => {
    api.registerCommand("greet", "/greet", (ctx) => {
      const name = ctx?.args ?? "World";
      console.log(`Hello, ${name}!`);
    });
  },
});
```

## Recipe 4: 注册工作流（Workbench Tab）

在主工作台底部添加自定义 tab，承载完整自定义工作流。

### `manifest.json`

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-workbench",
  "version": "0.1.0",
  "description": "在 Workbench 添加「代码片段」tab",
  "contributes": {
    "slots": [
      { "name": "workbench.tab", "kind": "keyed", "scope": "root" }
    ]
  }
}
```

### `index.tsx`

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";
import { CodeSnippetsView } from "./CodeSnippetsView";

export default defineExtension({
  manifest: { /* same as above */ },
  setup: (api) => {
    api.registerSlot("workbench.tab", "keyed", "root", {
      tabId: "code-snippets",
      label: "代码片段",
      render: CodeSnippetsView,
    });
  },
});
```

`CodeSnippetsView` 是你自己的 React 组件。

## Recipe 5: 设置面板自定义页面

在设置面板加一个 tab，承载插件专属设置。

### `manifest.json`

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-settings",
  "version": "0.1.0",
  "description": "在设置面板添加「插件设置」tab",
  "contributes": {
    "slots": [
      { "name": "settings.page", "kind": "keyed", "scope": "root" }
    ]
  }
}
```

### `index.tsx`

```typescript
import { defineExtension } from "@openbuddy/plugin-sdk";
import { PluginSettingsPage } from "./PluginSettingsPage";

export default defineExtension({
  manifest: { /* same as above */ },
  setup: (api) => {
    api.registerSlot("settings.page", "keyed", "root", {
      pageId: "plugin-settings",
      label: "插件设置",
      render: PluginSettingsPage,
    });
  },
});
```

## 调试

```typescript
// 列出所有已注册的 slot
window.dispatchEvent(new CustomEvent("openbuddy:list-slots"));

// 监听注册事件
window.addEventListener("openbuddy:register-slot", (e) => {
  console.log("slot registered:", (e as CustomEvent).detail);
});
```

## 完整示例

- `examples/openbuddy-plugin-hello/` — Recipe 1 简化版（home.scene.tab）
- `examples/openbuddy-plugin-toolbar/` — Recipe 1（composer.toolbar.action）
- `examples/openbuddy-plugin-slash/` — Recipe 3（slash 命令）
