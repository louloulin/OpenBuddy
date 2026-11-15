import { realpath } from "node:fs/promises";
import { fileHandlers } from "@openbuddy/services/files/files";
import { searchFiles } from "@openbuddy/services/files/search";
import { text } from "@openbuddy/services/settings/settings";
import { protocolError } from "@openbuddy/protocol/errors";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `files` module. Workspace file access and shell hand-offs (services/files). */
export function filesModule(ctx: HostContext): HostModule {
  const { options, engine } = ctx;
  const commands: Record<string, Handler> = {
    ...fileHandlers(options.shell, () => engine.currentCwd),
    // 20261116-pii W1.3 `@` mention. Only the workspace of a live task (or the inbox) can be listed;
    // the desktop IPC layer also requires a native workspace grant for `cwd`.
    files_search: async (p) => {
      const cwd = await realpath(text(p.cwd, "cwd")).catch(() => "");
      const roots = await Promise.all(engine.previewRoots().map((root) => realpath(root).catch(() => root)));
      if (!cwd || !roots.includes(cwd)) throw protocolError("workspace_not_authorized", "只能在已打开任务的工作空间里查找文件");
      return searchFiles(cwd, typeof p.query === "string" ? p.query : "", typeof p.limit === "number" ? p.limit : undefined);
    },
  };
  return { id: "files", commands };
}
