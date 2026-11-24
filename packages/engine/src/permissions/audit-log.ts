import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 安全审计日志 (G2-5)：工具调用、权限决策、策略变更写成 JSONL，一行一条。
 *
 * 落盘在 OpenBuddy 数据目录下的 `security/audit.jsonl`（与设置同目录，便于用户直接查看/备份）。
 * 写入是**追加**的，不做任何网络上报；读取时按行反序列化，坏行跳过。
 */

export type AuditAction =
  | "tool-allow"
  | "tool-deny"
  | "tool-ask"
  | "tool-resolve"
  | "policy-deny"
  | "policy-change"
  | "skill-review"
  | "tool-content-blocked"
  | "tool-content-allowed";

export interface AuditEvent {
  /** ISO 时间戳。 */
  ts: string;
  sessionId?: string;
  tool?: string;
  action: AuditAction;
  /** 被操作的对象：路径 / 命令 / 域名。 */
  target?: string;
  /** 决定原因（可读文本）。 */
  reason?: string;
  /** 谁做的决定：user / policy / system。 */
  actor?: string;
}

export class AuditLog {
  constructor(private readonly file: string) {}

  private ensureDir(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** 追加一条事件；写盘失败不影响主流程（安全日志不能拖垮对话）。 */
  append(event: AuditEvent): void {
    try {
      this.ensureDir();
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      /* 审计写盘失败不阻断工具调用 */
    }
  }

  /** 读最近的若干条（倒序返回，最新的在前）。 */
  read(limit = 200): AuditEvent[] {
    try {
      if (!existsSync(this.file)) return [];
      const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
      const out: AuditEvent[] = [];
      for (const line of lines.slice(-limit * 4)) {
        try {
          out.push(JSON.parse(line) as AuditEvent);
        } catch {
          /* 坏行跳过 */
        }
      }
      return out.reverse().slice(0, limit);
    } catch {
      return [];
    }
  }
}
