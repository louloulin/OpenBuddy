import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Settings } from "../services/settings.js";
export type Emit = (event: string, payload: unknown) => void;
export class Permissions {
  private pending = new Map<
    string,
    { sessionId: string; resolve: (allow: boolean) => void }
  >();
  constructor(
    private settings: Settings,
    private emit: Emit,
    private timeoutMs = 120000,
  ) {}
  extension(sessionId: string): ExtensionFactory {
    return (pi) => {
      pi.on("tool_call", async (event) => {
        const allowed = await this.request(
          sessionId,
          event.toolCallId,
          event.toolName,
          event.input,
        );
        return allowed
          ? undefined
          : { block: true, reason: "用户拒绝或权限请求已取消" };
      });
    };
  }
  async request(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
  ): Promise<boolean> {
    const config = this.settings.config.read();
    const rule = config.rules.find(
      (r) =>
        (r.tool === "any" ||
          r.tool === toolName ||
          (r.tool === "mcp" && toolName.startsWith("mcp__"))) &&
        (!r.pattern || JSON.stringify(input).includes(r.pattern)),
    );
    if (rule?.action === "deny") return false;
    if (rule?.action === "allow" || config.permissionMode === "always-approve")
      return true;
    if (
      config.permissionMode === "auto" &&
      ["read", "grep", "find", "ls"].includes(toolName)
    )
      return true;
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      timer.unref?.();
      const finish = (allow: boolean) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(allow);
      };
      this.pending.set(requestId, { sessionId, resolve: finish });
      this.emit("agent://permission", {
        requestId,
        sessionId,
        toolCallId,
        toolKind: toolName,
        title: toolName,
        rawInput: input,
        options: [
          { optionId: "allow", kind: "allow", title: "允许本次" },
          { optionId: "deny", kind: "deny", title: "拒绝" },
        ],
      });
    });
  }
  resolve(id: string, optionId: unknown, cancelled: unknown) {
    const pending = this.pending.get(id);
    if (!pending) throw Error("权限请求不存在或已过期");
    if (!cancelled && !["allow", "deny"].includes(String(optionId)))
      throw Error("无效的权限选项");
    pending.resolve(!cancelled && optionId === "allow");
  }
  cancel(sessionId?: string) {
    for (const item of [...this.pending.values()])
      if (!sessionId || item.sessionId === sessionId) item.resolve(false);
  }
}
