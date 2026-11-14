import { useEffect, useMemo, useState } from "react";
import { invoke } from "@openbuddy/client/ipc";
import { previewUrl } from "@openbuddy/client/agent-client";
import { friendlyError } from "@/lib/error-format";
import { codeLanguage } from "@/lib/file-kind";
import { Markdown } from "@openbuddy/markdown";
import { FilePreview } from "../FilePreview";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { benchKind, fence, imageMime, isBinaryLoaded, isTextKind, KIND_LABEL, parseCsv, type BenchKind } from "./bench-kind";

const TEXT_LIMIT = 2 * 1024 * 1024;
const BINARY_LIMIT = 24 * 1024 * 1024;
/** Above this, code is shown plain (highlighting a huge file blocks the UI). */
const HIGHLIGHT_LIMIT = 300 * 1024;

type Loaded = { text?: string; base64?: string; error?: string };

/** Load the file the way its kind needs; `version` forces a reload. */
export function useFileContent(path: string, kind: BenchKind, version: number): Loaded | null {
  const [state, setState] = useState<Loaded | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    const needsText = isTextKind(kind);
    const needsBase64 = isBinaryLoaded(kind);
    if (!needsText && !needsBase64) { setState({}); return; }
    const request = needsText
      ? invoke<string>("read_text_file", { path, maxBytes: TEXT_LIMIT }).then((text) => ({ text }))
      : invoke<string>("read_file_base64", { path, maxBytes: BINARY_LIMIT }).then((base64) => ({ base64 }));
    request.then((value) => alive && setState(value), (e) => alive && setState({ error: friendlyError(e) }));
    return () => { alive = false; };
  }, [path, kind, version]);
  return state;
}

export type PreviewMode = "rendered" | "source";
const DEVICES = [
  { id: "desktop", label: "桌面", width: "100%" },
  { id: "tablet", label: "平板", width: "768px" },
  { id: "phone", label: "手机", width: "390px" },
] as const;

/** The body of an artifact tab: a real preview for each kind of file. */
export function ArtifactPreview({ path, version, mode, onModeChange, onSelectText }: {
  path: string;
  version: number;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  /** Text the reader selected inside a text preview (for "让 Buddy 改这段"). */
  onSelectText?: (text: string) => void;
}) {
  const kind = benchKind(path);
  const loaded = useFileContent(path, kind, version);
  const { theme } = useTheme();
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const name = path.split(/[\\/]/).pop() ?? path;

  const markdownSource = useMemo(() => {
    if (!loaded?.text) return "";
    if (kind === "json") {
      try { return fence(JSON.stringify(JSON.parse(loaded.text), null, 2), "json"); } catch { return fence(loaded.text, "json"); }
    }
    if (kind === "code" || kind === "html" || (kind === "markdown" && mode === "source")) return fence(loaded.text, kind === "markdown" ? "markdown" : codeLanguage(name));
    return loaded.text;
  }, [loaded?.text, kind, mode, name]);

  const toolbar = (kind === "markdown" || kind === "html") && (
    <div className="bench-preview__toolbar">
      <div className="bench-seg" role="tablist" aria-label="显示方式">
        <button type="button" role="tab" aria-selected={mode === "rendered"} className={"bench-seg__opt" + (mode === "rendered" ? " bench-seg__opt--on" : "")} onClick={() => onModeChange("rendered")}>预览</button>
        <button type="button" role="tab" aria-selected={mode === "source"} className={"bench-seg__opt" + (mode === "source" ? " bench-seg__opt--on" : "")} onClick={() => onModeChange("source")}>源码</button>
      </div>
      {kind === "html" && mode === "rendered" && (
        <div className="bench-seg" role="tablist" aria-label="设备宽度">
          {DEVICES.map((d) => (
            <button key={d.id} type="button" role="tab" aria-selected={device === d.id} className={"bench-seg__opt" + (device === d.id ? " bench-seg__opt--on" : "")} onClick={() => setDevice(d.id)}>{d.label}</button>
          ))}
        </div>
      )}
    </div>
  );

  const onMouseUp = () => {
    const text = window.getSelection()?.toString().trim();
    if (text && onSelectText) onSelectText(text);
  };

  if (kind === "html" && mode === "rendered") {
    const width = DEVICES.find((d) => d.id === device)!.width;
    return (
      <div className="bench-preview bench-preview--frame">
        {toolbar}
        <div className="bench-frame-stage">
          <iframe
            key={version}
            className="bench-frame"
            style={{ width }}
            src={previewUrl(path)}
            title={`预览：${name}`}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
        </div>
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <div className="bench-preview bench-preview--frame">
        <iframe key={version} className="bench-frame bench-frame--pdf" src={`${previewUrl(path)}#navpanes=0&view=FitH`} title={`预览：${name}`} />
      </div>
    );
  }
  if (kind === "audio" || kind === "video" || kind === "binary") {
    return (
      <div className="bench-preview bench-preview--empty">
        <div className="bench-empty">
          <div className="bench-empty__title">{KIND_LABEL[kind]}暂不支持在这里预览</div>
          <div className="bench-empty__hint">可以用默认应用打开，或在文件夹中查看。</div>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="bench-preview"><div className="bench-skeleton" aria-label="正在加载"><span /><span /><span /></div></div>;
  if (loaded.error) return <div className="bench-preview bench-preview--empty"><div className="bench-empty"><div className="bench-empty__title">无法读取这个文件</div><div className="bench-empty__hint">{loaded.error}</div></div></div>;

  if (kind === "image") {
    return (
      <div className="bench-preview bench-preview--image">
        <img className="bench-image" src={`data:${imageMime(path)};base64,${loaded.base64}`} alt={name} />
      </div>
    );
  }
  if (kind === "docx" || kind === "pptx" || kind === "sheet") {
    return <div className="bench-preview bench-preview--doc"><FilePreview filename={name} content={loaded.base64 ?? ""} /></div>;
  }
  if (kind === "csv") {
    const rows = parseCsv(loaded.text ?? "");
    const [head, ...body] = rows;
    return (
      <div className="bench-preview bench-preview--table">
        <table className="bench-table">
          {head && <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
          <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
        {rows.length >= 1000 && <div className="bench-preview__note">只显示前 1000 行</div>}
      </div>
    );
  }
  const plain = (loaded.text?.length ?? 0) > HIGHLIGHT_LIMIT && kind !== "markdown";
  return (
    <div className="bench-preview bench-preview--text" onMouseUp={onMouseUp}>
      {toolbar}
      {plain ? (
        <pre className="bench-plain">{loaded.text}</pre>
      ) : kind === "markdown" && mode === "rendered" ? (
        <div className="bench-doc"><Markdown complete markdownTheme="loose" theme={theme}>{markdownSource}</Markdown></div>
      ) : kind === "text" ? (
        <pre className="bench-plain">{loaded.text}</pre>
      ) : (
        <div className="bench-code"><Markdown complete theme={theme}>{markdownSource}</Markdown></div>
      )}
    </div>
  );
}
