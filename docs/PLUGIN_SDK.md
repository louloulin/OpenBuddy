# OpenBuddy Plugin SDK v1

> 官方插件开发文档站入口 — 公开契约 + 速记 + 可运行示例。

## 文档地图

| 文档 | 用途 |
|---|---|
| [`docs/EXTENSION_POINTS.md`](./EXTENSION_POINTS.md) | SlotCore 47 槽位审计表(声明 / 注册 / 消费 三方对照) |
| [`docs/PI_EXTENSION_BRIDGE.md`](./PI_EXTENSION_BRIDGE.md) | Pi 扩展市场 IPC 速记 + 第三方索引源接入 |
| [`docs/AUDIT_AND_TELEMETRY.md`](./AUDIT_AND_TELEMETRY.md) | 本地审计 / 遥测三层边界(本地优先卖点) |
| [`docs/EXTENSION_RECIPES.md`](./EXTENSION_RECIPES.md) | 5 个常用场景的 manifest + index.tsx 可运行示例 |
| [`docs/PLUGIN_DEVELOPMENT.md`](./PLUGIN_DEVELOPMENT.md) | 9 步从命名到 PR 的完整流程(双语) |
| [`docs/EXTENSION_GUIDE.md`](./EXTENSION_GUIDE.md) | 扩展概念入门 |
| [`docs/PLUGIN_SYSTEM.md`](./PLUGIN_SYSTEM.md) | 6-surface 架构总览 |
| `packages/runtime/openbuddy-plugin-sdk/src/types.ts` | `openbuddy.plugin.v1` manifest schema 单一真值表 |

## manifest v1 schema 速记

```ts
{
  schema: "openbuddy.plugin.v1",
  name: string,        // 包名,反域:openbuddy-plugin-xxx
  version: string,     // semver
  description: string,
  contributes: {
    slots?: Array<{
      name: string;   // 槽位名,必须在 SlotMap 中声明
      kind: "single"|"list"|"keyed"|"chain";
      scope: "root"|"session"|"session-maybe";
    }>,
    cordis?: Array<{ service: string, factory: string }>,
    pi?:     Array<{ name: string, factory: string }>,
    harness?: Array<{ name: string, factory: string }>,
  }
}
```

SDK 校验失败时拒绝装载并打告警日志;不会把不安全的 manifest 喂给运行时。

## 内置 vs 第三方 贡献边界

| 贡献轨道 | 内置包 | 第三方可写 |
|---|---|---|
| `slots` (UI 扩展点) | 26 个 ui-* 包注册 | ✅ 同样可注册(`api.registerSlot`) |
| `slots` (UI 整体替换) | ui-editor 注册 `editor.body` 默认 | ✅ 高 priority 即可 |
| `cordis` (DI 服务) | cordis runtime 装载 | ✅ `cordis` 字段 |
| `pi` (Pi 扩展工厂) | pi-runtime 注册 | ✅ `pi` 字段 |
| `harness` (DSH 兼容) | 过渡桥接 | ✅ 但已标注 v1.1 不再支持 |

## 入门 5 步

1. 读 [`EXTENSION_POINTS.md`](./EXTENSION_POINTS.md) 找想替换 / 追加的槽位。
2. 选 scope(`root` 跨会话 / `session-maybe` 会话激活时才有内容)。
3. 决定 kind(`single` 可替换 / `list` 追加 / `keyed` 按 key 唯一)。
4. 写 manifest,`slots` 字段声明槽位名 + kind + scope。
5. 写 `index.tsx`:`api.registerSlot(...)` 注册你的实现;详见对应 recipe。

## Recipes 索引(在 [`EXTENSION_RECIPES.md`](./EXTENSION_RECIPES.md))

| # | 场景 | 槽位 |
|---|---|---|
| 1 | 自定义 Composer 工具栏按钮 | `composer.toolbar.action` |
| 2 | 自定义 Sidebar 导航项 | `sidebar.nav.item` |
| 3 | 注册 Slash 命令 | `editor.slash-commands` |
| 4 | 注册 Workbench Tab | `workbench.tab` |
| 5 | 设置面板自定义页面 | `settings.page` |
| **6(R76 新)** | **新草稿编辑器入口(Modal + Tiptap)** | **`editor.draft`** |
| **7(R76 新)** | **接管 Office 三件套预览** | **`workbench.preview.{docx,xlsx,pptx}`** |

### Recipe 6 — 接管「📝 新草稿」入口

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-notion-draft",
  "version": "0.1.0",
  "description": "用 Notion 风格 block 编辑器接管新草稿入点",
  "contributes": {
    "slots": [
      { "name": "editor.draft", "kind": "single", "scope": "root" }
    ]
  }
}
```

```tsx
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: { /* 同上 */ },
  setup: (api) => {
    api.registerSlot("editor.draft", "single", "root", {
      // open / onClose / onApply(markdown) / onCopy?(markdown) / initialMarkdown? / title?
      Component: NotionBlockEditor,    // 必须有上述 props
    });
  },
});
```

### Recipe 7 — 接管 Office 三件套预览

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "openbuddy-plugin-collabora-preview",
  "version": "0.1.0",
  "description": "用 Collabora Online 接管 docx/xlsx/pptx 内嵌预览",
  "contributes": {
    "slots": [
      { "name": "workbench.preview.docx", "kind": "single", "scope": "root" },
      { "name": "workbench.preview.xlsx", "kind": "single", "scope": "root" },
      { "name": "workbench.preview.pptx", "kind": "single", "scope": "root" }
    ]
  }
}
```

```tsx
api.registerSlot("workbench.preview.docx", "single", "root", {
  Component: CollaboraDocxPreview,   // props: { filename, content, fallback, className? }
});
// xlsx / pptx 同理
```

`FilePreview` 自动读槽:有注册就用插件版本,没有就走内置 `DocxPreview /
XlsxPreview / PptxPreview`(基于 docx-preview / SheetJS / pptx-preview)。

## 调试技巧

- `window.openbuddy` 在开发模式下暴露 `__getRegisteredSlots(name)` —
  列出某槽位的所有 entry(registrant / priority / payload 摘要)。
- `scripts/ui-slot-audit.mjs --md` 重新生成登记表,跟 `docs/EXTENSION_POINTS.md`
  对比可发现「注册了没人消费」的死能力。
- `scripts/electron/_probe-*.mjs` 系列是真机探针,UI 行为可视;每个都有配套
  `*.test.mjs` vitest 包装。

## 下一步

- 想替换某块 UI → 选 recipe 改写,`api.registerSlot` 高 priority 即可整体替换。
- 想接 Pi 扩展市场 → [`PI_EXTENSION_BRIDGE.md`](./PI_EXTENSION_BRIDGE.md)。
- 想把审计/遥测作为本地优先卖点 → [`AUDIT_AND_TELEMETRY.md`](./AUDIT_AND_TELEMETRY.md)。
