# openbuddy-plugin-toolbar

在 Composer 工具栏注入「插入时间戳」按钮。

## 文件清单

- `manifest.json`
- `index.tsx`
- `README.md`

## 行为

加载后，Composer 工具栏出现 🕐 按钮。点击会在光标位置插入当前 ISO 时间戳字符串（`\n[2026-09-15T09:00:00.000Z]\n`）。

## Slot 载荷

`composer.toolbar.action` 接收 `{ id, label, icon, onClick, disabled? }`，其中 `onClick` 收到 `ComposerContext` 对象，包含 `insertText(text)` 等工具方法。
