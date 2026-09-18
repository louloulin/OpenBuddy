/**
 * 文件树视图 —— 对齐 WorkBuddy `context-viewer-components/DetailPanel/FileTree`。
 *
 * 左列:可展开/折叠的目录树(懒加载 `listDir`,展开时按需拉取子目录)。
 * 选中文件由父组件通过 onFileSelect 回调驱动主区域预览。
 *
 * 渲染本身交给 `@openbuddy/ui-files-tree` 的 `<LazyFileTree>`:它带虚拟滚动
 * (只挂载视口附近的约 20 行,万级节点不卡)、多选、键盘导航(↑↓←→ / Enter /
 * Home / End / ⌘A)、右键菜单(打开 / 复制路径 / 在文件夹中显示 / 刷新)与
 * 聚焦环。之前这里手写的递归渲染既没有虚拟化,也没有键盘可达性。
 *
 * 这个文件只负责把「应用侧 I/O」接进去 —— `listDir` 与 `shellfs:reveal`。
 * 这两个绑定都可以被覆盖:宿主把 `files.tree` 槽渲染成 `<LazyFileTree>` 时,
 * 它需要的是同一对回调,于是这里既是 ui-workbench 的默认实现,也是
 * `files.tree` 槽的 fallback。
 *
 * 根目录取 cwd(会话工作区)。隐藏/构建目录已在后端过滤。
 *
 * 说明:拖拽移动暂未打开。`LazyFileTree` 只在拿到 `onMove` 时才让行可拖动,
 * 而当前 IPC 面里没有重命名/移动的通道 —— 与其画一个拖了没反应的落点,
 * 不如先不给这个手势。
 */
import { useCallback } from "react";
import type { ComponentType } from "react";
import { invoke } from "@/lib/platform/electron-api";
import { listDir } from "@/lib/agent/pi-client";
import { LazyFileTree } from "@openbuddy/ui-files-tree";
import type { LazyFileTreeEntry } from "@openbuddy/ui-files-tree";

export interface FileTreeViewProps {
  /** 工作区根目录(绝对路径)。 */
  rootPath?: string;
  /** 当前选中的文件路径(高亮)。 */
  selectedPath?: string;
  /** 选中文件回调。 */
  onFileSelect: (path: string) => void;
  /** 错误/提示回调。 */
  onToast?: (msg: string) => void;
  /** 覆盖内置的 `listDir` 绑定(供 `files.tree` 槽复用本组件时使用)。 */
  loadDir?: (dirPath: string) => Promise<LazyFileTreeEntry[]>;
  /** 覆盖内置的「在文件夹中显示」绑定。 */
  onReveal?: (path: string) => void;
}

export function FileTreeView({
  rootPath,
  selectedPath,
  onFileSelect,
  onToast,
  loadDir,
  onReveal,
}: FileTreeViewProps) {
  const boundLoadDir = useCallback(
    (dirPath: string) => listDir(dirPath),
    [],
  );
  const boundReveal = useCallback(
    (path: string) => {
      void invoke("reveal_in_folder", {
        path,
        cwd: rootPath ?? null,
      }).catch((e: unknown) => {
        onToast?.(`无法在文件夹中显示:${String(e).replace(/^Error:\s*/, "")}`);
      });
    },
    [onToast, rootPath],
  );

  return (
    <LazyFileTree
      rootPath={rootPath}
      loadDir={loadDir ?? boundLoadDir}
      selectedPath={selectedPath}
      onFileSelect={onFileSelect}
      onReveal={onReveal ?? boundReveal}
      onToast={onToast}
    />
  );
}

/**
 * `files.tree` 槽渲染时宿主需要提供的 props 形状。
 *
 * 放在这里是为了让「槽的实现」和「槽的消费方」共用同一个契约:ui-workbench
 * 的 `FileTreeView` 与 ui-files-tree 的 `LazyFileTree` 都满足它。
 */
export type FileTreeSlotComponent = ComponentType<FileTreeViewProps>;
