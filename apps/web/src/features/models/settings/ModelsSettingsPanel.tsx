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
import { useLocale } from "@/shared/i18n";
import {
  formatPrice,
  formatTokens,
  levelsOf,
  protocolLabel,
} from "./model-config";
import { errorText, TestLine, type TestState } from "./shared";
import { ImportModels } from "./ImportModels";
import { ProviderEditor } from "./ProviderEditor";
import { ModelEditor } from "./ModelEditor";
import { LocalModelCard } from "./LocalModelCard";
import "./models-settings.css";

type Msg = { kind: "ok" | "err"; text: string } | null;
const keyOf = (m: Pick<ModelEntry, "providerId" | "modelId" | "modelKey">) => m.modelKey ?? `model:${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`;

/** 设置 · 模型: default model, providers (connection + status) and their models. */
export function ModelsSettingsPanel({ onModelsChanged }: { onModelsChanged?: () => void }) {
  const { t, tOptional } = useLocale();
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
      setMsg({ kind: "err", text: t("models.msg.loadFailed", { err: errorText(e) }) });
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
  /** A provider's display name: its own label, else the preset name, else its id. */
  const providerLabel = (p: Pick<ModelProviderEntry, "label" | "providerKind" | "id">) => {
    if (p.label) return p.label;
    const key = `models.preset.${p.providerKind}`;
    const text = tOptional(key);
    return text && text !== key ? text : p.id;
  };
  const presetLabel = (kind: string) => {
    const key = `models.preset.${kind}`;
    const text = tOptional(key);
    return text && text !== key ? text : kind;
  };

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
      await changed(t("models.msg.defaultSet", { name: m.name || m.modelId }));
    } catch (e) {
      setMsg({ kind: "err", text: t("models.msg.setDefaultFailed", { err: errorText(e) }) });
    }
  };

  const deleteProvider = async (p: ModelProviderEntry) => {
    const count = modelsOf(p.id).length;
    if (!(await appConfirm({
      title: count
        ? t("models.confirm.deleteProviderWithModels", { name: providerLabel(p), count })
        : t("models.confirm.deleteProvider", { name: providerLabel(p) }),
      message: t("models.confirm.deleteProviderMessage"),
      confirmLabel: t("models.action.delete"),
      danger: true,
    }))) return;
    try {
      await providersDeleteProvider(p.id);
      await changed(t("models.msg.providerDeleted"));
    } catch (e) {
      setMsg({ kind: "err", text: t("models.msg.deleteFailed", { err: errorText(e) }) });
    }
  };
  const deleteModel = async (m: ModelEntry) => {
    if (!(await appConfirm({ title: t("models.confirm.deleteModel", { name: m.name || m.modelId }), confirmLabel: t("models.action.delete"), danger: true }))) return;
    try {
      await providersDeleteModel(m.modelId, m.providerId);
      await changed(t("models.msg.modelDeleted"));
    } catch (e) {
      setMsg({ kind: "err", text: t("models.msg.deleteFailed", { err: errorText(e) }) });
    }
  };
  const importModels = async (providerId: string, picked: FetchedModel[]) => {
    try {
      for (const m of picked) await providersSaveModel({ ...m.suggested, modelId: m.id, providerId });
      setImporting(null);
      await changed(picked.some((m) => m.contextWindow || m.reasoning !== undefined)
        ? t("models.msg.importedWithCaps", { count: picked.length })
        : t("models.msg.imported", { count: picked.length }));
      // First models of the app: make one the default so 新建任务 just works.
      if (defaults && (!defaults.defaultModel || defaults.invalidDefault) && picked[0])
        await setDefault({ modelId: picked[0].id, providerId, name: picked[0].name } as ModelEntry);
    } catch (e) {
      setMsg({ kind: "err", text: t("models.msg.importFailed", { err: errorText(e) }) });
    }
  };

  const allModels = data.models;
  const providerTest = provider ? tests[`provider:${provider.id}`] : undefined;

  return (
    <div className="ms">
      <header className="ms__head">
        <h2 className="ms__title">{t("models.title")}</h2>
        <p className="ms__sub">{t("models.subtitle")}</p>
      </header>

      <section className="ms-card ms-default" aria-label={t("models.defaultModel")}>
        <div className="ms-default__text">
          <div className="ms-card__title">{t("models.defaultModel")}</div>
          <div className="ms-card__desc">{t("models.defaultModelDesc")}</div>
        </div>
        <div className="ms-select">
          <select
            aria-label={t("models.defaultModel")}
            value={allModels.some((m) => keyOf(m) === defaultKey) ? defaultKey : ""}
            disabled={!defaults || allModels.length === 0}
            onChange={(e) => { const m = allModels.find((x) => keyOf(x) === e.target.value); if (m) void setDefault(m); }}
          >
            <option value="" disabled>{allModels.length ? t("models.selectDefaultModel") : t("models.addModelFirst")}</option>
            {data.providers.map((p) => modelsOf(p.id).length > 0 && (
              <optgroup key={p.id} label={providerLabel(p)}>
                {modelsOf(p.id).map((m) => <option key={keyOf(m)} value={keyOf(m)}>{m.name || m.modelId}</option>)}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
        </div>
      </section>

      <LocalModelCard onSaved={() => { void reload(); onModelsChanged?.(); }} />

      <div className="ms__section-head">
        <h3 className="ms__section-title">{t("models.providersAndModels")}</h3>
        <button type="button" className="ms-btn ms-btn--primary" onClick={() => setEditingProvider({})}><Plus size={14} />{t("models.addProvider")}</button>
      </div>

      {loading ? (
        <div className="ms-empty">{t("models.loading")}</div>
      ) : data.providers.length === 0 ? (
        <div className="ms-empty">
          <Plug size={22} />
          <div className="ms-empty__title">{t("models.emptyTitle")}</div>
          <div className="ms-empty__desc">{t("models.emptyDesc")}</div>
          <button type="button" className="ms-btn ms-btn--primary" onClick={() => setEditingProvider({})}><Plus size={14} />{t("models.addProvider")}</button>
        </div>
      ) : (
        <div className="ms-grid">
          <ul className="ms-providers" aria-label={t("models.providers")}>
            {data.providers.map((p) => {
              const count = modelsOf(p.id).length;
              const test = tests[`provider:${p.id}`];
              const state = !hasKey(p) ? "missing" : test && !test.running ? (test.ok ? "ok" : "fail") : "saved";
              return (
                <li key={p.id}>
                  <button type="button" aria-current={p.id === selected} className={"ms-provider" + (p.id === selected ? " ms-provider--active" : "")} onClick={() => setSelected(p.id)}>
                    <span className={`ms-dot ms-dot--${state}`} aria-hidden />
                    <span className="ms-provider__text">
                      <span className="ms-provider__name">{providerLabel(p)}</span>
                      <span className="ms-provider__meta">{state === "missing" ? t("models.missingApiKey") : state === "fail" ? t("models.connFailed") : t("models.modelCount", { count })}</span>
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
                  <div className="ms-detail__title">{providerLabel(provider)}</div>
                  <div className="ms-detail__kind">{presetLabel(provider.providerKind)} · <code>{provider.id}</code></div>
                </div>
                <div className="ms-detail__actions">
                  <button type="button" className="ms-btn" disabled={!hasKey(provider) || providerTest?.running} onClick={() => void runTest(`provider:${provider.id}`, { providerId: provider.id })}>
                    {providerTest?.running ? <Loader2 size={14} className="ms-spin" /> : <Zap size={14} />}{t("models.testConnection")}
                  </button>
                  <button type="button" className="ms-icon-btn" aria-label={t("models.editProvider")} data-tip={t("models.editProvider")} onClick={() => setEditingProvider({ original: provider })}><Pencil size={14} /></button>
                  <button type="button" className="ms-icon-btn" aria-label={t("models.deleteProvider")} data-tip={t("models.deleteProvider")} onClick={() => void deleteProvider(provider)}><Trash2 size={14} /></button>
                </div>
              </div>

              <dl className="ms-fields">
                <div><dt>Base URL</dt><dd className="ms-mono">{provider.baseUrl || "—"}</dd></div>
                <div><dt>{t("models.protocol")}</dt><dd>{protocolLabel(provider.apiBackend)}</dd></div>
                <div><dt>API Key</dt><dd>{hasKey(provider) ? <span className="ms-ok"><Check size={12} />{t("models.saved")}</span> : <button type="button" className="ms-link" onClick={() => setEditingProvider({ original: provider })}>{t("models.notSetFill")}</button>}</dd></div>
                <div><dt>{t("models.contextWindow")}</dt><dd>{provider.contextWindow ? `${formatTokens(provider.contextWindow)} tokens` : t("models.perModel")}</dd></div>
              </dl>
              {providerTest && !providerTest.running && <TestLine result={providerTest} />}

              <div className="ms-models-head">
                <span className="ms-models-head__title">{t("models.modelsTitle")} <span className="ms-count">{modelsOf(provider.id).length}</span></span>
                <div className="ms-models-head__actions">
                  <button type="button" className="ms-btn ms-btn--ghost" onClick={() => setEditingModel({ providerId: provider.id })}><Plus size={14} />{t("models.addManually")}</button>
                  <button type="button" className="ms-btn" onClick={() => setImporting((v) => (v?.providerId === provider.id ? null : { providerId: provider.id }))}><RefreshCw size={14} />{t("models.fetchModels")}</button>
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
                <div className="ms-models-empty">{t("models.noModelsHint")}</div>
              ) : (
                <ul className="ms-models">
                  {modelsOf(provider.id).map((m) => {
                    const key = keyOf(m);
                    const test = tests[key];
                    const levels = levelsOf(m.reasoning, m.thinkingLevelMap).filter((l) => l !== "off");
                    return (
                      <li key={key} className="ms-model">
                        <div className="ms-model__main">
                          <div className="ms-model__name">
                            {m.name || m.modelId}
                            {key === defaultKey && <span className="ms-badge ms-badge--brand">{t("models.defaultBadge")}</span>}
                          </div>
                          <div className="ms-model__meta">
                            <code className="ms-model__id">{m.modelId}</code>
                            {m.contextWindow ? <span className="ms-chip" data-tip={t("models.tipContextWindow")}>{t("models.chipContext", { tokens: formatTokens(m.contextWindow) })}</span> : null}
                            {m.maxTokens ? <span className="ms-chip" data-tip={t("models.tipMaxOutput")}>{t("models.chipOutput", { tokens: formatTokens(m.maxTokens) })}</span> : null}
                            {m.input?.includes("image") && <span className="ms-chip">{t("models.chipImage")}</span>}
                            {m.reasoning && <span className="ms-chip ms-chip--think" data-tip={t("models.tipThinkingLevels")}>{levels.length ? t("models.chipThinkingLevels", { levels: levels.map((l) => THINKING_LABELS[l]).join("·") }) : t("models.chipThinking")}</span>}
                            {m.pricingKnown && m.cost && (m.cost.input > 0 || m.cost.output > 0) && <span className="ms-chip" data-tip={t("models.tipPricing")}>{formatPrice(m.cost)}</span>}
                          </div>
                          {test && !test.running && <TestLine result={test} />}
                        </div>
                        <div className="ms-model__actions">
                          {key !== defaultKey && <button type="button" className="ms-icon-btn" aria-label={t("models.aria.setDefault", { name: m.name || m.modelId })} data-tip={t("models.setDefaultTip")} onClick={() => void setDefault(m)}><Star size={14} /></button>}
                          <button type="button" className="ms-icon-btn" aria-label={t("models.aria.test", { name: m.name || m.modelId })} data-tip={t("models.tipSendTest")} disabled={!hasKey(provider) || test?.running} onClick={() => void runTest(key, { providerId: m.providerId, modelId: m.modelId })}>
                            {test?.running ? <Loader2 size={14} className="ms-spin" /> : <Zap size={14} />}
                          </button>
                          <button type="button" className="ms-icon-btn" aria-label={t("models.aria.edit", { name: m.name || m.modelId })} data-tip={t("models.tipEdit")} onClick={() => setEditingModel({ providerId: provider.id, original: m })}><Pencil size={14} /></button>
                          <button type="button" className="ms-icon-btn" aria-label={t("models.aria.remove", { name: m.name || m.modelId })} data-tip={t("models.tipDelete")} onClick={() => void deleteModel(m)}><Trash2 size={14} /></button>
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
            await changed(isNew ? t("models.msg.providerAdded") : t("models.msg.providerSaved"));
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
          onSaved={async (name) => { setEditingModel(null); await changed(editingModel.original ? t("models.msg.modelSaved") : t("models.msg.modelAdded", { name })); }}
        />
      )}
    </div>
  );
}
