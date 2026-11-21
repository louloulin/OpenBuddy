import { useEffect, useState } from "react";
import { ClipboardCopy, Download, ExternalLink, FolderOpen, RefreshCw, ScrollText, Stethoscope } from "lucide-react";
import { agentDiagnose, exportTextFile, saveFileDialog } from "@openbuddy/client/agent-client";
import { openPath } from "@openbuddy/client/api/files";
import { logsList, logsRead, type LogEntry, type LogLevel, type LogList } from "@openbuddy/client/api/logs";
import { copyText } from "@openbuddy/platform/clipboard";
import { APP_VERSION } from "@/app/app-version";
import { SectionShell } from "./shared";

/**
 * 帮助与反馈 (20261116-pii W6.5)。
 *
 * 诊断在本地生成、本地脱敏（无 API Key、无绝对路径），先预览再由用户复制或保存，
 * 不会自动上传；「让模型写一段问题摘要」会把当前会话交给模型，摘要之外的内容留在本机。
 */
export function HelpSettingsPanel() {
  const [hint, setHint] = useState("");
  const [feedback, setFeedback] = useState("");
  const [includeSummary, setIncludeSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [logList, setLogList] = useState<LogList | null>(null);
  const [logName, setLogName] = useState("");
  const [logLevel, setLogLevel] = useState<LogLevel | "all">("all");
  const [logQuery, setLogQuery] = useState("");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logMeta, setLogMeta] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSaved, setLogSaved] = useState<string | null>(null);

  const readLog = async (name: string, level: LogLevel | "all" = logLevel, query = logQuery) => {
    if (!name) { setLogEntries([]); setLogMeta(""); return; }
    setLogBusy(true);
    setLogError(null);
    try {
      const result = await logsRead(name, { level, query, limit: 300 });
      setLogEntries(result.entries);
      setLogMeta(`${result.entries.length} 条${result.truncated ? "（已截断，显示最近部分）" : ""}${result.malformed ? ` · ${result.malformed} 行无法解析` : ""}`);
    } catch (e) {
      setLogError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setLogBusy(false);
    }
  };

  const refreshLogs = async (name = logName) => {
    setLogError(null);
    try {
      const next = await logsList();
      setLogList(next);
      const pick = name === "all" || (name && next.files.some((file) => file.name === name)) ? name : next.files[0]?.name ?? "";
      setLogName(pick);
      await readLog(pick);
    } catch (e) {
      setLogError(String(e).replace(/^Error:\s*/, ""));
    }
  };

  // Load once when the panel opens; the viewer stays read-only and local.
  useEffect(() => { void refreshLogs(); }, []);

  /** 导出为本地 .txt：合并全部日志文件，先脱敏再交给用户保存。 */
  const exportLogs = async () => {
    if (logBusy) return;
    setLogBusy(true);
    setLogError(null);
    setLogSaved(null);
    try {
      const all = await logsRead("all", { level: logLevel, query: logQuery, limit: 2000 });
      const text = all.entries
        .map((entry) => [entry.ts ?? "", entry.level ?? "info", entry.scope ?? "app", entry.message, entry.data === undefined ? "" : JSON.stringify(entry.data)].join("\t"))
        .join("\n");
      const path = await saveFileDialog({
        defaultPath: `openbuddy-logs-${new Date().toISOString().slice(0, 10)}.txt`,
        filters: [{ name: "文本", extensions: ["txt"] }],
      });
      if (!path) return;
      await exportTextFile(path, text);
      setLogSaved(`日志已导出到 ${path}`);
    } catch (e) {
      setLogError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setLogBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await agentDiagnose({
        app: `OpenBuddy ${APP_VERSION}`,
        ...(hint.trim() ? { hint: hint.trim() } : {}),
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        includeSummary,
      });
      const text = [result.diagnostics, result.summary ? `\n## 模型摘要\n${result.summary}` : ""].join("");
      setReport(text.trim());
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    await copyText(report);
    setSaved("已复制到剪贴板");
  };

  const save = async () => {
    if (!report) return;
    const path = await saveFileDialog({
      defaultPath: "openbuddy-diagnostics.txt",
      filters: [{ name: "文本", extensions: ["txt"] }],
    });
    if (!path) return;
    await exportTextFile(path, report);
    setSaved(`已保存到 ${path}`);
  };

  return (
    <SectionShell title="帮助与反馈" desc="常用链接、问题排查与本地诊断报告。">
      <ul className="help-list">
        <li>
          <ExternalLink size={14} />
          <a href="https://github.com/louloulin/OpenBuddy/blob/main/docs/user-guide.md" target="_blank" rel="noreferrer">
            用户手册
          </a>
          <span className="help-list__hint">（15 分钟完成第一个任务）</span>
        </li>
        <li>
          <ExternalLink size={14} />
          <a href="https://github.com/louloulin/OpenBuddy/blob/main/docs/faq.md" target="_blank" rel="noreferrer">
            常见问题
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <a href="https://github.com/louloulin/OpenBuddy/blob/main/docs/troubleshooting.md" target="_blank" rel="noreferrer">
            故障排查
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <a href="https://github.com/louloulin/OpenBuddy/blob/main/docs/privacy.md" target="_blank" rel="noreferrer">
            隐私说明
          </a>
          <span className="help-list__hint">·</span>
          <a href="https://github.com/louloulin/OpenBuddy/blob/main/docs/release-notes.md" target="_blank" rel="noreferrer">
            更新说明
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <a href="https://github.com/badlogic/pi-mono/" target="_blank" rel="noreferrer">
            Pi SDK 文档
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <span>
            引擎包：<code>@earendil-works/pi-coding-agent</code>
          </span>
        </li>
      </ul>

      <div className="diag-card">
        <div className="diag-card__head">
          <div className="sec-card__title">
            <Stethoscope size={15} />
            <span>诊断与反馈</span>
          </div>
          <div className="sec-card__hint">
            报告在本机生成并脱敏（不含 API Key 与绝对路径），先预览，再由你复制或保存；不会自动上传。
          </div>
        </div>
        <div className="diag-card__body">
          <label className="diag-field">
            <span>问题描述（可选）</span>
            <textarea value={hint} onChange={(e) => setHint(e.target.value)} placeholder="例如：点「导出为 JSONL」没有反应" rows={2} />
          </label>
          <label className="diag-field">
            <span>附带的反馈（可选，会写进报告）</span>
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="复现步骤、期望结果……" rows={2} />
          </label>
          <label className="diag-check">
            <input type="checkbox" checked={includeSummary} onChange={(e) => setIncludeSummary(e.target.checked)} />
            <span>让模型为当前会话写一段问题摘要（会话内容会发给模型提供商）</span>
          </label>
          <div className="diag-actions">
            <button type="button" className="sec-btn sec-btn--ink" onClick={() => void generate()} disabled={busy}>
              <Stethoscope size={14} /> {busy ? "生成中…" : "生成诊断报告"}
            </button>
            <button type="button" className="sec-btn" onClick={() => void copy()} disabled={!report}>
              <ClipboardCopy size={14} /> 复制
            </button>
            <button type="button" className="sec-btn" onClick={() => void save()} disabled={!report}>
              <Download size={14} /> 保存为 .txt
            </button>
          </div>
          {error && <div className="sec-error">{error}</div>}
          {saved && <p className="diag-status">{saved}</p>}
          {report && <pre className="diag-preview">{report}</pre>}
        </div>
      </div>

      <div className="diag-card">
        <div className="diag-card__head">
          <div className="sec-card__title">
            <ScrollText size={15} />
            <span>运行日志</span>
          </div>
          <div className="sec-card__hint">
            主进程按日写入本机 JSONL，写盘前已脱敏（不含 API Key、邮箱与绝对路径）。这里只读取，不会上传。
          </div>
        </div>
        <div className="diag-card__body">
          {logError && <div className="sec-error" role="alert">{logError}</div>}
          {!logList ? (
            <p className="diag-status">正在读取日志…</p>
          ) : logList.files.length === 0 ? (
            <p className="diag-status">还没有日志文件。应用出现异常或渲染进程报错后会在这里生成。</p>
          ) : <>
            <div className="log-toolbar">
              <select
                className="log-select"
                aria-label="选择日志文件"
                value={logName}
                onChange={(e) => { setLogName(e.target.value); void readLog(e.target.value, logLevel, logQuery); }}
              >
                <option value="all">全部文件（合并，跨文件检索）</option>
                {logList.files.map((file) => (
                  <option key={file.name} value={file.name}>{file.name} · {formatBytes(file.size)}</option>
                ))}
              </select>
              <select
                className="log-select"
                aria-label="日志级别"
                value={logLevel}
                onChange={(e) => { const level = e.target.value as LogLevel | "all"; setLogLevel(level); void readLog(logName, level, logQuery); }}
              >
                <option value="all">全部级别</option>
                <option value="error">error</option>
                <option value="warn">warn</option>
                <option value="info">info</option>
                <option value="debug">debug</option>
              </select>
              <input
                className="log-search"
                aria-label="搜索日志"
                placeholder="搜索消息 / 作用域"
                value={logQuery}
                spellCheck={false}
                onChange={(e) => setLogQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void readLog(logName, logLevel, logQuery); }}
              />
              <button type="button" className="sec-btn" onClick={() => void readLog(logName, logLevel, logQuery)} disabled={logBusy}>
                <RefreshCw size={13} /> 筛选
              </button>
              <button type="button" className="sec-btn" onClick={() => void refreshLogs()} disabled={logBusy}>
                <RefreshCw size={13} /> 刷新
              </button>
              <button type="button" className="sec-btn" onClick={() => void openPath(logList.dir)}>
                <FolderOpen size={13} /> 打开目录
              </button>
              <button type="button" className="sec-btn" onClick={() => void exportLogs()} disabled={logBusy || logEntries.length === 0}>
                <Download size={13} /> 导出 .txt
              </button>
            </div>
            <p className="diag-status" role="status">{logBusy ? "读取中…" : logMeta}</p>
            {logSaved && <p className="diag-status">{logSaved}</p>}
            <ul className="log-list" aria-label="运行日志">
              {logEntries.map((entry, index) => (
                <li key={`${entry.ts ?? "row"}-${index}`} className="log-row">
                  <time className="log-time">{formatTime(entry.ts)}</time>
                  <span className={"log-level log-level--" + (entry.level ?? "info")}>{entry.level ?? "info"}</span>
                  <div className="log-body">
                    <span className="log-scope">{entry.scope ?? "app"}</span>
                    <span className="log-message">{entry.message}</span>
                    {entry.data !== undefined && (
                      <details className="log-data">
                        <summary>数据</summary>
                        <pre>{JSON.stringify(entry.data, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </li>
              ))}
              {!logBusy && logEntries.length === 0 && <li className="diag-status">没有匹配的日志行。</li>}
            </ul>
          </>}
        </div>
      </div>
    </SectionShell>
  );
}

/** Local time for a log row; ISO strings the host wrote, never re-parsed as a Date when invalid. */
function formatTime(ts: string | undefined): string {
  if (!ts) return "--:--:--";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts.slice(11, 19) : date.toLocaleTimeString();
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}
