import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Save, Cpu } from "lucide-react";
import { providersLocalGet, providersLocalProbe, providersLocalSet } from "@openbuddy/client/agent-client";
import { DEFAULT_LOCAL_MODEL_CONFIG, type LocalModelConfig, type LocalModelProbe, type LocalModelState } from "@openbuddy/protocol/local-model";
import { errorText } from "./shared";
import { useLocale } from "@/shared/i18n";

/**
 * 设置 · 模型 · 本地模型 (20261116-pii W8).
 *
 * Points OpenBuddy at a local llama.cpp server (OpenAI-compatible `/v1`), probes its
 * model list and registers it as a normal provider, so the model picker, experts and
 * sub-agents can all use it.
 */
export function LocalModelCard({ onSaved }: { onSaved?: () => void }) {
  const { t } = useLocale();
  const [state, setState] = useState<LocalModelState | null>(null);
  const [draft, setDraft] = useState<LocalModelConfig>(DEFAULT_LOCAL_MODEL_CONFIG);
  const [probe, setProbe] = useState<LocalModelProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    providersLocalGet()
      .then((result) => { if (!cancelled) { setState(result); setDraft(result.config); } })
      .catch((error) => { if (!cancelled) setMsg({ kind: "err", text: t("models.local.loadFailed", { err: errorText(error) }) }); });
    return () => { cancelled = true; };
  }, []);

  const update = (patch: Partial<LocalModelConfig>) => setDraft((current) => ({ ...current, ...patch }));

  const runProbe = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await providersLocalProbe(draft.baseUrl);
      setProbe(result);
      setMsg(result.ok
        ? { kind: "ok", text: t("models.local.probeOk", { count: result.models.length, ms: result.ms }) }
        : { kind: "err", text: t("models.local.probeFailed", { error: result.error ?? t("models.local.unknownError") }) });
      if (result.ok && !draft.model && result.models[0]) update({ model: result.models[0] });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await providersLocalSet(draft);
      setState(next);
      setDraft(next.config);
      setMsg({ kind: "ok", text: next.config.enabled ? t("models.local.enabledMsg") : t("models.local.disabledMsg") });
      onSaved?.();
    } catch (error) {
      setMsg({ kind: "err", text: t("models.local.saveFailed", { err: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  };

  const choices = Array.from(new Set([...(probe?.models ?? []), ...(state?.models.map((model) => model.modelId) ?? []), ...(draft.model ? [draft.model] : [])]));

  return (
    <section className="ms-local" aria-label={t("models.local.title")}>
      <div className="ms-local__head">
        <div className="ms-local__title"><Cpu size={16} /><span>{t("models.local.title")}</span><span className="ms-local__badge">llama.cpp</span></div>
        <label className="ms-local__switch">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          <span>{draft.enabled ? t("models.local.on") : t("models.local.off")}</span>
        </label>
      </div>
      <p className="ms-local__hint">{t("models.local.hint")}</p>
      <div className="ms-local__row">
        <label className="ms-local__field ms-local__field--wide">
          <span>{t("models.local.baseUrl")}</span>
          <input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:8080/v1" spellCheck={false} />
        </label>
        <button type="button" className="ms-btn" onClick={() => void runProbe()} disabled={busy || !draft.baseUrl.trim()}>
          {busy ? <Loader2 size={14} className="ms-spin" /> : <RefreshCw size={14} />}{t("models.local.probe")}
        </button>
      </div>
      <div className="ms-local__row">
        <label className="ms-local__field">
          <span>{t("models.local.model")}</span>
          {choices.length > 0 ? (
            <select value={draft.model} onChange={(event) => update({ model: event.target.value })} aria-label={t("models.local.title")}>
              <option value="">{t("models.local.selectModel")}</option>
              {choices.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input value={draft.model} onChange={(event) => update({ model: event.target.value })} placeholder={t("models.local.modelPlaceholder")} spellCheck={false} />
          )}
        </label>
        <label className="ms-local__field">
          <span>{t("models.local.contextWindow")}</span>
          <input type="number" min={1024} step={1024} value={draft.contextWindow} onChange={(event) => update({ contextWindow: Number(event.target.value) || 8192 })} />
        </label>
        <label className="ms-local__field">
          <span>{t("models.local.maxTokens")}</span>
          <input type="number" min={256} step={256} value={draft.maxTokens} onChange={(event) => update({ maxTokens: Number(event.target.value) || 4096 })} />
        </label>
      </div>
      <div className="ms-local__actions">
        <label className="ms-local__check">
          <input type="checkbox" checked={draft.setDefault} onChange={(event) => update({ setDefault: event.target.checked })} />
          <span>{t("models.local.setDefault")}</span>
        </label>
        <button type="button" className="ms-btn ms-btn--primary" onClick={() => void save()} disabled={busy || (draft.enabled && !draft.model.trim())}>
          {busy ? <Loader2 size={14} className="ms-spin" /> : <Save size={14} />}{t("models.action.save")}
        </button>
      </div>
      {msg && <p className={"ms-local__msg ms-local__msg--" + msg.kind} role="status">{msg.text}</p>}
    </section>
  );
}
