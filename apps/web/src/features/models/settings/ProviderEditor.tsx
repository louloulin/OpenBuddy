import { useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Zap } from "lucide-react";
import {
  providersFetchModels,
  providersSaveProvider,
  providersTest,
  type ApiBackend,
  type FetchedModel,
  type ModelProviderEntry,
  type ProviderKind,
  type ProviderTestResult,
} from "@openbuddy/client/agent-client";
import {
  PRESETS,
  PRESET_ORDER,
  PROTOCOLS,
  authFor,
  providerName,
  uniqueProviderId,
} from "./model-config";
import { Dialog, Field, TestLine, errorText, type TestState } from "./shared";
import { useLocale } from "@/shared/i18n";

/* ------------------------------------------------------------------ */
/* 厂商编辑 */

export function ProviderEditor({ original, takenIds, onCancel, onSaved }: {
  original?: ModelProviderEntry;
  takenIds: string[];
  onCancel: () => void;
  onSaved: (id: string, fetched?: FetchedModel[]) => void | Promise<void>;
}) {
  const { t } = useLocale();
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
        setNote(t("models.provider.autoBaseUrlNote", { url: result.baseUrl }));
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
    if (custom && !baseUrl.trim()) return setError(t("models.err.baseUrlRequired"));
    if (!original && !apiKey.trim()) return setError(t("models.err.apiKeyRequired"));
    if (contextWindow && !(Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0)) return setError(t("models.err.contextWindowPositive"));
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
        if (!result.ok) { setForce(true); setError(t("models.err.probeFailed")); return; }
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
      setError(/invalid url|无效的 API URL/i.test(raw) ? t("models.err.badBaseUrl") : t("models.err.saveFailed", { err: raw }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={original ? t("models.dialog.editProvider", { name: providerName(original) }) : t("models.dialog.addProvider")}
      note={t("models.provider.note")}
      onClose={onCancel}
      footer={<>
        <button type="button" className="ms-btn" disabled={test?.running || saving || (!apiKey.trim() && !hasSavedKey) || (custom && !baseUrl.trim())} onClick={() => void probe()}>
          {test?.running ? <Loader2 size={14} className="ms-spin" /> : <Zap size={14} />}{t("models.action.test")}
        </button>
        <span className="ms-dialog__spacer" />
        <button type="button" className="ms-btn" onClick={onCancel}>{t("models.action.cancel")}</button>
        <button type="button" className="ms-btn ms-btn--primary" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 size={14} className="ms-spin" /> : null}{saving ? (test?.running ? t("models.action.probing") : t("models.action.saving")) : force ? t("models.action.saveAnyway") : t("models.action.save")}
        </button>
      </>}
    >
      <div className="ms-row">
        <Field label={t("models.field.type")}>
          <div className="ms-select">
            <select aria-label={t("models.aria.providerType")} value={kind} disabled={!!original} onChange={(e) => pickKind(e.target.value as ProviderKind)}>
              {PRESET_ORDER.map((k) => <option key={k} value={k}>{PRESETS[k].label}</option>)}
            </select>
            <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
          </div>
        </Field>
        <Field label={t("models.field.name")}>
          <input className="ms-input" value={label} maxLength={60} placeholder={custom ? t("models.ph.providerName") : preset.label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      <Field label="Base URL" hint={custom ? (apiBackend === "messages" ? t("models.hint.baseUrlAnthropic") : t("models.hint.baseUrlOpenAI")) : t("models.hint.baseUrlOfficial")}>
        <input className="ms-input ms-mono" value={baseUrl} placeholder={apiBackend === "messages" ? "https://api.example.com" : "https://api.example.com/v1"} onChange={(e) => { setBaseUrl(e.target.value); setTest(null); setForce(false); }} />
      </Field>
      {note && <div className="ms-note"><Check size={12} />{note}</div>}
      <Field label={t("models.field.apiKey")} hint={hasSavedKey ? t("models.hint.apiKeySaved") : preset.helpUrl ? t("models.hint.apiKeyGet", { url: preset.helpUrl }) : undefined}>
        <span className="ms-input-wrap">
          <input className="ms-input ms-mono" type={showKey ? "text" : "password"} value={apiKey} autoComplete="off" spellCheck={false} placeholder={hasSavedKey ? t("models.ph.apiKeySaved") : preset.placeholderKey} onChange={(e) => { setApiKey(e.target.value); setTest(null); setForce(false); }} />
          <button type="button" className="ms-icon-btn ms-input-wrap__btn" aria-label={showKey ? t("models.aria.hideApiKey") : t("models.aria.showApiKey")} onClick={() => setShowKey((v) => !v)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </span>
      </Field>
      <Field label={t("models.field.protocol")} hint={PROTOCOLS.find((p) => p.value === apiBackend)?.hint}>
        <div className="ms-seg" role="radiogroup" aria-label={t("models.aria.protocol")}>
          {PROTOCOLS.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={apiBackend === p.value} disabled={!custom && p.value !== preset.apiBackend} className={"ms-seg__opt" + (apiBackend === p.value ? " ms-seg__opt--on" : "")} onClick={() => { setApiBackend(p.value); setTest(null); setForce(false); }}>{p.label}</button>
          ))}
        </div>
      </Field>
      <button type="button" className="ms-disclosure" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}><ChevronDown size={14} />{t("models.action.advanced")}</button>
      {advanced && (
        <Field label={t("models.field.contextWindowOptional")} hint={t("models.hint.contextWindowScope")}>
          <input className="ms-input" inputMode="numeric" value={contextWindow} placeholder={t("models.field.contextWindowPlaceholder")} onChange={(e) => setContextWindow(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
      )}
      {test && !test.running && <TestLine result={test} />}
      {error && <div className="ms-error" role="alert">{error}</div>}
    </Dialog>
  );
}
