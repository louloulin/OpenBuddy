/**
 * @openbuddy/ui-files-tree/client — apply() registers LazyFileTree on `files.tree`.
 *
 * 注册的是 `<LazyFileTree>` 而不是 `<FileTree>`:`files.tree` 是「左侧文件树
 * 这一列」的槽,宿主只会给它 `rootPath / selectedPath / onFileSelect`,不会
 * 把整棵已经加载好的节点树交给它。`<FileTree>` 是全受控的纯渲染器(需要
 * `nodes`),放进槽里只会渲染出一棵空树。
 *
 * `LazyFileTree` 自己不做 I/O:目录加载器由宿主通过 `loadDir` 传入,所以这个
 * 包不依赖任何文件系统协议(本地 IPC / 远端 FS / 虚拟 FS)。第三方想接管整列
 * (自带数据源)时,以更高 priority 注册同名单例槽即可。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { LazyFileTree } from "./components/LazyFileTree";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    {
      name: "files.tree",
      kind: "single",
      scope: "session-maybe",
      registrant: "@openbuddy/ui-files-tree",
    },
    LazyFileTree as never,
  );
  return dispose;
}
