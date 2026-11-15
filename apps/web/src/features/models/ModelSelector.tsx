import { friendlyError } from "@openbuddy/chat-core/error-format";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Check, Lightbulb, LightbulbOff, Search, Star } from "lucide-react";
import { THINKING_LABELS, agentCycleModel } from "@openbuddy/client/agent-client";
import { matchShortcut } from "@/shared/lib/shortcuts";
import { formatTokens } from "./settings/model-config";
import { nextFavorite, useFavoriteModels } from "./state/favorite-models";
import "./model-favorites.css";

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
  /** Levels the model accepts (from providers_list); drives the home thinking control. */
  availableThinkingLevels?: string[];
}
export interface ModelRuntimeControls {
  busy: boolean;
  canSend?: boolean;
  unavailableReason?: string;
  thinkingLevel?: string;
  thinkingLevels: string[];
  onThinkingChange?: (level: string) => Promise<void>;
  /** Focused session: Ctrl/Cmd+P cycles its favourites through the host (W1.6); home cycles locally. */
  sessionId?: string;
  /** False when the current model has no reasoning: the thinking control is shown greyed out. */
  supportsThinking?: boolean;
}
export const ModelRuntimeContext = createContext<ModelRuntimeControls>({ busy: false, thinkingLevels: [] });
const LEVEL_LABELS = THINKING_LABELS;

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
  const favorites = useFavoriteModels(state => state.keys);
  const [notice, setNotice] = useState("");
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
  useEffect(() => {
    if (active >= 0) document.getElementById(`${menuId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, menuId]);
  // Favourites (W1.6): read once, and again whenever the menu opens (the settings screen edits them too).
  useEffect(() => { if (open || !useFavoriteModels.getState().loaded) void useFavoriteModels.getState().load(); }, [open]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  const star = async (key: string) => {
    setError("");
    try { await useFavoriteModels.getState().toggle(key); }
    catch (error) { setError(`收藏失败：${friendlyError(error)}`); }
  };
  // Ctrl/Cmd+P: next favourite. In a task through Pi's cycleModel (the host emits the new model state).
  const cycleRef = useRef<() => void>(() => {});
  cycleRef.current = () => {
    if (busy || disabled) { setNotice("回复中，结束后再切换模型"); return; }
    const usable = favorites.filter(key => models.some(model => model.id === key));
    if (!usable.length) { setNotice("先在模型菜单中点 ☆ 收藏模型，再按 Ctrl/⌘+P 切换"); return; }
    const name = (key?: string) => { const m = models.find(model => model.id === key); return m?.label || m?.modelId || key || ""; };
    if (controls.sessionId) {
      setPending(true); setError("");
      void agentCycleModel(controls.sessionId)
        .then(result => setNotice(result.changed ? `已切换到 ${name(result.state.modelKey)}` : result.reason === "single_favorite" ? "只收藏了当前这一个模型" : "先在模型菜单中点 ☆ 收藏模型"))
        .catch(error => setError(`模型切换失败：${friendlyError(error)}`))
        .finally(() => setPending(false));
      return;
    }
    const next = nextFavorite(favorites, models.map(model => model.id), modelId);
    if (!next) { setNotice("只收藏了当前这一个模型"); return; }
    void choose(next).then(() => setNotice(`已切换到 ${name(next)}`));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || !matchShortcut(event, "cycleModel")) return;
      event.preventDefault();
      cycleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const thinkingUnsupported = !!current && controls.thinkingLevels.length <= 1 && (controls.supportsThinking === false || !current.reasoning);
  const choose = async (key: string) => {
    if (busy || disabled) return;
    if (key === modelId) { setOpen(false); return; }
    setPending(true); setError("");
    try { await onModelChange(key); setOpen(false); trigger.current?.focus(); }
    catch (error) { setError(`模型切换失败：${friendlyError(error)}`); }
    finally { setPending(false); }
  };
  return <div className="model-controls" ref={ref}>
    <div className="model-selector" onKeyDown={event => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }}>
      <button ref={trigger} className="model-selector__trigger" type="button" aria-label={`选择模型：${label}${current?.providerLabel ? `（${current.providerLabel}）` : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled || busy} onClick={() => { setOpen(value => !value); setQuery(""); setActive(-1); setError(""); }}>
        <span className="model-selector__label">{label}</span>{current?.providerLabel && <small className="model-selector__selected-provider">{current.providerLabel}</small>}<ChevronDown size={14} />
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
              <div className="model-selector__provider">{providerLabel}{providerLabel !== providerId && <small> {providerId}</small>}</div>
              {group.map(model => { const favorite = favorites.includes(model.id), name = model.label || model.modelId || model.id; return <div key={model.id} className="model-selector__row">
                <button id={`${menuId}-${filtered.indexOf(model)}`} type="button" role="option" aria-selected={model.id === modelId} disabled={busy || disabled} className={`model-selector__item${model.id === modelId ? " model-selector__item--active" : ""}${filtered[active]?.id === model.id ? " model-selector__item--focused" : ""}`} onClick={() => { void choose(model.id); }}>
                  <span className="model-selector__item-label">{name}</span>
                  <span className="model-selector__item-id">{model.modelId || model.id}</span>
                  <span className="model-selector__capabilities">{model.input?.includes("image") ? "图片 " : ""}{model.reasoning ? "思考 " : ""}{model.contextWindow ? formatTokens(model.contextWindow) : ""}</span>
                  {model.id === modelId && <Check size={14} />}
                </button>
                <button type="button" className={"model-selector__star" + (favorite ? " model-selector__star--on" : "")} aria-pressed={favorite} aria-label={`${favorite ? "取消收藏" : "收藏"} ${name}`} title={favorite ? "取消收藏" : "收藏：对话中按 Ctrl/⌘+P 在收藏的模型间切换"} onClick={() => { void star(model.id); }}><Star size={14} /></button>
              </div>; })}
            </div>;
          })}
        </div>
      </div>}
      {controls.unavailableReason && <span className="model-selector__feedback" role="status">{controls.unavailableReason}</span>}
      {busy && <span role="status" className="model-selector__feedback">切换中…</span>}
      {!busy && notice && <span role="status" className="model-selector__feedback model-selector__notice">{notice}</span>}
      {error && <p role="alert" className="model-selector__error">{error}</p>}
    </div>
    {controls.onThinkingChange && controls.thinkingLevels.length > 1 && (() => {
      const change = (level: string) => {
        if (level === controls.thinkingLevel) return;
        setPending(true); setError("");
        void controls.onThinkingChange!(level).catch(error => setError(`思考等级切换失败：${friendlyError(error)}`)).finally(() => setPending(false));
      };
      // Few levels (what most models really support): one click, all visible. Many: a select.
      return controls.thinkingLevels.length <= 4
        ? <div className="model-thinking model-thinking--seg" role="radiogroup" aria-label="思考等级">
            <span className="model-thinking__label" aria-hidden title="思考等级"><Lightbulb size={13} /></span>
            {controls.thinkingLevels.map(level => <button key={level} type="button" role="radio" aria-checked={(controls.thinkingLevel ?? "off") === level} disabled={disabled || busy} className={"model-thinking__opt" + ((controls.thinkingLevel ?? "off") === level ? " model-thinking__opt--on" : "")} onClick={() => change(level)}>{LEVEL_LABELS[level] ?? level}</button>)}
          </div>
        : <label className="model-thinking">思考
            <select aria-label="思考等级" value={controls.thinkingLevel ?? "off"} disabled={disabled || busy} onChange={event => change(event.target.value)}>{controls.thinkingLevels.map(level => <option key={level} value={level}>{LEVEL_LABELS[level] ?? level}</option>)}</select>
          </label>;
    })()}
    {thinkingUnsupported && <span className="model-thinking model-thinking--unsupported" role="img" aria-label="当前模型不支持思考" aria-disabled="true" title="当前模型不支持思考，换一个支持思考的模型后可调整思考等级">
      <LightbulbOff size={14} aria-hidden />
    </span>}
  </div>;
}
