/**
 * 专家链接导入 (B3b): preview an https URL or a local package path, then import it once.
 * Re-opening the same source + content shows 已导入 and goes straight to the existing expert.
 */
import { useEffect, useRef, useState } from "react";
import { expertsLinkImport, expertsLinkPreview } from "@openbuddy/client/agent-client";
import type { ExpertLinkImportResult, ExpertLinkPreview } from "@openbuddy/protocol/experts";
import { errorText } from "./expert-model";
import { useFocusTrap } from "@/shared/ui/use-focus-trap";

interface Props {
  onClose: () => void;
  onImported: (result: ExpertLinkImportResult) => void;
  onToast?: (message: string) => void;
}

export function LinkImportModal({ onClose, onImported, onToast }: Props) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<ExpertLinkPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const runPreview = async () => {
    if (!source.trim() || busy) return;
    setBusy("preview");
    setError("");
    try {
      setPreview(await expertsLinkPreview(source.trim()));
    } catch (e) {
      setPreview(null);
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!source.trim() || busy) return;
    setBusy("import");
    setError("");
    try {
      const result = await expertsLinkImport(source.trim());
      if (result.duplicate) onToast?.(`「${result.package}」已经导入过，未重复导入`);
      else onToast?.(`已从「${result.package}」导入 ${result.imported.length} 位专家`);
      onImported(result);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ec-modal-overlay" ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="ec-modal ex-link-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="从链接导入专家">
        <button type="button" className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="ec-modal-header">
          <div className="ec-modal-info">
            <div className="ec-modal-title">从链接导入</div>
            <p className="ec-modal-desc">支持 https 链接、本地 .zip 包或解压后的目录。同一内容只导入一次。</p>
          </div>
        </div>

        <label className="ex-link-label" htmlFor="expert-link-source">链接或路径</label>
        <input
          id="expert-link-source"
          ref={inputRef}
          className="ex-link-input"
          value={source}
          placeholder="https://example.com/expert-pack.zip 或 /path/to/pack"
          spellCheck={false}
          onChange={(event) => { setSource(event.target.value); setPreview(null); setError(""); }}
          onKeyDown={(event) => { if (event.key === "Enter") void runPreview(); }}
        />

        {error && <p className="ex-link-error" role="alert">{error}</p>}

        {preview && (
          <div className="ex-link-preview">
            <div className="ex-link-row">
              <strong>{preview.package}</strong>
              <span className="ex-link-meta">
                {preview.remote ? "远程" : "本地"} · {(preview.size / 1024).toFixed(1)} KB · sha {preview.sha256.slice(0, 10)}
              </span>
            </div>
            {preview.duplicate && (
              <p className="ex-link-duplicate">这个链接的内容已经导入过，导入会直接打开已有专家。</p>
            )}
            <ul className="ex-link-experts">
              {preview.experts.map((expert, index) => (
                <li key={`${expert.id ?? expert.name}-${index}`}>
                  <span className="ex-link-expert-name">{expert.name}</span>
                  {expert.description && <span className="ex-link-expert-desc">{expert.description}</span>}
                </li>
              ))}
            </ul>
            {(preview.contributions.skills + preview.contributions.prompts + preview.contributions.mcpServers) > 0 && (
              <p className="ex-link-meta">
                技能 {preview.contributions.skills} · 指令 {preview.contributions.prompts} · MCP {preview.contributions.mcpServers}（MCP 默认关闭）
              </p>
            )}
            {preview.team && <p className="ex-link-meta">团队：{preview.team.name}（{preview.team.members.length} 位成员）</p>}
            {preview.requires.length > 0 && <p className="ex-link-meta">需要：{preview.requires.join("、")}</p>}
          </div>
        )}

        <div className="ex-link-actions">
          <button type="button" className="um-btn um-btn--grey" onClick={onClose}>取消</button>
          <button type="button" className="um-btn um-btn--grey" disabled={!source.trim() || busy !== null} onClick={() => void runPreview()}>
            {busy === "preview" ? "预览中…" : "预览"}
          </button>
          <button type="button" className="um-btn um-btn--primary" disabled={!source.trim() || busy !== null} onClick={() => void runImport()}>
            {busy === "import" ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
