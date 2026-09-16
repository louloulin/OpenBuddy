# @openbuddy/ui-files-tree

树状文件 / 知识库浏览器。对标 cabinet 的 `tree-view.tsx`,提供:

- 虚拟滚动(仅渲染可见节点) — 10k+ 节点不卡顿
- 多选(Cmd/Ctrl + 点击,Shift 范围选择)
- 拖拽排序 / 移动(HTML5 drag-and-drop,通过 `onMove` 回调交给宿主)
- 右键上下文菜单(宿主可注入 menu items)
- 内联重命名 / 新建节点
- 键盘导航(↑/↓ 移动,←/→ 折叠展开,Enter 打开)

注册到 `files.tree` slot,由 `@openbuddy/ui-files` 或第三方插件消费。

## 契约

`apply(ctx)` 只注册 slot;组件通过 props 消费数据。宿主负责:
- 拉取树数据并传入 `nodes`
- 处理 `onOpen` / `onMove` / `onRename` / `onCreate` / `onDelete`
- 可选注入 `renderContextMenu`

```tsx
<FileTree
  nodes={tree}
  selectedIds={selected}
  onSelect={setSelected}
  onOpen={(node) => openFile(node.path)}
  onMove={(src, dest) => moveNode(src, dest)}
/>
```
