import { useEffect, useRef, useState } from "react";
import { appConfirm } from "../../../shared/ui/AppDialog";
import { ChevronLeftIcon } from "@openbuddy/ui/icon/icons/index";
import { mcpConfigPath, mcpConfigRead, mcpConfigSave } from "@openbuddy/client/agent-client";
import { useSessionStore } from "@/features/chat/state/session-store";

const EMPTY = "{\n  \"mcpServers\": {}\n}";


export function McpConfigEditor({
  onBack, onSaved, onToast,
}: {
  /** Omitted when embedded as a tab: no back link, and 取消 reverts unsaved edits. */
  onBack?: () => void;
  onSaved?: () => void;
  onToast?: (m: string) => void;
}) {
  const [filePath, setFilePath] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, file] = await Promise.all([mcpConfigPath(), mcpConfigRead()]);
        setFilePath(p || file.filePath);
        setContent(file.content || EMPTY);
        setOriginal(file.content || EMPTY);
      } catch (e) {
        onToast?.(`读取配置失败：${String(e).replace(/^Error:\s*/, "")}`);
        setContent(EMPTY);
        setOriginal(EMPTY);
      } finally {
        setLoading(false);
      }
    })();
  }, [onToast]);

  const hasChanges = content !== original;
  const lineCount = content.split("\n").length;

  const syncGutter = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
  };

  const doBack = async () => {
    if (hasChanges && !(await appConfirm({ title: "放弃未保存的修改？", confirmLabel: "放弃", danger: true }))) return;
    if (onBack) onBack();
    else { setContent(original); setError(""); }
  };

  const doSave = async () => {
    const trimmed = content.trim();
    if (trimmed) {
      try { JSON.parse(trimmed); }
      catch (e) { setError(`无效的 JSON：${(e as Error).message}`); return; }
    }
    setError("");
    setSaving(true);
    try {
      // without one the file is still saved for the next sync.
      await mcpConfigSave(content, useSessionStore.getState().sessionId ?? undefined);
      setOriginal(content);
      onToast?.("已保存，正在同步到 MCP 服务…");
      onSaved?.();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mcp-editor">
      <div className="mcp-editor-head">
        {onBack ? (
          <button type="button" className="mcp-editor-back" onClick={() => { void doBack(); }}>
            <ChevronLeftIcon size="sm" /><span>返回 MCP 列表</span>
          </button>
        ) : <span className="mcp-editor-title">MCP 服务配置</span>}
        <div className="mcp-editor-actions">
          <button type="button" className="um-btn um-btn--grey" onClick={() => { void doBack(); }} disabled={!onBack && !hasChanges}>{onBack ? "取消" : "撤销修改"}</button>
          <button type="button" className="um-btn um-btn--primary"
            disabled={!hasChanges || saving} onClick={doSave}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
      <div className="mcp-editor-path">
        <span className="mcp-editor-path-label">配置文件路径</span>
        <span className="mcp-editor-path-value">{filePath}</span>
        {hasChanges && <span className="mcp-editor-unsaved">未保存</span>}
      </div>
      <div className="mcp-editor-body">
        {loading ? (
          <div className="ec-loading">加载中…</div>
        ) : (
          <div className="mcp-code">
            <div ref={gutterRef} className="mcp-code-gutter" aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="mcp-code-ln">{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={taRef}
              className="mcp-code-input"
              spellCheck={false}
              value={content}
              onScroll={syncGutter}
              onChange={(e) => { setContent(e.target.value); setError(""); }}
            />
          </div>
        )}
        {error && <div className="mcp-editor-error">{error}</div>}
      </div>
    </div>
  );
}
