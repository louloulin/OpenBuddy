/**
 * 启动自检 (20261127-upup §1.18)：对标 WorkBuddy 的 self-check，但只查 OpenBuddy 自己会出问题的地方：
 * 磁盘、数据目录可写、内置应用完整、最近崩溃、模型配置与连通、扩展加载、系统信息。
 *
 * 每项独立超时，单项失败不影响其它项；报告经 sanitizeDiagnostics 去掉绝对路径与密钥，只落本地。
 */
import { existsSync, promises as fs } from "node:fs";
import { cpus, freemem, release, totalmem } from "node:os";
import { join } from "node:path";
import { sanitizeDiagnostics } from "./diagnostics";

export type SelfCheckStatus = "pass" | "warning" | "fail" | "info";

export interface SelfCheckResult {
  id: string;
  title: string;
  status: SelfCheckStatus;
  summary: string;
  detail?: string;
  advice?: string;
  costMs: number;
}

export interface SelfCheckItem {
  id: string;
  title: string;
  timeoutMs?: number;
  run(): Promise<Omit<SelfCheckResult, "id" | "title" | "costMs">>;
}

export interface SelfCheckReport {
  results: SelfCheckResult[];
  counts: Record<SelfCheckStatus, number>;
  durationMs: number;
  checkedAt: string;
}

const GB = 1024 ** 3;

export async function runSelfCheck(items: SelfCheckItem[], now: () => number = Date.now): Promise<SelfCheckReport> {
  const started = now();
  const results = await Promise.all(items.map(async (item): Promise<SelfCheckResult> => {
    const begin = now();
    const timeoutMs = item.timeoutMs ?? 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        item.run(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs); }),
      ]);
      return { id: item.id, title: item.title, ...outcome, costMs: now() - begin };
    } catch (error) {
      return {
        id: item.id, title: item.title, status: "fail",
        summary: `检测出错：${error instanceof Error ? error.message : String(error)}`,
        costMs: now() - begin,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }));
  const counts: Record<SelfCheckStatus, number> = { pass: 0, warning: 0, fail: 0, info: 0 };
  for (const result of results) counts[result.status] += 1;
  return { results, counts, durationMs: now() - started, checkedAt: new Date(started).toISOString() };
}

const LABEL: Record<SelfCheckStatus, string> = { pass: "通过", warning: "警告", fail: "失败", info: "信息" };

export function formatSelfCheckReport(report: SelfCheckReport, app = "OpenBuddy"): string {
  const lines = [
    "# OpenBuddy 启动自检",
    `应用：${app}`,
    `检测时间：${report.checkedAt}`,
    `检测耗时：${(report.durationMs / 1000).toFixed(1)} s`,
    "",
  ];
  for (const r of report.results) {
    lines.push(`[${LABEL[r.status]}] ${r.title}：${r.summary}（${r.costMs} ms）`);
    if (r.detail) lines.push(...r.detail.split("\n").map((line) => `    ${line}`));
    if (r.advice) lines.push(`    建议：${r.advice}`);
  }
  const c = report.counts;
  lines.push("", `汇总：${c.pass} 通过 / ${c.warning} 警告 / ${c.fail} 失败 / ${c.info} 信息（共 ${report.results.length} 项）`);
  return sanitizeDiagnostics(lines.join("\n"));
}

/** 写到 <dir>/self-check-<时间>.txt，只保留最近 keep 份。返回文件名（不含路径）。 */
export async function saveSelfCheckReport(dir: string, text: string, options: { keep?: number; now?: number } = {}): Promise<string> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date(options.now ?? Date.now()).toISOString().replace(/[:.]/g, "-");
  const name = `self-check-${stamp}.txt`;
  await fs.writeFile(join(dir, name), text, { mode: 0o600 });
  const old = (await fs.readdir(dir)).filter((f) => f.startsWith("self-check-") && f.endsWith(".txt")).sort().reverse().slice(options.keep ?? 10);
  await Promise.all(old.map((f) => fs.rm(join(dir, f), { force: true })));
  return name;
}

export function diskSpaceCheck(dir: string, statfs: (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }> = fs.statfs): SelfCheckItem {
  return {
    id: "system.disk", title: "磁盘空间",
    async run() {
      const stat = await statfs(dir);
      const free = Number(stat.bavail) * Number(stat.bsize);
      const summary = `数据目录所在磁盘剩余 ${(free / GB).toFixed(1)} GB`;
      if (free < GB) return { status: "fail", summary, advice: "磁盘空间不足 1 GB，会话、日志和应用数据可能写入失败，请清理磁盘" };
      if (free < 5 * GB) return { status: "warning", summary, advice: "剩余不足 5 GB，建议清理磁盘" };
      return { status: "pass", summary };
    },
  };
}

export function writableCheck(dir: string): SelfCheckItem {
  return {
    id: "data.writable", title: "数据目录可写",
    async run() {
      const probe = join(dir, `.self-check-${process.pid}`);
      try {
        await fs.writeFile(probe, "ok");
        if ((await fs.readFile(probe, "utf8")) !== "ok") throw new Error("读回内容不一致");
      } catch (error) {
        return { status: "fail", summary: `写入失败：${error instanceof Error ? error.message : String(error)}`, advice: "检查数据目录的权限，或是否被安全软件拦截" };
      } finally {
        await fs.rm(probe, { force: true }).catch(() => undefined);
      }
      return { status: "pass", summary: "读写正常" };
    },
  };
}

/** 内置应用 (§1.15) 是否完整：目录、package.json、node_modules、版本标记。 */
export function bundledAppsCheck(dirs: string[], readVersion: (dir: string) => { version?: string; commit?: string } | undefined): SelfCheckItem {
  return {
    id: "apps.bundled", title: "内置应用",
    async run() {
      if (dirs.length === 0) return { status: "info", summary: "本构建没有内置应用" };
      const lines: string[] = [];
      let status: SelfCheckStatus = "pass";
      for (const dir of dirs) {
        const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
        if (!existsSync(join(dir, "package.json"))) { status = "fail"; lines.push(`${name}：目录缺失`); continue; }
        if (!existsSync(join(dir, "node_modules"))) { status = "fail"; lines.push(`${name}：缺少依赖（node_modules）`); continue; }
        const marker = readVersion(dir);
        if (!marker?.commit) { if (status === "pass") status = "warning"; lines.push(`${name}：缺少版本标记`); continue; }
        lines.push(`${name}：${marker.version ?? "?"} · ${marker.commit.slice(0, 7)}`);
      }
      return {
        status,
        summary: lines.join("；"),
        ...(status === "fail" ? { advice: "安装包不完整，请重新安装 OpenBuddy（开发态先运行 pnpm bundle:upup）" } : {}),
      };
    },
  };
}

const BENIGN = [/\bEPIPE\b/, /\bECONNRESET\b/, /ERR_STREAM_WRITE_AFTER_END/, /ERR_STREAM_DESTROYED/, /Object has been destroyed/i, /Render frame was disposed/i];
const CRASH_REASONS = new Set(["crashed", "oom", "launch-failed", "integrity-failure"]);

interface LogRecord { ts?: string; level?: string; scope?: string; message?: string; data?: Record<string, unknown> }

/** 把一条结构化日志归为需要关注的崩溃类型；良性的（正常退出、卡死快照、EPIPE 之类）返回 undefined。 */
export function crashKind(record: LogRecord): string | undefined {
  const data = record.data ?? {};
  const message = typeof data.message === "string" ? data.message : "";
  switch (record.message) {
    case "uncaughtException":
    case "unhandledRejection":
      return BENIGN.some((re) => re.test(message)) ? undefined : "主进程异常";
    case "startup-failed":
      return "启动失败";
    case "render-process-gone":
      return CRASH_REASONS.has(String(data.reason)) ? "界面崩溃" : undefined;
    case "child-process-gone":
      return CRASH_REASONS.has(String(data.reason)) ? `子进程崩溃（${String(data.type ?? "?")}）` : undefined;
    case "native-crash-dump":
      return record.level === "error" ? "原生崩溃" : undefined;
    default:
      return undefined;
  }
}

/** 最近 days 天的结构化日志里有哪些需要关注的崩溃。 */
export function crashLogCheck(logDir: string, options: { days?: number; now?: () => number } = {}): SelfCheckItem {
  return {
    id: "env.crash_log", title: "最近崩溃记录",
    async run() {
      const now = (options.now ?? Date.now)();
      const days = options.days ?? 7;
      const cutoff = now - days * 86_400_000;
      let names: string[] = [];
      try { names = (await fs.readdir(logDir)).filter((f) => f.startsWith("openbuddy-") && /\.log(?:\.\d+)?$/.test(f)); } catch { /* no logs yet */ }
      const hits: Array<{ at: number; kind: string; text: string }> = [];
      for (const name of names) {
        const path = join(logDir, name);
        if ((await fs.stat(path)).mtimeMs < cutoff) continue;
        for (const line of (await fs.readFile(path, "utf8")).split("\n")) {
          if (!line.includes("gone") && !line.includes('"level":"error"')) continue;
          let record: LogRecord;
          try { record = JSON.parse(line) as LogRecord; } catch { continue; }
          const at = Date.parse(record.ts ?? "");
          if (!(at >= cutoff)) continue;
          const kind = crashKind(record);
          if (!kind) continue;
          const data = record.data ?? {};
          const reason = [data.reason, data.message, (data.summary as { exceptionName?: string } | undefined)?.exceptionName].find((v) => typeof v === "string") as string | undefined;
          hits.push({ at, kind, text: reason ? reason.slice(0, 200) : "" });
        }
      }
      if (hits.length === 0) return { status: "pass", summary: `最近 ${days} 天没有崩溃` };
      hits.sort((a, b) => b.at - a.at);
      const byKind = new Map<string, number>();
      for (const hit of hits) byKind.set(hit.kind, (byKind.get(hit.kind) ?? 0) + 1);
      const detail = hits.slice(0, 5).map((h) => `[${new Date(h.at).toISOString()}] ${h.kind}${h.text ? `：${h.text}` : ""}`);
      if (hits.length > 5) detail.push(`……另有 ${hits.length - 5} 条`);
      return {
        status: "warning",
        summary: `最近 ${days} 天 ${hits.length} 次：${[...byKind].map(([k, n]) => `${k} ${n}`).join("，")}`,
        detail: detail.join("\n"),
        advice: "反复出现时，在「帮助与反馈」生成诊断报告并附上日志",
      };
    },
  };
}

export function systemInfoCheck(versions: Record<string, string | undefined> = {}): SelfCheckItem {
  return {
    id: "env.system_info", title: "系统信息",
    async run() {
      const v = Object.entries(versions).filter(([, value]) => value).map(([key, value]) => `${key} ${value}`).join("，");
      return {
        status: "info",
        summary: `${process.platform} ${release()} ${process.arch}，${cpus().length} 核，内存 ${(totalmem() / GB).toFixed(1)} GB（可用 ${(freemem() / GB).toFixed(1)} GB）${v ? `，${v}` : ""}`,
      };
    },
  };
}
