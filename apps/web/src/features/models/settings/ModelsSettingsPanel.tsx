import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Pencil, Plug, Plus, RefreshCw, Star, Trash2, X, Zap } from "lucide-react";
import { appConfirm } from "../../../shared/ui/AppDialog";
import { friendlyError, rawErrorText } from "@openbuddy/chat-core/error-format";
import {
  agentsDefaultsGet,
  agentsDefaultsSave,
  providersDeleteModel,
  providersDeleteProvider,
  providersFetchModels,
  providersList,
  providersSaveModel,
  providersSaveProvider,
  providersTest,
  PI_THINKING_LEVELS,
  THINKING_LABELS,
  type ApiBackend,
  type FetchedModel,
  type ModelCompat,
  type ModelEntry,
  type ModelProviderEntry,
  type PiThinkingLevel,
  type ProviderKind,
  type ProviderListModel,
  type ProviderTestResult,
} from "@openbuddy/client/agent-client";
import type { AgentDefaults } from "@openbuddy/protocol/dto";
import {
  PRESETS,
  PRESET_ORDER,
  PROTOCOLS,
  authFor,
  formatPrice,
  formatTokens,
  levelsOf,
  mapFromLevels,
  protocolLabel,
  providerName,
  uniqueProviderId,
} from "./model-config";
import "./models-settings.css";

type Msg = { kind: "ok" | "err"; text: string } | null;
type TestState = { running: true } | ({ running: false } & ProviderTestResult);
const keyOf = (m: Pick<ModelEntry, "providerId" | "modelId" | "modelKey">) => m.modelKey ?? `model:${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`;
const errorText = (e: unknown) => rawErrorText(e) || friendlyError(e);

/** 设置 · 模型: default model, providers (connection + status) and their models. */
export function ModelsSettingsPanel({ onModelsChanged }: { onModelsChanged?: () => void }) {
  const [data, setData] = useState<ProviderListModel>({ providers: [], models: [] });
  const [defaults, setDefaults] = useState<AgentDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<{ original?: ModelProviderEntry } | null>(null);
  const [editingModel, setEditingModel] = useState<{ providerId: string; original?: ModelEntry } | null>(null);
  const [importing, setImporting] = useState<{ providerId: string; initial?: FetchedModel[] } | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const reload = async () => {
    try {
      const [list, d] = await Promise.all([providersList(), agentsDefaultsGet().catch(() => null)]);
      setData(list);
      setDefaults(d);
      setSelected((prev) => (prev && list.providers.some((p) => p.id === prev) ? prev : list.providers[0]?.id ?? null));
    } catch (e) {
      setMsg({ kind: "err", text: `读取配置失败：${errorText(e)}` });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const changed = async (text?: string) => {
    onModelsChanged?.();
    await reload();
    if (text) setMsg({ kind: "ok", text });
  };
  const modelsOf = (providerId: string) => data.models.filter((m) => m.providerId === providerId);
  const provider = data.providers.find((p) => p.id === selected) ?? null;
  const defaultKey = defaults && !defaults.invalidDefault ? defaults.defaultModel : "";
  const hasKey = (p: ModelProviderEntry) => p.apiKey === "••••";

  const runTest = async (key: string, input: Parameters<typeof providersTest>[0]) => {
    setTests((t) => ({ ...t, [key]: { running: true } }));
    try {
      const result = await providersTest(input);
      setTests((t) => ({ ...t, [key]: { running: false, ...result } }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { running: false, ok: false, latencyMs: 0, error: errorText(e) } }));
    }
  };

  const setDefault = async (m: ModelEntry) => {
    if (!defaults) return;
    try {
      await agentsDefaultsSave({ ...defaults, defaultModel: keyOf(m), defaultProviderId: m.providerId });
      await changed(`新任务将默认使用「${m.name || m.modelId}」。`);
    } catch (e) {
      setMsg({ kind: "err", text: `设置默认模型失败：${errorText(e)}` });
    }
  };

  const deleteProvider = async (p: ModelProviderEntry) => {
    const count = modelsOf(p.id).length;
    if (!(await appConfirm({ title: `删除厂商「${providerName(p)}」${count ? `及其 ${count} 个模型` : ""}？`, message: "保存的 API Key 会一并删除。", confirmLabel: "删除", danger: true }))) return;
    try {
      await providersDeleteProvider(p.id);
      await changed("已删除厂商。");
    } catch (e) {
      setMsg({ kind: "err", text: `删除失败：${errorText(e)}` });
    }
  };
  const deleteModel = async (m: ModelEntry) => {
    if (!(await appConfirm({ title: `删除模型「${m.name || m.modelId}」？`, confirmLabel: "删除", danger: true }))) return;
    try {
      await providersDeleteModel(m.modelId, m.providerId);
      await changed("已删除模型。");
    } catch (e) {
      setMsg({ kind: "err", text: `删除失败：${errorText(e)}` });
    }
  };
  const importModels = async (providerId: string, picked: FetchedModel[]) => {
    try {
      for (const m of picked) await providersSaveModel({ ...m.suggested, modelId: m.id, providerId });
      setImporting(null);
      await changed(`已导入 ${picked.length} 个模型${picked.some((m) => m.contextWindow || m.reasoning !== undefined) ? "，能力参数来自接口" : ""}。`);
      // First models of the app: make one the default so 新建任务 just works.
      if (defaults && (!defaults.defaultModel || defaults.invalidDefault) && picked[0])
        await setDefault({ modelId: picked[0].id, providerId, name: picked[0].name } as ModelEntry);
    } catch (e) {
      setMsg({ kind: "err", text: `导入失败：${errorText(e)}` });
    }
  };

  const allModels = data.models;
  const providerTest = provider ? tests[`provider:${provider.id}`] : undefined;

  return (
    <div className="ms">
      <header className="ms__head">
        <h2 className="ms__title">模型</h2>
        <p className="ms__sub">一个厂商保存一份连接（Base URL、协议、API Key），下面挂多个模型。API Key 用系统钥匙串加密保存，不会回传到界面。</p>
      </header>

      <section className="ms-card ms-default" aria-label="默认模型">
        <div className="ms-default__text">
          <div className="ms-card__title">默认模型</div>
          <div className="ms-card__desc">新建任务时使用；对话中可在输入框随时切换。</div>
        </div>
        <div className="ms-select">
          <select
            aria-label="默认模型"
            value={allModels.some((m) => keyOf(m) === defaultKey) ? defaultKey : ""}
            disabled={!defaults || allModels.length === 0}
            onChange={(e) => { const m = allModels.find((x) => keyOf(x) === e.target.value); if (m) void setDefault(m); }}
          >
            <option value="" disabled>{allModels.length ? "选择默认模型" : "先添加模型"}</option>
            {data.providers.map((p) => modelsOf(p.id).length > 0 && (
              <optgroup key={p.id} label={providerName(p)}>
                {modelsOf(p.id).map((m) => <option key={keyOf(m)} value={keyOf(m)}>{m.name || m.modelId}</option>)}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
        </div>
      </section>

      <div className="ms__section-head">
        <h3 className="ms__section-title">厂商与模型</h3>
        <button type="button" className="ms-btn ms-btn--primary" onClick={() => setEditingProvider({})}><Plus size={14} />添加厂商</button>
      </div>

      {loading ? (
        <div className="ms-empty">加载中…</div>
      ) : data.providers.length === 0 ? (
        <div className="ms-empty">
          <Plug size={22} />
          <div className="ms-empty__title">还没有配置模型</div>
          <div className="ms-empty__desc">添加一个厂商（OpenAI / Anthropic 兼容的网关都可以），保存后会自动拉取它的模型列表。</div>
          <button type="button" className="ms-btn ms-btn--primary" onClick={() => setEditingProvider({})}><Plus size={14} />添加厂商</button>
        </div>
      ) : (
        <div className="ms-grid">
          <ul className="ms-providers" aria-label="厂商">
            {data.providers.map((p) => {
              const count = modelsOf(p.id).length;
              const t = tests[`provider:${p.id}`];
              const state = !hasKey(p) ? "missing" : t && !t.running ? (t.ok ? "ok" : "fail") : "saved";
              return (
                <li key={p.id}>
                  <button type="button" aria-current={p.id === selected} className={"ms-provider" + (p.id === selected ? " ms-provider--active" : "")} onClick={() => setSelected(p.id)}>
                    <span className={`ms-dot ms-dot--${state}`} aria-hidden />
                    <span className="ms-provider__text">
                      <span className="ms-provider__name">{providerName(p)}</span>
                      <span className="ms-provider__meta">{state === "missing" ? "缺少 API Key" : state === "fail" ? "连接失败" : `${count} 个模型`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {provider && (
            <div className="ms-detail">
              <div className="ms-detail__head">
                <div className="ms-detail__title-group">
                  <div className="ms-detail__title">{providerName(provider)}</div>
                  <div className="ms-detail__kind">{PRESETS[provider.providerKind]?.label ?? provider.providerKind} · <code>{provider.id}</code></div>
                </div>
                <div className="ms-detail__actions">
                  <button type="button" className="ms-btn" disabled={!hasKey(provider) || providerTest?.running} onClick={() => void runTest(`provider:${provider.id}`, { providerId: provider.id })}>
                    {providerTest?.running ? <Loader2 size={14} className="ms-spin" /> : <Zap size={14} />}测试连接
                  </button>
                  <button type="button" className="ms-icon-btn" aria-label="编辑厂商" data-tip="编辑厂商" onClick={() => setEditingProvider({ original: provider })}><Pencil size={14} /></button>
                  <button type="button" className="ms-icon-btn" aria-label="删除厂商" data-tip="删除厂商" onClick={() => void deleteProvider(provider)}><Trash2 size={14} /></button>
                </div>
              </div>

              <dl className="ms-fields">
                <div><dt>Base URL</dt><dd className="ms-mono">{provider.baseUrl || "—"}</dd></div>
                <div><dt>协议</dt><dd>{protocolLabel(provider.apiBackend)}</dd></div>
                <div><dt>API Key</dt><dd>{hasKey(provider) ? <span className="ms-ok"><Check size={12} />已保存</span> : <button type="button" className="ms-link" onClick={() => setEditingProvider({ original: provider })}>未设置，去填写</button>}</dd></div>
                <div><dt>上下文窗口</dt><dd>{provider.contextWindow ? `${formatTokens(provider.contextWindow)} tokens` : "按模型"}</dd></div>
              </dl>
              {providerTest && !providerTest.running && <TestLine result={providerTest} />}

              <div className="ms-models-head">
                <span className="ms-models-head__title">模型 <span className="ms-count">{modelsOf(provider.id).length}</span></span>
                <div className="ms-models-head__actions">
                  <button type="button" className="ms-btn ms-btn--ghost" onClick={() => setEditingModel({ providerId: provider.id })}><Plus size={14} />手动添加</button>
                  <button type="button" className="ms-btn" onClick={() => setImporting((v) => (v?.providerId === provider.id ? null : { providerId: provider.id }))}><RefreshCw size={14} />拉取模型</button>
                </div>
              </div>

              {importing?.providerId === provider.id && (
                <ImportModels
                  provider={provider}
                  hasKey={hasKey(provider)}
                  initial={importing.initial}
                  existing={new Set(modelsOf(provider.id).map((m) => m.modelId))}
                  onClose={() => setImporting(null)}
                  onImport={(picked) => void importModels(provider.id, picked)}
                />
              )}

              {modelsOf(provider.id).length === 0 ? (
                <div className="ms-models-empty">还没有模型。用「拉取模型」从接口导入（会带上上下文、推理、图片等能力），或手动添加。</div>
              ) : (
                <ul className="ms-models">
                  {modelsOf(provider.id).map((m) => {
                    const key = keyOf(m);
                    const t = tests[key];
                    const levels = levelsOf(m.reasoning, m.thinkingLevelMap).filter((l) => l !== "off");
                    return (
                      <li key={key} className="ms-model">
                        <div className="ms-model__main">
                          <div className="ms-model__name">
                            {m.name || m.modelId}
                            {key === defaultKey && <span className="ms-badge ms-badge--brand">默认</span>}
                          </div>
                          <div className="ms-model__meta">
                            <code className="ms-model__id">{m.modelId}</code>
                            {m.contextWindow ? <span className="ms-chip" data-tip="上下文窗口">{formatTokens(m.contextWindow)} 上下文</span> : null}
                            {m.maxTokens ? <span className="ms-chip" data-tip="单次最大输出">{formatTokens(m.maxTokens)} 输出</span> : null}
                            {m.input?.includes("image") && <span className="ms-chip">图片</span>}
                            {m.reasoning && <span className="ms-chip ms-chip--think" data-tip="可选的思考档位">思考{levels.length ? `：${levels.map((l) => THINKING_LABELS[l]).join("·")}` : ""}</span>}
                            {m.pricingKnown && m.cost && (m.cost.input > 0 || m.cost.output > 0) && <span className="ms-chip" data-tip="每百万 tokens 输入 / 输出（美元）">{formatPrice(m.cost)}</span>}
                          </div>
                          {t && !t.running && <TestLine result={t} />}
                        </div>
                        <div className="ms-model__actions">
                          {key !== defaultKey && <button type="button" className="ms-icon-btn" aria-label={`设为默认：${m.name || m.modelId}`} data-tip="设为默认" onClick={() => void setDefault(m)}><Star size={14} /></button>}
                          <button type="button" className="ms-icon-btn" aria-label={`测试：${m.name || m.modelId}`} data-tip="发一条测试消息" disabled={!hasKey(provider) || t?.running} onClick={() => void runTest(key, { providerId: m.providerId, modelId: m.modelId })}>
                            {t?.running ? <Loader2 size={14} className="ms-spin" /> : <Zap size={14} />}
                          </button>
                          <button type="button" className="ms-icon-btn" aria-label={`编辑：${m.name || m.modelId}`} data-tip="编辑" onClick={() => setEditingModel({ providerId: provider.id, original: m })}><Pencil size={14} /></button>
                          <button type="button" className="ms-icon-btn" aria-label={`删除：${m.name || m.modelId}`} data-tip="删除" onClick={() => void deleteModel(m)}><Trash2 size={14} /></button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {msg && <div className={`ms-msg ms-msg--${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</div>}

      {editingProvider && (
        <ProviderEditor
          original={editingProvider.original}
          takenIds={data.providers.map((p) => p.id)}
          onCancel={() => setEditingProvider(null)}
          onSaved={async (id, fetched) => {
            const isNew = !editingProvider.original;
            setEditingProvider(null);
            setSelected(id);
            await changed(isNew ? "厂商已添加。" : "厂商配置已保存。");
            // New provider: show its models right away (already fetched by the save check).
            if (isNew) setImporting({ providerId: id, initial: fetched });
          }}
        />
      )}
      {editingModel && (
        <ModelEditor
          provider={data.providers.find((p) => p.id === editingModel.providerId)!}
          original={editingModel.original}
          taken={new Set(modelsOf(editingModel.providerId).map((m) => m.modelId))}
          onCancel={() => setEditingModel(null)}
          onSaved={async (name) => { setEditingModel(null); await changed(editingModel.original ? "模型已保存。" : `已添加模型「${name}」。`); }}
        />
      )}
    </div>
  );
}

function TestLine({ result }: { result: ProviderTestResult }) {
  const time = result.latencyMs >= 1000 ? `${(result.latencyMs / 1000).toFixed(1)}s` : `${result.latencyMs}ms`;
  if (!result.ok) return <div className="ms-test ms-test--fail" role="alert"><X size={12} />连接失败：{result.error}</div>;
  return (
    <div className="ms-test ms-test--ok" role="status">
      <Check size={12} />连接正常 · {time}
      {result.modelCount !== undefined && ` · ${result.modelCount} 个模型`}
      {result.reply !== undefined && ` · 回复：${result.reply || "（只有思考内容）"}`}
      {result.usage && ` · ${result.usage.input}/${result.usage.output} tokens`}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 拉取模型 */

function ImportModels({ provider, hasKey, initial, existing, onClose, onImport }: {
  provider: ModelProviderEntry;
  hasKey: boolean;
  initial?: FetchedModel[];
  existing: Set<string>;
  onClose: () => void;
  onImport: (picked: FetchedModel[]) => void;
}) {
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
      if (!models.length) setErr("接口没有返回任何对话模型。");
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
    <div className="ms-import" aria-label="拉取模型">
      <div className="ms-import__bar">
        {!hasKey && (
          <input className="ms-input" type="password" value={apiKey} placeholder="API Key（只用于这次拉取）" aria-label="API Key" onChange={(e) => setApiKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) void fetchList(apiKey.trim()); }} />
        )}
        {list && list.length > 0 && (
          <span className="ms-import__count">
            找到 {list.length} 个模型{chosen.length ? ` · 已选 ${chosen.length}` : ""}
            {" · "}<button type="button" className="ms-link" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((m) => m.id)))}>{picked.size === list.length ? "全不选" : "全选"}</button>
          </span>
        )}
        {list && list.length > 8 && <input className="ms-input" type="search" value={query} placeholder="筛选模型" aria-label="筛选模型" onChange={(e) => setQuery(e.target.value)} />}
        <span className="ms-import__spacer" />
        <button type="button" className="ms-btn" disabled={busy || (!hasKey && !apiKey.trim())} onClick={() => void fetchList(hasKey ? undefined : apiKey.trim())}>
          {busy ? <Loader2 size={14} className="ms-spin" /> : <RefreshCw size={14} />}{list ? "重新获取" : "获取"}
        </button>
        <button type="button" className="ms-icon-btn" aria-label="关闭拉取" onClick={onClose}><X size={14} /></button>
      </div>
      {busy && !list && <div className="ms-import__hint"><Loader2 size={14} className="ms-spin" />正在读取 {provider.baseUrl}/models …</div>}
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
                    {m.input?.includes("image") && <span className="ms-chip">图片</span>}
                    {m.reasoning && <span className="ms-chip ms-chip--think">思考{m.thinkingLevels ? `：${m.thinkingLevels.filter((l) => l !== "off").map((l) => THINKING_LABELS[l]).join("·")}` : ""}</span>}
                    {existing.has(m.id) && <span className="ms-badge">已配置{picked.has(m.id) ? " · 将更新" : ""}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="ms-import__foot">
            <button type="button" className="ms-btn ms-btn--primary" disabled={!chosen.length} onClick={() => onImport(chosen)}>导入 {chosen.length || ""} 个模型</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 厂商编辑 */

function Dialog({ title, note, onClose, children, footer, wide }: { title: string; note?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input:not([disabled]), select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="ms-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={"ms-dialog" + (wide ? " ms-dialog--wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ms-dialog__head">
          <div>
            <div className="ms-dialog__title">{title}</div>
            {note && <div className="ms-dialog__note">{note}</div>}
          </div>
          <button type="button" className="ms-icon-btn" aria-label="关闭" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="ms-dialog__body">{children}</div>
        <footer className="ms-dialog__foot">{footer}</footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="ms-field">
      <span className="ms-field__label">{label}</span>
      {children}
      {hint && <span className="ms-field__hint">{hint}</span>}
    </label>
  );
}

function ProviderEditor({ original, takenIds, onCancel, onSaved }: {
  original?: ModelProviderEntry;
  takenIds: string[];
  onCancel: () => void;
  onSaved: (id: string, fetched?: FetchedModel[]) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<ProviderKind>(original?.providerKind ?? "custom");
  const [label, setLabel] = useState(original?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(original?.baseUrl ?? "");
  const [apiBackend, setApiBackend] = useState<ApiBackend>(original?.apiBackend ?? "chat_completions");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [contextWindow, setContextWindow] = useState(original?.contextWindow ? String(original.contextWindow) : "");
  const [advanced, setAdvanced] = useState(!!original?.contextWindow);
  const [test, setTest] = useState<TestState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [force, setForce] = useState(false);
  /** Models listed by the last successful check (cleared with `test` when a field changes). */
  const [probed, setProbed] = useState<FetchedModel[] | undefined>(undefined);
  const preset = PRESETS[kind];
  const custom = kind === "custom" || kind === "custom_anthropic";
  const hasSavedKey = original?.apiKey === "••••";

  const pickKind = (next: ProviderKind) => {
    const p = PRESETS[next];
    setKind(next);
    setApiBackend(p.apiBackend);
    setBaseUrl(p.baseUrl ?? "");
    setTest(null); setNote(null); setForce(false);
  };
  const connection = () => ({
    ...(original ? { providerId: original.id } : {}),
    providerKind: kind,
    apiBackend,
    baseUrl: baseUrl.trim() || undefined,
    apiKey: apiKey.trim() || undefined,
  });
  /** Probe the endpoint; adopt the base URL that answered (e.g. ".../v1" appended). */
  const probe = async (): Promise<{ result: ProviderTestResult; models?: FetchedModel[] }> => {
    setTest({ running: true }); setNote(null);
    try {
      const result = await providersTest(connection());
      if (result.baseUrl && result.baseUrl !== baseUrl.trim().replace(/\/$/, "")) {
        setBaseUrl(result.baseUrl);
        setNote(`已自动改为 ${result.baseUrl}（这个地址返回了模型列表）`);
      }
      setTest({ running: false, ...result });
      let models: FetchedModel[] | undefined;
      if (result.ok) models = await providersFetchModels(kind, apiKey.trim(), result.baseUrl ?? (baseUrl.trim() || undefined), { apiBackend, ...(original ? { providerId: original.id } : {}) }).catch(() => undefined);
      setProbed(models);
      return { result, models };
    } catch (e) {
      const result = { ok: false, latencyMs: 0, error: errorText(e) };
      setTest({ running: false, ...result });
      return { result };
    }
  };

  const save = async () => {
    setError(null);
    if (custom && !baseUrl.trim()) return setError("请填写 Base URL。");
    if (!original && !apiKey.trim()) return setError("请填写 API Key。");
    if (contextWindow && !(Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0)) return setError("上下文窗口需为正整数。");
    setSaving(true);
    try {
      // New connections are checked first so a wrong URL / key shows up here, not in the chat.
      const connectionChanged = !original || apiKey.trim() || baseUrl.trim() !== (original.baseUrl ?? "") || apiBackend !== original.apiBackend;
      let fetched: FetchedModel[] | undefined;
      let url = baseUrl.trim();
      if (connectionChanged && !force && test && !test.running && test.ok) {
        // Just checked and nothing changed since (editing a field clears `test`).
        fetched = probed;
      } else if (connectionChanged && !force) {
        const { result, models } = await probe();
        if (!result.ok) { setForce(true); setError("连接检测没有通过。确认无误的话可以「仍然保存」。"); return; }
        fetched = models;
        if (result.baseUrl) url = result.baseUrl;
      }
      const id = original?.id ?? uniqueProviderId(kind, label || preset.label, takenIds);
      await providersSaveProvider({
        id,
        providerKind: kind,
        label: label.trim() || (custom ? undefined : preset.label),
        baseUrl: url || undefined,
        apiBackend,
        authScheme: authFor(apiBackend),
        apiKey: apiKey.trim() || undefined,
        contextWindow: contextWindow ? Number(contextWindow) : undefined,
      });
      await onSaved(id, fetched);
    } catch (e) {
      const raw = errorText(e);
      setError(/invalid url|无效的 API URL/i.test(raw) ? "Base URL 格式不正确，需以 http:// 或 https:// 开头，且不能带参数" : `保存失败：${raw}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={original ? `编辑厂商 · ${providerName(original)}` : "添加厂商"}
      note="OpenAI 或 Anthropic 协议兼容的接口都可以接入：官方 API、中转网关、本地模型服务。"
      onClose={onCancel}
      footer={<>
        <button type="button" className="ms-btn" disabled={test?.running || saving || (!apiKey.trim() && !hasSavedKey) || (custom && !baseUrl.trim())} onClick={() => void probe()}>
          {test?.running ? <Loader2 size={14} className="ms-spin" /> : <Zap size={14} />}测试连接
        </button>
        <span className="ms-dialog__spacer" />
        <button type="button" className="ms-btn" onClick={onCancel}>取消</button>
        <button type="button" className="ms-btn ms-btn--primary" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 size={14} className="ms-spin" /> : null}{saving ? (test?.running ? "检测连接…" : "保存中…") : force ? "仍然保存" : "保存"}
        </button>
      </>}
    >
      <div className="ms-row">
        <Field label="类型">
          <div className="ms-select">
            <select aria-label="厂商类型" value={kind} disabled={!!original} onChange={(e) => pickKind(e.target.value as ProviderKind)}>
              {PRESET_ORDER.map((k) => <option key={k} value={k}>{PRESETS[k].label}</option>)}
            </select>
            <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
          </div>
        </Field>
        <Field label="名称">
          <input className="ms-input" value={label} maxLength={60} placeholder={custom ? "如 公司网关、taotoken" : preset.label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      <Field label="Base URL" hint={custom ? (apiBackend === "messages" ? "填到 /v1 之前，如 https://api.example.com" : "通常以 /v1 结尾；只填域名也行，检测时会自动补全") : "官方地址；用中转网关时可以改成网关地址"}>
        <input className="ms-input ms-mono" value={baseUrl} placeholder={apiBackend === "messages" ? "https://api.example.com" : "https://api.example.com/v1"} onChange={(e) => { setBaseUrl(e.target.value); setTest(null); setForce(false); }} />
      </Field>
      {note && <div className="ms-note"><Check size={12} />{note}</div>}
      <Field label="API Key" hint={hasSavedKey ? "已保存。留空保持不变，输入新的会替换。" : preset.helpUrl ? `在 ${preset.helpUrl} 获取` : undefined}>
        <span className="ms-input-wrap">
          <input className="ms-input ms-mono" type={showKey ? "text" : "password"} value={apiKey} autoComplete="off" spellCheck={false} placeholder={hasSavedKey ? "••••••••（已保存）" : preset.placeholderKey} onChange={(e) => { setApiKey(e.target.value); setTest(null); setForce(false); }} />
          <button type="button" className="ms-icon-btn ms-input-wrap__btn" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((v) => !v)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </span>
      </Field>
      <Field label="协议" hint={PROTOCOLS.find((p) => p.value === apiBackend)?.hint}>
        <div className="ms-seg" role="radiogroup" aria-label="协议">
          {PROTOCOLS.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={apiBackend === p.value} disabled={!custom && p.value !== preset.apiBackend} className={"ms-seg__opt" + (apiBackend === p.value ? " ms-seg__opt--on" : "")} onClick={() => { setApiBackend(p.value); setTest(null); setForce(false); }}>{p.label}</button>
          ))}
        </div>
      </Field>
      <button type="button" className="ms-disclosure" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}><ChevronDown size={14} />高级</button>
      {advanced && (
        <Field label="上下文窗口（tokens，可选）" hint="作用于这个厂商下没有单独设置的模型">
          <input className="ms-input" inputMode="numeric" value={contextWindow} placeholder="如 128000" onChange={(e) => setContextWindow(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
      )}
      {test && !test.running && <TestLine result={test} />}
      {error && <div className="ms-error" role="alert">{error}</div>}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* 模型编辑 */

const LEVEL_CHOICES = PI_THINKING_LEVELS.filter((l) => l !== "off");
const THINKING_FORMATS: { value: string; label: string }[] = [
  { value: "", label: "自动（按 Base URL 判断）" },
  { value: "openai", label: "reasoning_effort（OpenAI）" },
  { value: "deepseek", label: "thinking 开关 + reasoning_effort（DeepSeek）" },
  { value: "zai", label: "thinking 开关（智谱 GLM）" },
  { value: "qwen", label: "enable_thinking（通义千问）" },
  { value: "openrouter", label: "reasoning 对象（OpenRouter）" },
];
const priceText = (v?: number) => (v === undefined ? "" : String(v));

function ModelEditor({ provider, original, taken, onCancel, onSaved }: {
  provider: ModelProviderEntry;
  original?: ModelEntry;
  taken: Set<string>;
  onCancel: () => void;
  onSaved: (name: string) => void | Promise<void>;
}) {
  const [modelId, setModelId] = useState(original?.modelId ?? "");
  const [name, setName] = useState(original?.name ?? "");
  const [contextWindow, setContextWindow] = useState(original?.contextWindow ? String(original.contextWindow) : "");
  const [maxTokens, setMaxTokens] = useState(original?.maxTokens ? String(original.maxTokens) : "");
  const [image, setImage] = useState(!!original?.input?.includes("image"));
  const [reasoning, setReasoning] = useState(!!original?.reasoning);
  const [customLevels, setCustomLevels] = useState(!!original?.thinkingLevelMap);
  const [levels, setLevels] = useState<Set<PiThinkingLevel>>(() => new Set(original?.thinkingLevelMap ? levelsOf(true, original.thinkingLevelMap) : ["off", "minimal", "low", "medium", "high"]));
  const [cost, setCost] = useState(() => ({ input: priceText(original?.cost?.input), output: priceText(original?.cost?.output), cacheRead: priceText(original?.cost?.cacheRead), cacheWrite: priceText(original?.cost?.cacheWrite) }));
  const [compat, setCompat] = useState<ModelCompat>(original?.compat ?? {});
  const [advanced, setAdvanced] = useState(!!original?.compat && Object.keys(original.compat).length > 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const openai = provider.apiBackend !== "messages";
  const toggleLevel = (l: PiThinkingLevel) => setLevels((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });
  const levelsValid = !reasoning || !customLevels || [...levels].some((l) => l !== "off");

  const save = async () => {
    setError(null);
    const id = modelId.trim();
    if (!id) return setError("请填写模型 ID。");
    if (!original && taken.has(id)) return setError(`模型「${id}」已存在。`);
    const int = (v: string, label: string) => { if (!v) return undefined; const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw Error(`${label}需为正整数。`); return n; };
    let entry: ModelEntry;
    try {
      const prices = Object.values(cost).some((v) => v !== "");
      const price = (v: string) => { const n = v === "" ? 0 : Number(v); if (!Number.isFinite(n) || n < 0) throw Error("价格需为非负数字。"); return n; };
      if (!levelsValid) throw Error("至少选择一个思考档位。");
      const cleanCompat = Object.fromEntries(Object.entries(compat).filter(([, v]) => v !== undefined && v !== ""));
      entry = {
        modelId: id,
        providerId: provider.id,
        name: name.trim() || undefined,
        contextWindow: int(contextWindow, "上下文窗口"),
        maxTokens: int(maxTokens, "最大输出"),
        input: image ? ["text", "image"] : ["text"],
        reasoning,
        ...(prices ? { cost: { input: price(cost.input), output: price(cost.output), cacheRead: price(cost.cacheRead), cacheWrite: price(cost.cacheWrite) } } : {}),
        ...(reasoning && customLevels ? { thinkingLevelMap: mapFromLevels(levels, original?.thinkingLevelMap) } : {}),
        ...(openai && Object.keys(cleanCompat).length ? { compat: cleanCompat } : {}),
      };
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(true);
    try {
      await providersSaveModel(entry);
      await onSaved(entry.name || entry.modelId);
    } catch (e) {
      setError(`保存失败：${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const flag = (key: keyof ModelCompat, label: string, hint: string) => (
    <label className="ms-check" title={hint}>
      <input type="checkbox" checked={compat[key] === true} onChange={(e) => setCompat((c) => ({ ...c, [key]: e.target.checked ? true : undefined }))} />
      <span>{label}</span>
    </label>
  );

  return (
    <Dialog
      wide
      title={original ? `编辑模型 · ${original.name || original.modelId}` : "添加模型"}
      note={`所属厂商：${providerName(provider)}（${protocolLabel(provider.apiBackend)}）`}
      onClose={onCancel}
      footer={<>
        <span className="ms-dialog__spacer" />
        <button type="button" className="ms-btn" onClick={onCancel}>取消</button>
        <button type="button" className="ms-btn ms-btn--primary" disabled={saving || !modelId.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
      </>}
    >
      <div className="ms-row">
        <Field label="模型 ID" hint="请求里发送的 model 字段">
          <input className="ms-input ms-mono" value={modelId} disabled={!!original} placeholder="如 deepseek-chat、glm-4.6" onChange={(e) => setModelId(e.target.value)} />
        </Field>
        <Field label="显示名称（可选）">
          <input className="ms-input" value={name} placeholder={modelId || "如 DeepSeek V3"} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="ms-row">
        <Field label="上下文窗口（tokens）" hint={provider.contextWindow ? `留空用厂商设置 ${formatTokens(provider.contextWindow)}` : "留空用默认 128K"}>
          <input className="ms-input" inputMode="numeric" value={contextWindow} placeholder="如 128000" onChange={(e) => setContextWindow(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label="单次最大输出（tokens）" hint="留空用默认 8192">
          <input className="ms-input" inputMode="numeric" value={maxTokens} placeholder="如 8192" onChange={(e) => setMaxTokens(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
      </div>

      <div className="ms-field">
        <span className="ms-field__label">能力</span>
        <div className="ms-checks">
          <label className="ms-check"><input type="checkbox" checked={image} onChange={(e) => setImage(e.target.checked)} /><span>支持图片输入</span></label>
          <label className="ms-check"><input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} /><span>支持思考（推理）</span></label>
        </div>
      </div>

      {reasoning && (
        <div className="ms-field">
          <span className="ms-field__label">思考档位</span>
          <div className="ms-checks">
            <label className="ms-check"><input type="radio" name="levels" checked={!customLevels} onChange={() => setCustomLevels(false)} /><span>自动（由 SDK 按协议决定）</span></label>
            <label className="ms-check"><input type="radio" name="levels" checked={customLevels} onChange={() => setCustomLevels(true)} /><span>只提供这些档位</span></label>
          </div>
          {customLevels && (
            <div className="ms-levels" role="group" aria-label="可用思考档位">
              <label className={"ms-level" + (levels.has("off") ? " ms-level--on" : "")}><input type="checkbox" checked={levels.has("off")} onChange={() => toggleLevel("off")} />可关闭</label>
              {LEVEL_CHOICES.map((l) => (
                <label key={l} className={"ms-level" + (levels.has(l) ? " ms-level--on" : "")}><input type="checkbox" checked={levels.has(l)} onChange={() => toggleLevel(l)} />{THINKING_LABELS[l]}<code>{original?.thinkingLevelMap?.[l] && original.thinkingLevelMap[l] !== l ? `→${original.thinkingLevelMap[l]}` : l}</code></label>
              ))}
            </div>
          )}
          {!levelsValid && <span className="ms-field__hint ms-field__hint--err">至少选择一个思考档位。</span>}
        </div>
      )}

      <div className="ms-field">
        <span className="ms-field__label">价格（美元 / 百万 tokens，可选，用于费用统计）</span>
        <div className="ms-prices">
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <label key={k} className="ms-price">
              <span>{{ input: "输入", output: "输出", cacheRead: "缓存读", cacheWrite: "缓存写" }[k]}</span>
              <input className="ms-input" inputMode="decimal" value={cost[k]} placeholder="0" onChange={(e) => setCost((c) => ({ ...c, [k]: e.target.value.replace(/[^\d.]/g, "") }))} />
            </label>
          ))}
        </div>
      </div>

      {openai && (
        <>
          <button type="button" className="ms-disclosure" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}><ChevronDown size={14} />兼容性（遇到报错再调）</button>
          {advanced && (
            <div className="ms-advanced">
              <div className="ms-row">
                <Field label="思考参数格式">
                  <div className="ms-select">
                    <select aria-label="思考参数格式" value={compat.thinkingFormat ?? ""} onChange={(e) => setCompat((c) => ({ ...c, thinkingFormat: e.target.value || undefined }))}>
                      {THINKING_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
                  </div>
                </Field>
                <Field label="最大输出字段">
                  <div className="ms-select">
                    <select aria-label="最大输出字段" value={compat.maxTokensField ?? ""} onChange={(e) => setCompat((c) => ({ ...c, maxTokensField: (e.target.value || undefined) as ModelCompat["maxTokensField"] }))}>
                      <option value="">自动</option>
                      <option value="max_tokens">max_tokens</option>
                      <option value="max_completion_tokens">max_completion_tokens</option>
                    </select>
                    <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
                  </div>
                </Field>
              </div>
              <div className="ms-checks ms-checks--col">
                {flag("supportsReasoningEffort", "发送 reasoning_effort", "接口接受 reasoning_effort 参数")}
                {flag("requiresReasoningContentOnAssistantMessages", "历史消息带回 reasoning_content", "DeepSeek 等在工具调用多轮中要求回传思考内容")}
                {flag("supportsDeveloperRole", "支持 developer 角色", "不支持时系统提示用 system 角色发送")}
              </div>
            </div>
          )}
        </>
      )}
      {error && <div className="ms-error" role="alert">{error}</div>}
    </Dialog>
  );
}

