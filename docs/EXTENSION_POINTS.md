# OpenBuddy 扩展点登记表 (Extension Points Registry)

> 版本 1 · 自动生成 · 来源 `packages/ui/openbuddy-ui-runtime/src/builtin-applies.ts`
>
> 第三方插件作者可以注册以下 slot 接入 OpenBuddy 内部总线。本文档是事实来源（source of truth），由 vitest 单测在 CI 阶段校验每个 builtin apply() 是否覆盖了对应 slot。

## 总览

| Slot 名 | Kind | Scope | Owner 包 | 载荷形态 |
|---|---|---|---|---|
| `home.scene.tab` | list | root | `@openbuddy/ui-home` | `{ id, label, icon, onActivate }` |
| `composer.toolbar.action` | list | session | `@openbuddy/ui-conversation` | `{ id, label, icon, onClick, disabled? }` |
| `message.toolcall.card` | keyed | session | `@openbuddy/ui-conversation` | `{ toolName, render: Component }` |
| `sidebar.nav.item` | list | root | `@openbuddy/ui-sidebar` | `{ id, label, icon, page: 'chat'\|'projects'\|'plugins'\|string }` |
| `workbench.tab` | keyed | root | `@openbuddy/ui-workbench` | `{ tabId, label, render: Component }` |
| `settings.page` | keyed | root | `@openbuddy/ui-settings` | `{ pageId, label, render: Component }` |

### 结构性 UI 位置（Phase K.3 微内核接线后）

下表是**内核里真实存在、且 AppShell 会去取用**的 slot。第三方插件对 `single`
类型的项注册同名 slot 即可整体替换该块 UI；对 `list` 类型的项注册则追加内容。

| Slot 名 | Kind | 内置提供者 | 替换后的效果 |
|---|---|---|---|
| `sidebar` | single | `@openbuddy/ui-sidebar` | 整个左侧导航栏换成你的实现 |
| `conversation` | single | `@openbuddy/ui-conversation` | 整个会话区（消息流 + 输入框）换成你的实现 |
| `home` | single | `@openbuddy/ui-settings` | 未进入会话时的首页换成你的实现 |
| `overlay.search` | single | `@openbuddy/ui-workbench` | ⌘K 搜索面板 |
| `overlay.settings` | single | `@openbuddy/ui-settings` | 设置面板 |
| `overlay.about` | single | `@openbuddy/ui-dialogs` | 「关于」对话框 |
| `overlay.folder-trust` | single | `@openbuddy/ui-dialogs` | 目录信任对话框 |
| `overlay.tasks` | single | `@openbuddy/ui-automation` | 任务面板 |
| `notifications` | list | `@openbuddy/ui-primitives` | 追加全局通知层 |
| `details` | single | `@openbuddy/ui-shell` | 会话态左侧导轨 |
| `root` | single | `@openbuddy/ui-layout` | 整体外壳（慎用） |
| `shell.overlay` | list | 5 个包共同提供 | 追加一个全局浮层 |
| `placeholder.*` | single | 各业务包 | 替换某个占位页（如 `placeholder.my-files`） |

#### 覆盖优先级

内核按 `priority` 决定同名 `single` slot 的赢家：

- **数值大者胜**；同 `priority` 时**后注册者胜**（插件因此可以就地接管，不必猜到内置用了什么 priority）。
- 内置实现默认 `priority: 0`。若某个内置实现不应被替换，它可以显式声明高 priority「自保」。
- 插件卸载（disposer 调用）后，内置实现**自动恢复** —— 内核为 `single` slot 保留注册栈，而不是让先注册者永久占位。

#### 通过 slot 渲染 UI（推荐做法）

不要直接 import 具体组件，用 `<SlotOutlet>` 让内核决定渲染谁：

```tsx
import { SlotOutlet, useSlotComponents } from "@openbuddy/ui-runtime/client";

// 方式一：声明式 —— 整块交给内核
<SlotOutlet name="overlay.search" props={{ open, onClose }} />

// 方式二：编程式 —— 需要自己控制容器时
const [SearchPanel] = useSlotComponents("overlay.search");
return SearchPanel ? <SearchPanel open={open} onClose={onClose} /> : null;
```

两者都**订阅内核变更**：插件在运行时注册/卸载后界面会立即重渲染，无需刷新。

#### kind 必须与内置声明一致

同一个 slot 名只能有一种 kind。若内置声明为 `single`，插件却按 `list` 注册，内核会
**拒绝并打印告警**（`[slot-core] slot "x" 已声明为 single，忽略来自 … 的 list 注册。`）。
想往里追加内容时，应该向一个独立的 list slot 注册（如 `sidebar.extras`），
而不是去改已有 slot 的 kind。

#### 观测

- 渲染进程里 `window.__ob_slotcore.snapshot()` 返回全部 slot 的
  `{ name, kind, entries, registrants }`，`window.__ob_builtin_report` 返回
  21 个内置包的逐包装配结果（成功/失败/注册数/耗时）。
- `node scripts/electron/_probe-microkernel.mjs` 在真实 Electron 里断言这套装配。

## 详细说明

### `home.scene.tab`
- **Kind**: `list`（多值追加）
- **Scope**: `root`（跨会话共享）
- **Owner**: `@openbuddy/ui-home`
- **何时触发**：HomePage 渲染 SceneTabs 组件时
- **Payload**:
  ```typescript
  interface HomeSceneTabPayload {
    id: string;            // 唯一 ID，用于 active 状态
    label: string;         // 显示文本
    icon?: ReactNode;      // 可选图标
    onActivate?: () => void; // 点击回调
  }
  ```
- **示例**：注册一个「会议纪要」场景 tab
  ```typescript
  registerSlot('home.scene.tab', 'list', 'root', {
    id: 'meeting-minutes',
    label: '📝 会议纪要',
    onActivate: () => console.log('activated'),
  });
  ```

### `composer.toolbar.action`
- **Kind**: `list`
- **Scope**: `session`（每个会话独立）
- **Owner**: `@openbuddy/ui-conversation`
- **何时触发**：Composer 工具栏渲染时
- **Payload**:
  ```typescript
  interface ComposerToolbarPayload {
    id: string;
    label: string;
    icon: ReactNode;
    onClick: (ctx: ComposerContext) => void;
    disabled?: boolean;
  }
  ```

### `message.toolcall.card`
- **Kind**: `keyed`（按 toolName 唯一）
- **Scope**: `session`
- **Owner**: `@openbuddy/ui-conversation`
- **何时触发**：消息流渲染 tool call 时
- **Payload**:
  ```typescript
  interface MessageToolcallCardPayload {
    toolName: string;
    render: ComponentType<{ args: any; result?: any }>;
  }
  ```

### `sidebar.nav.item`
- **Kind**: `list`
- **Scope**: `root`
- **Owner**: `@openbuddy/ui-sidebar`
- **何时触发**：Sidebar 渲染一级导航时
- **Payload**:
  ```typescript
  interface SidebarNavItemPayload {
    id: string;
    label: string;
    icon: ReactNode;
    page: 'chat' | 'projects' | 'plugins' | (string & {});
  }
  ```

### `workbench.tab`
- **Kind**: `keyed`
- **Scope**: `root`
- **Owner**: `@openbuddy/ui-workbench`
- **何时触发**：工作台（workbench）渲染 tab 栏时
- **Payload**:
  ```typescript
  interface WorkbenchTabPayload {
    tabId: string;
    label: string;
    render: ComponentType;
  }
  ```

### `settings.page`
- **Kind**: `keyed`
- **Scope**: `root`
- **Owner**: `@openbuddy/ui-settings`
- **何时触发**：设置面板渲染左侧导航时
- **Payload**:
  ```typescript
  interface SettingsPagePayload {
    pageId: string;
    label: string;
    render: ComponentType;
  }
  ```

## 校验

`packages/ui/openbuddy-ui-runtime/src/__tests__/extension-points.test.ts` 会扫描 `BUILTIN_UI_APPLIES` 表，验证每个 builtin apply() 至少注册了一个被本表登记的 slot，确保 builtin 装配与公开登记表一致。

## 添加新扩展点

如需添加新 slot：

1. 在 `packages/ui/<owner>/src/client.tsx` 用 `registerSlot(name, kind, scope, payload)` 注册
2. 在本表「总览」新增一行
3. 在「详细说明」章节添加完整 payload interface
4. 跑 `pnpm test extension-points` 校验

## 兼容性

- 本表 `version: 1`
- v1 API 不承诺向后兼容；插件作者应在 manifest 锁定版本
- 后续 v2 将引入 typed payload schema（基于 Zod）
