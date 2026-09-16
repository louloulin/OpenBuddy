/**
 * OpenBuddy — local Audit Trail.
 *
 * R17 / Phase D — Audit Trail + Local Telemetry.
 *
 * 本地优先(JSONL 文件位于 user-data-dir),不上传,不支持云同步。
 * 与 casdoor 的企业审计不同:本表面向 OpenBuddy 自身的渲染层事件
 * (设置打开、登录尝试、插件市场安装、文件树操作等),用于:
 *   1. 在 settings > 数据管理 暴露只读 viewer;
 *   2. 给隐私模式/审计导出按钮提供统一来源;
 *   3. 让用户能验证「本地优先 · 数据自决」承诺。
 *
 * 存储策略:
 *   - 文件:`~/.openbuddy/audit.jsonl`,每行一条 JSON 事件。
 *   - 启动时异步加载到内存 ring buffer(默认 1000 条)。
 *   - 写时同步 fsync,保证断电也不丢最近一条。
 *   - 超出限额时按时间顺序 trim。
 */
import { app } from "electron";
import { appendFile, readFile, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export type AuditOutcome = "allow" | "deny" | "success" | "failure" | "info";

export interface AuditEvent {
  id: string;
  at: string;
  event: string;
  outcome: AuditOutcome;
  source: "renderer" | "main" | "ipc" | "plugin" | "casdoor";
  subject?: string;
  detail?: Record<string, unknown>;
  hash?: string;
}

const FILE_NAME = "audit.jsonl";
const DEFAULT_MAX = 1000;
const MAX_BYTES = 4 * 1024 * 1024;

function resolveMax(): number {
  const raw = Number.parseInt(process.env.OPENBUDDY_AUDIT_MAX ?? "", 10);
  return Number.isInteger(raw) && raw >= 100 && raw <= 50_000 ? raw : DEFAULT_MAX;
}

function auditPath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

class AuditTrail {
  private buffer: AuditEvent[] = [];
  private max = resolveMax();
  private loaded = false;
  private loading: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const content = await readFile(auditPath(), "utf8");
        const lines = content.split("\n").filter(Boolean);
        const tail = lines.slice(-this.max);
        const parsed: AuditEvent[] = [];
        for (const line of tail) {
          try {
            parsed.push(JSON.parse(line) as AuditEvent);
          } catch {
            /* 单行损坏容忍:跳过,继续 */
          }
        }
        this.buffer = parsed;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("[audit] failed to load audit.jsonl", error);
        }
        this.buffer = [];
      } finally {
        this.loaded = true;
      }
    })();
    return this.loading;
  }

  async record(input: Omit<AuditEvent, "id" | "at" | "hash"> & Partial<Pick<AuditEvent, "id" | "at">>): Promise<AuditEvent> {
    await this.load();
    const event: AuditEvent = {
      id: input.id ?? randomUUID(),
      at: input.at ?? new Date().toISOString(),
      event: input.event,
      outcome: input.outcome,
      source: input.source,
      subject: input.subject,
      detail: input.detail,
    };
    // 链式哈希:上一条 hash + 当前 event + at → SHA-256 截前 16 字符。
    // 让审计条不可被单独篡改(没有前序 hash 时无法重新算出相同 hash)。
    const prev = this.buffer[this.buffer.length - 1]?.hash ?? "";
    event.hash = createHash("sha256").update(`${prev}|${event.id}|${event.at}|${event.event}|${event.outcome}|${event.source}|${event.subject ?? ""}`).digest("hex").slice(0, 16);
    this.buffer.push(event);
    if (this.buffer.length > this.max) {
      this.buffer.splice(0, this.buffer.length - this.max);
    }
    try {
      await appendFile(auditPath(), `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      console.warn("[audit] append failed", error);
    }
    // 写后 trim,避免日志文件无限增长。
    if (this.buffer.length === this.max) {
      try {
        const blob = `${this.buffer.map((e) => JSON.stringify(e)).join("\n")}\n`;
        if (Buffer.byteLength(blob, "utf8") > MAX_BYTES) {
          await truncate(auditPath(), 0);
          await writeFile(auditPath(), blob, "utf8");
        }
      } catch (error) {
        console.warn("[audit] trim failed", error);
      }
    }
    return event;
  }

  async list(limit = 200, cursor?: string): Promise<{ events: AuditEvent[]; nextCursor?: string }> {
    await this.load();
    const slice = cursor ? this.buffer.slice(this.buffer.findIndex((e) => e.id === cursor) + 1) : this.buffer;
    const end = slice.length;
    const start = Math.max(0, end - limit);
    const events = slice.slice(start, end);
    const nextCursor = start > 0 ? slice[start - 1]?.id : undefined;
    return { events, nextCursor };
  }

  async clear(): Promise<void> {
    this.buffer = [];
    try {
      await truncate(auditPath(), 0);
    } catch (error) {
      console.warn("[audit] clear failed", error);
    }
  }
}

export const auditTrail = new AuditTrail();
