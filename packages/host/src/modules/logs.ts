import { join } from "node:path";
import { LogReader } from "@openbuddy/services/support/log-reader";
import type { HostContext, HostModule } from "../module.js";

/**
 * 运行日志 (O1): the main process writes JSONL under `<userData>/logs`; these commands let the
 * settings panel list and read those files. The path is derived from the host's userData dir — the
 * renderer only ever names a file that the logger itself created.
 */
export function logsModule(ctx: HostContext): HostModule {
  const reader = () => new LogReader(logsDir(ctx));
  return {
    id: "logs",
    commands: {
      logs_list: () => reader().list(),
      logs_read: (p) =>
        reader().read(p.name, {
          limit: typeof p.limit === "number" ? p.limit : undefined,
          level: typeof p.level === "string" ? p.level : undefined,
          query: typeof p.query === "string" ? p.query : undefined,
        }),
    },
  };
}

/** `<userData>/logs`, matching the writer in the desktop main process. */
function logsDir(ctx: HostContext): string {
  return join(ctx.options.userDataDir ?? process.cwd(), "logs");
}
