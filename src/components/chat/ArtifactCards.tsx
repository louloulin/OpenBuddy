import { createContext, memo, useContext } from "react";
import type { ArtifactInfo } from "@/lib/agent-client";
import { KIND_GLYPH, KIND_LABEL, benchKind, formatSize } from "../bench/bench-kind";

/**
 * Artifacts of the open session, for in-turn cards (20261115-ui §5.1, U1.5).
 * Provided by ChatView; the value only changes when the artifact index does.
 */
export interface ArtifactsApi {
  all: ArtifactInfo[];
  open: (path: string) => void;
  openChanges: (path: string) => void;
  openList: () => void;
  revert: (toolCallIds: string[], files: ArtifactInfo[]) => void;
}
export const ArtifactsContext = createContext<ArtifactsApi | null>(null);
export const useArtifacts = () => useContext(ArtifactsContext);

const MAX = 3;
const name = (p: string) => p.split(/[\\/]/).pop() || p;

/** Files this turn created or changed: up to 3 cards + "查看所有产物（N）". */
export const ArtifactCards = memo(function ArtifactCards({ items, total, api }: { items: ArtifactInfo[]; total: number; api: ArtifactsApi }) {
  if (!items.length) return null;
  const shown = items.slice(0, MAX);
  const more = items.length - shown.length;
  return (
    <div className="artifact-cards" aria-label="本回合产物">
      {shown.map((a) => {
        const kind = benchKind(a.path);
        return (
          <div key={a.path} className={"artifact-card" + (a.exists ? "" : " artifact-card--gone")}>
            <button type="button" className="artifact-card__main" onClick={() => api.open(a.path)} title={a.path} disabled={!a.exists}>
              <span className={`artifact-card__icon bench-item__icon--${kind}`} title={KIND_LABEL[kind]} aria-hidden>{KIND_GLYPH[kind]}</span>
              <span className="artifact-card__name">{name(a.path)}</span>
              <span className="artifact-card__meta">
                {!a.exists ? "已删除" : a.status === "created" ? `新建${a.size !== undefined ? ` · ${formatSize(a.size)}` : ""}` : (
                  <>修改 <span className="diff__stats-add">+{a.added}</span> <span className="diff__stats-del">−{a.removed}</span></>
                )}
              </span>
            </button>
            <button type="button" className="artifact-card__side" onClick={() => (a.status === "created" && a.exists ? api.open(a.path) : api.openChanges(a.path))}>
              {a.status === "created" && a.exists ? "预览" : "查看变更"}
            </button>
          </div>
        );
      })}
      <button type="button" className="artifact-cards__all" onClick={api.openList}>
        {more > 0 ? `还有 ${more} 个 · ` : ""}查看所有产物（{total}）<span aria-hidden> →</span>
      </button>
    </div>
  );
});
