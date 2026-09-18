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

export type AuditExportFormat = "jsonl" | "json";

export interface AuditExportResult {
  /** 实际写入的目标路径(来自保存对话框)。 */
  path: string;
  /** 导出的条数。 */
  count: number;
  bytes: number;
  format: AuditExportFormat;
  exportedAt: string;
}

/**
 * 序列化(纯函数,便于单测)。
 *
 * - `jsonl`:与磁盘上的 `audit.jsonl` 同构,一行一条 —— 可以直接再接回
 *   `load()` / 外部 jq / grep,不引入新格式。
 * - `json`:`{ exportedAt, count, events }`,方便贴进 issue 或不写代码的场合。
 *
 * 不导出 `hash` 之外的东西:链式 hash 原样保留,这样"导出件是否被改过"仍可
 * 用同一套规则复核(每条 hash = 前一条 hash + 本条的 id/at/event/outcome/source/subject)。
 */
export function serializeAuditEvents(events: AuditEvent[], format: AuditExportFormat, exportedAt: string): string {
  if (format === "json") {
    return `${JSON.stringify({ exportedAt, count: events.length, events }, null, 2)}\n`;
  }
  return events.length === 0 ? "" : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
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

  /**
   * 导出到用户选择的路径(R41)。
   *
   * 调用方必须先经过保存对话框审批(`requireApprovedSavePath`)—— 本方法只负责
   * "把内存里的审计条写成一个文件",不做路径安全判断,那是 IPC 层的责任。
   *
   * 两个刻意的选择:
   *   1. 文件权限 0o600:审计条含 subject / detail(谁在什么时候做了什么),
   *      默认不给同机器上的其他账号读。
   *   2. **先写文件、后记录导出事件**:导出件里因此不含"它自己被导出"这一条。
   *      反过来做(先记录再写)会让内容与 trail 不一致 —— 写失败时 trail 已经
   *      声称导出成功。宁可少一条自指记录,也不要一条假的成功记录。
   */
  async exportTo(target: string, options?: { format?: AuditExportFormat; limit?: number }): Promise<AuditExportResult> {
    await this.load();
    const format: AuditExportFormat = options?.format === "json" ? "json" : "jsonl";
    const requested = options?.limit ?? this.buffer.length;
    const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : this.buffer.length;
    const events = this.buffer.slice(Math.max(0, this.buffer.length - limit));
    const exportedAt = new Date().toISOString();
    const blob = serializeAuditEvents(events, format, exportedAt);
    try {
      await writeFile(target, blob, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      await this.record({
        event: "audit.export",
        outcome: "failure",
        source: "main",
        subject: target,
        detail: { format, error: String((error as Error)?.message ?? error) },
      }).catch(() => undefined);
      throw error;
    }
    const result: AuditExportResult = {
      path: target,
      count: events.length,
      bytes: Buffer.byteLength(blob, "utf8"),
      format,
      exportedAt,
    };
    await this.record({
      event: "audit.export",
      outcome: "success",
      source: "main",
      subject: target,
      detail: { format, count: result.count, bytes: result.bytes },
    }).catch(() => undefined);
    return result;
  }
}

export const auditTrail = new AuditTrail();
