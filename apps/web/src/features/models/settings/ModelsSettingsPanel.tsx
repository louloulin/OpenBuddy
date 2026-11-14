import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plug, Plus, RefreshCw, Star, Trash2, Zap } from "lucide-react";
import { appConfirm } from "../../../shared/ui/AppDialog";
import {
  agentsDefaultsGet,
  agentsDefaultsSave,
  providersDeleteModel,
  providersDeleteProvider,
  providersList,
  providersSaveModel,
  providersTest,
  THINKING_LABELS,
  type FetchedModel,
  type ModelEntry,
  type ModelProviderEntry,
  type ProviderListModel,
} from "@openbuddy/client/agent-client";
import type { AgentDefaults } from "@openbuddy/protocol/dto";
import {
  PRESETS,
  formatPrice,
  formatTokens,
  levelsOf,
  protocolLabel,
  providerName,
} from "./model-config";
import { errorText, TestLine, type TestState } from "./shared";
import { ImportModels } from "./ImportModels";
import { ProviderEditor } from "./ProviderEditor";
import { ModelEditor } from "./ModelEditor";
import "./models-settings.css";

type Msg = { kind: "ok" | "err"; text: string } | null;
const keyOf = (m: Pick<ModelEntry, "providerId" | "modelId" | "modelKey">) => m.modelKey ?? `model:${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`;

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
