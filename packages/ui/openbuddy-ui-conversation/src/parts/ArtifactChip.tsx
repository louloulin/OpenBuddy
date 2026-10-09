/**
 * ArtifactChip — 产物/制品 chip。
 *
 * Markdown 中的 `[[artifact:hash-or-id]]` 占位符被 StreamingMarkdown 替换为本组件。
 * 视觉对齐 ChatGPT / Codex 的产物角标:小圆形 icon + 产物短名 + hash 头 6 位;
 * 点击触发宿主回调(打开侧栏 artifact tab / 下载)。
 *
 * 数据来源(Plan5 B.5):
 *   - 优先 `<ChatArtifactProvider>` 注入的 resolver
 *   - 缺省时显示 "[icon]-[hash-head]"
 */
import { memo, useContext } from "react";
import { createContext } from "react";
import type { ReactNode } from "react";
import { Package, FileText, FileCode, Database } from "lucide-react";

export type ArtifactKind = "file" | "code" | "dataset" | "other";

export type ArtifactMeta = {
  id: string;
  kind: ArtifactKind;
  /** display title (e.g. "schema.sql", "result.csv"). */
  title: string;
  /** sha256 head or short hash; rendered as `abcdef…` in the chip. */
  hash?: string;
  /** size in bytes (optional). */
  size?: number;
};

export type ArtifactResolver = (id: string) => ArtifactMeta | undefined;

type ChatArtifactContextValue = { resolve: ArtifactResolver | undefined };
const ChatArtifactContext = createContext<ChatArtifactContextValue>({ resolve: undefined });

export type ChatArtifactProviderProps = {
  resolve?: ArtifactResolver;
  children: ReactNode;
};

export function ChatArtifactProvider({ resolve, children }: ChatArtifactProviderProps) {
  return (
    <ChatArtifactContext.Provider value={{ resolve }}>
      {children}
    </ChatArtifactContext.Provider>
  );
}

export function useArtifactResolver(): ArtifactResolver | undefined {
  return useContext(ChatArtifactContext).resolve;
}

function IconForKind({ kind }: { kind: ArtifactKind }) {
  switch (kind) {
    case "code":
      return <FileCode size={11} strokeWidth={2} aria-hidden="true" />;
    case "dataset":
      return <Database size={11} strokeWidth={2} aria-hidden="true" />;
    case "file":
      return <FileText size={11} strokeWidth={2} aria-hidden="true" />;
    default:
      return <Package size={11} strokeWidth={2} aria-hidden="true" />;
  }
}

export type ArtifactChipProps = {
  id: string;
  onSelect?: (artifact: ArtifactMeta) => void;
};

function ArtifactChipInner({ id, onSelect }: ArtifactChipProps) {
  const resolver = useArtifactResolver();
  const meta = resolver?.(id);
  const kind: ArtifactKind = meta?.kind ?? "other";
  const label = meta?.title ?? id;
  const hash = meta?.hash ? meta.hash.slice(0, 6) : null;
  return (
    <button
      type="button"
      className="artifact-chip"
      data-artifact-id={id}
      data-artifact-resolved={meta ? "true" : "false"}
      title={meta ? `${label}${meta.hash ? ` (${meta.hash.slice(0, 12)}…)` : ""}` : id}
      onClick={() => { if (meta) onSelect?.(meta); }}
    >
      <span className="artifact-chip__icon" aria-hidden="true">
        <IconForKind kind={kind} />
      </span>
      <span className="artifact-chip__label">{label}</span>
      {hash && <span className="artifact-chip__hash">{hash}</span>}
    </button>
  );
}

export const ArtifactChip = memo(ArtifactChipInner);
