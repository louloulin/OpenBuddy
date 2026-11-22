import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  providersSaveModel,
  PI_THINKING_LEVELS,
  THINKING_LABELS,
  type ModelCompat,
  type ModelEntry,
  type ModelProviderEntry,
  type PiThinkingLevel,
} from "@openbuddy/client/agent-client";
import {
  formatTokens,
  levelsOf,
  mapFromLevels,
  protocolLabel,
  providerName,
} from "./model-config";
import { Dialog, Field, errorText } from "./shared";
import { useLocale } from "@/shared/i18n";

/* ------------------------------------------------------------------ */
/* 模型编辑 */

const LEVEL_CHOICES = PI_THINKING_LEVELS.filter((l) => l !== "off");
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 思考参数格式（模块级常量需要 t，故改为工厂）。 */
function thinkingFormats(t: Translate): { value: string; label: string }[] {
  return [
    { value: "", label: t("models.thinkingFormat.auto") },
    { value: "openai", label: t("models.thinkingFormat.openai") },
    { value: "deepseek", label: t("models.thinkingFormat.deepseek") },
    { value: "zai", label: t("models.thinkingFormat.zai") },
    { value: "qwen", label: t("models.thinkingFormat.qwen") },
    { value: "openrouter", label: t("models.thinkingFormat.openrouter") },
  ];
}
const priceText = (v?: number) => (v === undefined ? "" : String(v));

export function ModelEditor({ provider, original, taken, onCancel, onSaved }: {
  provider: ModelProviderEntry;
  original?: ModelEntry;
  taken: Set<string>;
  onCancel: () => void;
  onSaved: (name: string) => void | Promise<void>;
}) {
  const { t } = useLocale();
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
    if (!id) return setError(t("models.err.modelIdRequired"));
    if (!original && taken.has(id)) return setError(t("models.err.modelExists", { name: id }));
    const int = (v: string, label: string) => { if (!v) return undefined; const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw Error(t("models.err.positiveInt", { label })); return n; };
    let entry: ModelEntry;
    try {
      const prices = Object.values(cost).some((v) => v !== "");
      const price = (v: string) => { const n = v === "" ? 0 : Number(v); if (!Number.isFinite(n) || n < 0) throw Error(t("models.err.priceNonNegative")); return n; };
      if (!levelsValid) throw Error(t("models.err.needLevel"));
      const cleanCompat = Object.fromEntries(Object.entries(compat).filter(([, v]) => v !== undefined && v !== ""));
      entry = {
        modelId: id,
        providerId: provider.id,
        name: name.trim() || undefined,
        contextWindow: int(contextWindow, t("models.field.contextWindowTokens")),
        maxTokens: int(maxTokens, t("models.field.maxOutputTokens")),
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
      setError(t("models.err.saveFailed", { err: errorText(e) }));
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
      title={original ? t("models.dialog.editModel", { name: original.name || original.modelId }) : t("models.dialog.addModel")}
      note={t("models.dialog.modelNote", { provider: providerName(provider), protocol: protocolLabel(provider.apiBackend) })}
      onClose={onCancel}
      footer={<>
        <span className="ms-dialog__spacer" />
        <button type="button" className="ms-btn" onClick={onCancel}>{t("models.action.cancel")}</button>
        <button type="button" className="ms-btn ms-btn--primary" disabled={saving || !modelId.trim()} onClick={() => void save()}>{saving ? t("models.action.saving") : t("models.action.save")}</button>
      </>}
    >
      <div className="ms-row">
        <Field label={t("models.field.modelId")} hint={t("models.field.modelIdHint")}>
          <input className="ms-input ms-mono" value={modelId} disabled={!!original} placeholder={t("models.field.modelIdPlaceholder")} onChange={(e) => setModelId(e.target.value)} />
        </Field>
        <Field label={t("models.field.displayName")}>
          <input className="ms-input" value={name} placeholder={modelId || t("models.field.displayNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="ms-row">
        <Field label={t("models.field.contextWindowTokens")} hint={provider.contextWindow ? t("models.hint.contextWindowProvider", { tokens: formatTokens(provider.contextWindow) }) : t("models.hint.contextWindowDefault")}>
          <input className="ms-input" inputMode="numeric" value={contextWindow} placeholder={t("models.field.contextWindowPlaceholder")} onChange={(e) => setContextWindow(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label={t("models.field.maxOutputTokens")} hint={t("models.hint.maxOutputDefault")}>
          <input className="ms-input" inputMode="numeric" value={maxTokens} placeholder={t("models.field.maxOutputPlaceholder")} onChange={(e) => setMaxTokens(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
      </div>

      <div className="ms-field">
        <span className="ms-field__label">{t("models.field.capabilities")}</span>
        <div className="ms-checks">
          <label className="ms-check"><input type="checkbox" checked={image} onChange={(e) => setImage(e.target.checked)} /><span>{t("models.check.imageInput")}</span></label>
          <label className="ms-check"><input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} /><span>{t("models.check.reasoning")}</span></label>
        </div>
      </div>

      {reasoning && (
        <div className="ms-field">
          <span className="ms-field__label">{t("models.field.thinkingLevels")}</span>
          <div className="ms-checks">
            <label className="ms-check"><input type="radio" name="levels" checked={!customLevels} onChange={() => setCustomLevels(false)} /><span>{t("models.check.levelsAuto")}</span></label>
            <label className="ms-check"><input type="radio" name="levels" checked={customLevels} onChange={() => setCustomLevels(true)} /><span>{t("models.check.levelsCustom")}</span></label>
          </div>
          {customLevels && (
            <div className="ms-levels" role="group" aria-label={t("models.field.thinkingLevels")}>
              <label className={"ms-level" + (levels.has("off") ? " ms-level--on" : "")}><input type="checkbox" checked={levels.has("off")} onChange={() => toggleLevel("off")} />{t("models.level.off")}</label>
              {LEVEL_CHOICES.map((l) => (
                <label key={l} className={"ms-level" + (levels.has(l) ? " ms-level--on" : "")}><input type="checkbox" checked={levels.has(l)} onChange={() => toggleLevel(l)} />{THINKING_LABELS[l]}<code>{original?.thinkingLevelMap?.[l] && original.thinkingLevelMap[l] !== l ? `→${original.thinkingLevelMap[l]}` : l}</code></label>
              ))}
            </div>
          )}
          {!levelsValid && <span className="ms-field__hint ms-field__hint--err">{t("models.err.needLevel")}</span>}
        </div>
      )}

      <div className="ms-field">
        <span className="ms-field__label">{t("models.field.pricing")}</span>
        <div className="ms-prices">
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <label key={k} className="ms-price">
              <span>{{ input: t("models.price.input"), output: t("models.price.output"), cacheRead: t("models.price.cacheRead"), cacheWrite: t("models.price.cacheWrite") }[k]}</span>
              <input className="ms-input" inputMode="decimal" value={cost[k]} placeholder="0" onChange={(e) => setCost((c) => ({ ...c, [k]: e.target.value.replace(/[^\d.]/g, "") }))} />
            </label>
          ))}
        </div>
      </div>

      {openai && (
        <>
          <button type="button" className="ms-disclosure" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}><ChevronDown size={14} />{t("models.compat")}</button>
          {advanced && (
            <div className="ms-advanced">
              <div className="ms-row">
                <Field label={t("models.field.thinkingFormat")}>
                  <div className="ms-select">
                    <select aria-label={t("models.field.thinkingFormat")} value={compat.thinkingFormat ?? ""} onChange={(e) => setCompat((c) => ({ ...c, thinkingFormat: e.target.value || undefined }))}>
                      {thinkingFormats(t).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
                  </div>
                </Field>
                <Field label={t("models.field.maxTokensField")}>
                  <div className="ms-select">
                    <select aria-label={t("models.field.maxTokensField")} value={compat.maxTokensField ?? ""} onChange={(e) => setCompat((c) => ({ ...c, maxTokensField: (e.target.value || undefined) as ModelCompat["maxTokensField"] }))}>
                      <option value="">{t("models.check.levelsAuto")}</option>
                      <option value="max_tokens">max_tokens</option>
                      <option value="max_completion_tokens">max_completion_tokens</option>
                    </select>
                    <ChevronDown size={14} className="ms-select__arrow" aria-hidden />
                  </div>
                </Field>
              </div>
              <div className="ms-checks ms-checks--col">
                {flag("supportsReasoningEffort", t("models.flag.reasoningEffort"), t("models.flag.reasoningEffortHint"))}
                {flag("requiresReasoningContentOnAssistantMessages", t("models.flag.reasoningContent"), t("models.flag.reasoningContentHint"))}
                {flag("supportsDeveloperRole", t("models.flag.developerRole"), t("models.flag.developerRoleHint"))}
              </div>
            </div>
          )}
        </>
      )}
      {error && <div className="ms-error" role="alert">{error}</div>}
    </Dialog>
  );
}
