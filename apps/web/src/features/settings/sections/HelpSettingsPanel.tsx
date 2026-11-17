import { useState } from "react";
import { ClipboardCopy, Download, ExternalLink, Stethoscope } from "lucide-react";
import { agentDiagnose, exportTextFile, saveFileDialog } from "@openbuddy/client/agent-client";
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
          <a href="#" onClick={(e) => e.preventDefault()}>
            OpenBuddy 文档
          </a>
          <span className="help-list__hint">（即将上线）</span>
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
    </SectionShell>
  );
}
