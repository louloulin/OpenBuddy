import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

export interface ModelOption {
  /** Complete provider/model key; never a bare model slug. */
  id: string;
  modelId?: string;
  label?: string;
  providerKind?: string;
  providerId?: string;
  providerLabel?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  contextWindow?: number;
}
export interface ModelRuntimeControls {
  busy: boolean;
  canSend?: boolean;
  thinkingLevel?: string;
  thinkingLevels: string[];
  onThinkingChange?: (level: string) => Promise<void>;
}
export const ModelRuntimeContext = createContext<ModelRuntimeControls>({ busy: false, thinkingLevels: [] });
const LEVEL_LABELS: Record<string, string> = { off: "关闭", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "最高" };

export function ModelSelector({ modelId, models, onModelChange, disabled = false }: {
  modelId?: string;
  models: ModelOption[];
  onModelChange: (id: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controls = useContext(ModelRuntimeContext);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const busy = pending || controls.busy;
  const current = models.find(model => model.id === modelId);
  const label = current?.label || current?.modelId || (modelId ? "模型不可用" : "选择模型");
  const filtered = models.filter(model => [model.label, model.modelId, model.providerLabel, model.providerId, model.id].some(value => value?.toLowerCase().includes(query.toLowerCase().trim())));
  const groups = Array.from(new Set(filtered.map(model => model.providerId ?? "unknown")));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const choose = async (key: string) => {
    if (busy || disabled) return;
    if (key === modelId) { setOpen(false); return; }
    setPending(true); setError("");
    try { await onModelChange(key); setOpen(false); trigger.current?.focus(); }
    catch (error) { setError(`模型切换失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setPending(false); }
  };
  return <div className="model-controls" ref={ref}>
    <div className="model-selector" onKeyDown={event => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }}>
      <button ref={trigger} className="model-selector__trigger" type="button" aria-label={`选择模型：${label}${current?.providerLabel ? `（${current.providerLabel}）` : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled || busy} onClick={() => { setOpen(value => !value); setQuery(""); setActive(-1); setError(""); }}>
        <span className="model-selector__label">{label}</span><ChevronDown size={14} />
      </button>
      {open && <div className="model-selector__menu">
        <label className="model-selector__search"><Search size={14} /><input ref={search} type="search" aria-label="搜索模型或提供商" value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setActive(-1); }} aria-controls={menuId} aria-activedescendant={active >= 0 ? `${menuId}-${active}` : undefined} onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(index => event.key === "ArrowDown" ? Math.min(index + 1, filtered.length - 1) : Math.max(index - 1, 0));
          }
          if (event.key === "Enter" && filtered.length) { event.preventDefault(); void choose(filtered[Math.max(active, 0)].id); }
        }} /></label>
        <div id={menuId} role="listbox" aria-label="可用模型" aria-busy={busy}>
          {filtered.length === 0 && <p className="model-selector__empty">{models.length ? "没有匹配模型" : "未配置模型，请在设置中添加"}</p>}
          {groups.map(providerId => {
            const group = filtered.filter(model => (model.providerId ?? "unknown") === providerId);
            const providerLabel = group[0]?.providerLabel || providerId;
            return <div key={providerId} role="group" aria-label={providerLabel}>
              <div className="model-selector__provider">{providerLabel}</div>
              {group.map(model => <button key={model.id} id={`${menuId}-${filtered.indexOf(model)}`} type="button" role="option" aria-selected={model.id === modelId} disabled={busy || disabled} className={`model-selector__item${model.id === modelId ? " model-selector__item--active" : ""}${filtered[active]?.id === model.id ? " model-selector__item--focused" : ""}`} onClick={() => { void choose(model.id); }}>
                <span className="model-selector__item-label">{model.label || model.modelId || model.id}</span>
                <span className="model-selector__item-id">{model.modelId || model.id}</span>
                <span className="model-selector__capabilities">{model.input?.includes("image") ? "图片 " : ""}{model.reasoning ? "思考 " : ""}{model.contextWindow ? `${Math.round(model.contextWindow / 1024)}K` : ""}</span>
                {model.id === modelId && <Check size={14} />}
              </button>)}
            </div>;
          })}
        </div>
      </div>}
      {busy && <span role="status" className="model-selector__feedback">切换中…</span>}
      {error && <p role="alert" className="model-selector__error">{error}</p>}
    </div>
    {controls.onThinkingChange && controls.thinkingLevels.length > 1 && <label className="model-thinking">思考
      <select aria-label="思考等级" value={controls.thinkingLevel ?? "off"} disabled={disabled || busy} onChange={event => {
        setPending(true); setError("");
        void controls.onThinkingChange!(event.target.value).catch(error => setError(`思考等级切换失败：${String(error)}`)).finally(() => setPending(false));
      }}>{controls.thinkingLevels.map(level => <option key={level} value={level}>{LEVEL_LABELS[level] ?? level}</option>)}</select>
    </label>}
  </div>;
}
