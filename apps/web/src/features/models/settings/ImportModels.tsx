import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import {
  providersFetchModels,
  THINKING_LABELS,
  type FetchedModel,
  type ModelProviderEntry,
} from "@openbuddy/client/agent-client";
import { formatTokens } from "./model-config";
import { errorText } from "./shared";
import { useLocale } from "@/shared/i18n";

/* ------------------------------------------------------------------ */
/* 拉取模型 */

export function ImportModels({ provider, hasKey, initial, existing, onClose, onImport }: {
  provider: ModelProviderEntry;
  hasKey: boolean;
  initial?: FetchedModel[];
  existing: Set<string>;
  onClose: () => void;
  onImport: (picked: FetchedModel[]) => void;
}) {
  const { t } = useLocale();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<FetchedModel[] | null>(initial ?? null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial ?? []).filter((m) => !existing.has(m.id)).map((m) => m.id)));
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const fetchList = async (key?: string) => {
    setBusy(true); setErr(null);
    try {
      const models = await providersFetchModels(provider.providerKind, key ?? "", undefined, { providerId: provider.id });
      setList(models);
      setPicked(new Set(models.filter((m) => !existing.has(m.id)).map((m) => m.id)));
      if (!models.length) setErr(t("models.import.noModels"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  // The saved key is used in the main process: nothing to type.
  useEffect(() => { if (!initial && hasKey) void fetchList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (list ?? []).filter((m) => !query.trim() || `${m.id} ${m.name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = (list ?? []).filter((m) => picked.has(m.id));

  return (
    <div className="ms-import" aria-label={t("models.aria.fetchModels")}>
      <div className="ms-import__bar">
        {!hasKey && (
          <input className="ms-input" type="password" value={apiKey} placeholder={t("models.ph.apiKeyOnce")} aria-label="API Key" onChange={(e) => setApiKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) void fetchList(apiKey.trim()); }} />
        )}
        {list && list.length > 0 && (
          <span className="ms-import__count">
            {t("models.import.found", { count: list.length })}{chosen.length ? ` ${t("models.import.selected", { count: chosen.length })}` : ""}
            {" · "}<button type="button" className="ms-link" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((m) => m.id)))}>{picked.size === list.length ? t("models.import.selectNone") : t("models.import.selectAll")}</button>
          </span>
        )}
        {list && list.length > 8 && <input className="ms-input" type="search" value={query} placeholder={t("models.import.filterPlaceholder")} aria-label={t("models.aria.filterModels")} onChange={(e) => setQuery(e.target.value)} />}
        <span className="ms-import__spacer" />
        <button type="button" className="ms-btn" disabled={busy || (!hasKey && !apiKey.trim())} onClick={() => void fetchList(hasKey ? undefined : apiKey.trim())}>
          {busy ? <Loader2 size={14} className="ms-spin" /> : <RefreshCw size={14} />}{list ? t("models.action.refetch") : t("models.action.fetch")}
        </button>
        <button type="button" className="ms-icon-btn" aria-label={t("models.aria.closeFetch")} onClick={onClose}><X size={14} /></button>
      </div>
      {busy && !list && <div className="ms-import__hint"><Loader2 size={14} className="ms-spin" />{t("models.import.reading", { url: provider.baseUrl ?? "" })}</div>}
      {err && <div className="ms-test ms-test--fail" role="alert"><X size={12} />{err}</div>}
      {list && list.length > 0 && (
        <>
          <ul className="ms-import__list">
            {shown.map((m) => (
              <li key={m.id}>
                <label className="ms-import__item">
                  <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                  <span className="ms-import__name">{m.name ?? m.id}{m.name && <code>{m.id}</code>}</span>
                  <span className="ms-import__caps">
                    {m.contextWindow ? <span className="ms-chip">{formatTokens(m.contextWindow)}</span> : null}
                    {m.input?.includes("image") && <span className="ms-chip">{t("models.chip.image")}</span>}
                    {m.reasoning && <span className="ms-chip ms-chip--think">{t("models.chip.thinking")}{m.thinkingLevels ? `：${m.thinkingLevels.filter((l) => l !== "off").map((l) => THINKING_LABELS[l]).join("·")}` : ""}</span>}
                    {existing.has(m.id) && <span className="ms-badge">{t("models.import.configured")}{picked.has(m.id) ? ` · ${t("models.import.willUpdate")}` : ""}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="ms-import__foot">
            <button type="button" className="ms-btn ms-btn--primary" disabled={!chosen.length} onClick={() => onImport(chosen)}>{t("models.import.button", { count: chosen.length || 0 })}</button>
          </div>
        </>
      )}
    </div>
  );
}
