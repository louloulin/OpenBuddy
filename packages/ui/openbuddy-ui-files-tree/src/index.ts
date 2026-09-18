/**
 * @openbuddy/ui-files-tree — 统一对外入口
 *
 * 文件树层。承载树状文件 / 知识库浏览器(虚拟滚动 + 多选 + 拖拽 + 右键菜单),
 * 对标 cabinet 的 `tree-view.tsx`。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染 (FileTree / FileTreeRow)
 *   - 公共工具 (Utilities)    → 纯函数树工具 (flattenTree / moveNode / canDrop ...)
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";
import type { LazyFileTreeEntry } from "./components/LazyFileTree";

export type { SlotMap };

export { FileTree } from "./components/FileTree";
export { LazyFileTree } from "./components/LazyFileTree";
export type {
  LazyFileTreeProps,
  LazyFileTreeEntry,
} from "./components/LazyFileTree";
export type {
  FileTreeProps,
  FileTreeContextMenuItem,
} from "./components/FileTree";
export { FileTreeRow } from "./components/FileTreeRow";
export type { FileTreeRowProps } from "./components/FileTreeRow";

export {
  flattenTree,
  findNode,
  collectSubtreeIds,
  ancestorsOf,
  rangeSelect,
  canDrop,
  sortNodes,
  sortTree,
  moveNode,
} from "./lib/tree-utils";
export type { TreeNode, TreeNodeId } from "./lib/tree-utils";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * Left tree column inside the files/workbench surface.
     *
     * Props are supplied by the host that renders the column, so any
     * registrant must be able to work from just these. Data access is the
     * registrant's own business — the built-in `LazyFileTree` asks the host
     * for a `loadDir`, a third-party plugin might talk to a remote FS.
     */
    "files.tree": {
      kind: "single";
      scope: "session-maybe";
      owner: {
        rootPath?: string;
        selectedPath?: string;
        onFileSelect(path: string): void;
        onToast?(message: string): void;
        loadDir?(dirPath: string): Promise<LazyFileTreeEntry[]>;
        onReveal?(path: string): void;
      };
    };
  }
}
