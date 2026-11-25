import { stat } from "node:fs/promises";
import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `artifacts` module. Session artifacts, checkpoints and turn revert. */
export function artifactsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    artifacts_list: (p) => engine.artifacts(text(p.sessionId)),
    // G3-5 任务成果聚合: 跨会话汇总**磁盘上的** checkpoint 索引。
    // 不要求会话已加载（引擎只在有活动会话时把产物挂在内存里），也不会改动任何文件。
    artifacts_workspace_list: async (p) => {
      type Row = { sessionId: string; sessionTitle: string; path: string; lastAt: number; size?: number; exists: boolean };
      const collect = async (sessions: Array<{ sessionId: string; title: string }>) => {
        const rows: Row[] = [];
        for (const session of sessions.slice(0, 40)) {
          let records;
          try {
            records = await engine.checkpointList(session.sessionId);
          } catch {
            continue;
          }
          const byPath = new Map<string, number>();
          for (const record of records) {
            if (record.after === null) continue; // 这次改写删掉了文件
            byPath.set(record.path, record.at);
          }
          for (const [path, lastAt] of byPath) {
            let exists = true;
            let size: number | undefined;
            try {
              const stat_ = await stat(path);
              exists = stat_.isFile();
              size = stat_.size;
            } catch {
              exists = false;
            }
            rows.push({ sessionId: session.sessionId, sessionTitle: session.title, path, lastAt, size, exists });
          }
        }
        // 同一路径只保留最近的一次（跨任务去重）。
        const seen = new Map<string, Row>();
        for (const row of rows) {
          const prev = seen.get(row.path);
          if (!prev || row.lastAt > prev.lastAt) seen.set(row.path, row);
        }
        return [...seen.values()].sort((a, b) => b.lastAt - a.lastAt);
      };
      // 「任务成果」是跨任务的：不按当前空间过滤，否则从首页进来的用户什么都看不到。
      const all = (await engine.all()).map((s) => ({
        sessionId: s.id,
        title: engine.settings.config.read().sessions[s.id]?.title ?? s.name ?? "未命名任务",
      }));
      return collect(all);
    },
    checkpoint_list: (p) => engine.checkpointList(text(p.sessionId), typeof p.path === "string" ? p.path : undefined),
    checkpoint_read: (p) => engine.checkpointRead(text(p.sessionId), text(p.hash)),
    checkpoint_restore: (p) => engine.checkpointRestore(text(p.sessionId), text(p.path), typeof p.hash === "string" ? p.hash : null),
    turn_revert: (p) => engine.turnRevert(text(p.sessionId), p.toolCallIds as string[], { skip: Array.isArray(p.skip) ? (p.skip as string[]) : undefined, force: p.force === true }),
    artifact_save: (p) => engine.artifactSave(text(p.sessionId), text(p.path), String(p.content), p.origin === "apply" ? "apply" : "user"),
  };
  return { id: "artifacts", commands };
}
