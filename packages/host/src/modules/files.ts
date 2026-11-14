import { fileHandlers } from "@openbuddy/services/files/files";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `files` module. Workspace file access and shell hand-offs (services/files). */
export function filesModule(ctx: HostContext): HostModule {
  const { options, engine } = ctx;
  const commands: Record<string, Handler> = {
    ...fileHandlers(options.shell, () => engine.currentCwd),
  };
  return { id: "files", commands };
}
