import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Layers, ListOrdered, Puzzle, RotateCcw, Star, Zap } from "lucide-react";
import { settingsAgentGet, settingsAgentSet } from "@openbuddy/client/api/model";
import type { AgentSettings, AgentSettingsPatch, CacheWarmingMode, QueueDeliveryMode } from "@openbuddy/protocol/agent-settings";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { useLocale } from "@/shared/i18n";
import "./agent-behavior.css";

/**
 * 设置 · 智能体 → 运行行为 (20261116-pii W0.4). Every control saves at once into pi-settings.json
 * through `settings_agent_set`; the engine hands the change to every open session immediately.
 */

const RESERVE_OPTIONS = [8192, 16384, 32768, 65536];
const KEEP_OPTIONS = [10000, 20000, 40000, 80000];
const RETRY_OPTIONS = [1, 2, 3, 5, 8, 10];
/** 选项文案随语言变化，因此在组件内用 t() 拼装。 */
const QUEUE_MODES: ReadonlyArray<QueueDeliveryMode> = ["one-at-a-time", "all"];
const WARMING_MODES: ReadonlyArray<CacheWarmingMode> = ["off", "streaming", "idle"];
const QUEUE_LABEL_KEYS: Record<QueueDeliveryMode, string> = {
  "one-at-a-time": "agent.behavior.queue.oneAtATime",
  all: "agent.behavior.queue.all",
};
const WARMING_LABEL_KEYS: Record<CacheWarmingMode, string> = {
  off: "agent.behavior.warming.off",
  streaming: "agent.behavior.warming.streaming",
  idle: "agent.behavior.warming.idle",
};

/** 16384 → "16K". */
export function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1024) === tokens / 1024 ? tokens / 1024 : Math.round(tokens / 1000)}K` : String(tokens);
}
/** `model:fixture/fixture-model` → { provider: "fixture", model: "fixture-model" }. */
export function parseModelKey(key: string): { provider: string; model: string } {
  const body = key.replace(/^model:/, "");
  const at = body.indexOf("/");
  const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  return at > 0 ? { provider: decode(body.slice(0, at)), model: decode(body.slice(at + 1)) } : { provider: "", model: decode(body) };
}
/** Keep the current value selectable even when it is not one of the presets. */
const withCurrent = (options: number[], current: number) => (options.includes(current) ? options : [...options, current].sort((a, b) => a - b));

function Row({ icon, title, hint, children, disabled }: { icon?: ReactNode; title: string; hint: string; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={"settings-row agent-behavior__row" + (disabled ? " agent-behavior__row--disabled" : "")}>
      <div className="agent-behavior__text">
        <span className="agent-behavior__title">{icon}{title}</span>
        <span className="agent-behavior__hint">{hint}</span>
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}
function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="ob-switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ob-switch__track" aria-hidden="true"><span className="ob-switch__thumb" /></span>
    </label>
  );
}
function Segmented<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: ReadonlyArray<readonly [T, string]>; disabled?: boolean; onChange: (value: T) => void }) {
  return (
    <div className="theme-toggle agent-behavior__seg" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} disabled={disabled} className={"theme-toggle__btn" + (value === id ? " theme-toggle__btn--active" : "")} onClick={() => value !== id && onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="agent-behavior__group" aria-label={title}>
      <h3 className="agent-behavior__group-title">{title}</h3>
      {children}
    </section>
  );
}

export function AgentBehaviorSettings() {
  const { t } = useLocale();
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    settingsAgentGet()
      .then((value) => { if (alive) setSettings(value); })
      .catch((error) => { if (alive) setStatus({ kind: "error", text: t("agent.behavior.readFailed", { error: friendlyError(error) }) }); });
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (patch: AgentSettingsPatch, optimistic: (s: AgentSettings) => AgentSettings) => {
    const id = ++seq.current;
    setSettings((s) => (s ? optimistic(s) : s));
    setSaving(true);
    setStatus(null);
    try {
      const saved = await settingsAgentSet(patch);
      if (id === seq.current) { setSettings(saved); setStatus({ kind: "ok", text: t("agent.behavior.saved") }); }
    } catch (error) {
      if (id === seq.current) {
        setStatus({ kind: "error", text: t("agent.behavior.saveFailed", { error: friendlyError(error) }) });
        settingsAgentGet().then(setSettings).catch(() => {});
      }
    } finally {
      if (id === seq.current) setSaving(false);
    }
  }, []);

  if (!settings) return status ? <p className="settings-msg settings-msg--warn">{status.text}</p> : <p className="settings-hint">{t("agent.behavior.loading")}</p>;
  const { autoCompaction: compaction, autoRetry: retry } = settings;
  const setCompaction = (patch: Partial<AgentSettings["autoCompaction"]>) => save({ autoCompaction: patch }, (s) => ({ ...s, autoCompaction: { ...s.autoCompaction, ...patch } }));
  const setRetry = (patch: Partial<AgentSettings["autoRetry"]>) => save({ autoRetry: patch }, (s) => ({ ...s, autoRetry: { ...s.autoRetry, ...patch } }));
  const setField = <K extends "steeringMode" | "followUpMode" | "cacheWarming">(key: K, value: AgentSettings[K]) => save({ [key]: value }, (s) => ({ ...s, [key]: value }));
  const removeFavorite = (key: string) => {
    const next = settings.favoriteModels.filter((k) => k !== key);
    void save({ favoriteModels: next }, (s) => ({ ...s, favoriteModels: next }));
  };
  const setBuiltin = (id: string, enabled: boolean) => save({ builtins: { [id]: enabled } }, (s) => ({ ...s, builtins: s.builtins.map((b) => (b.id === id ? { ...b, enabled } : b)) }));

  const queueOptions: ReadonlyArray<readonly [QueueDeliveryMode, string]> = QUEUE_MODES.map((mode) => [mode, t(QUEUE_LABEL_KEYS[mode])]);
  const warmingOptions: ReadonlyArray<readonly [CacheWarmingMode, string]> = WARMING_MODES.map((mode) => [mode, t(WARMING_LABEL_KEYS[mode])]);

  return (
    <div className="agent-behavior" aria-busy={saving}>
      <Group title={t("agent.behavior.group.context")}>
        <Row icon={<Layers size={15} />} title={t("agent.behavior.autoCompaction.title")} hint={t("agent.behavior.autoCompaction.hint")}>
          <Switch label={t("agent.behavior.autoCompaction.title")} checked={compaction.enabled} onChange={(enabled) => void setCompaction({ enabled })} />
        </Row>
        <Row title={t("agent.behavior.compaction.timing.title")} hint={t("agent.behavior.compaction.timing.hint")} disabled={!compaction.enabled}>
          <select className="agent-behavior__select" aria-label={t("agent.behavior.compaction.timing.aria")} value={compaction.reserveTokens} disabled={!compaction.enabled} onChange={(e) => void setCompaction({ reserveTokens: Number(e.target.value) })}>
            {withCurrent(RESERVE_OPTIONS, compaction.reserveTokens).map((n) => <option key={n} value={n}>{t("agent.behavior.compaction.reserveOption", { tokens: formatTokenCount(n) })}{n === 16384 ? t("agent.behavior.defaultSuffix") : ""}</option>)}
          </select>
        </Row>
        <Row title={t("agent.behavior.compaction.keep.title")} hint={t("agent.behavior.compaction.keep.hint")} disabled={!compaction.enabled}>
          <select className="agent-behavior__select" aria-label={t("agent.behavior.compaction.keep.aria")} value={compaction.keepRecentTokens} disabled={!compaction.enabled} onChange={(e) => void setCompaction({ keepRecentTokens: Number(e.target.value) })}>
            {withCurrent(KEEP_OPTIONS, compaction.keepRecentTokens).map((n) => <option key={n} value={n}>{t("agent.behavior.compaction.keepOption", { tokens: formatTokenCount(n) })}{n === 20000 ? t("agent.behavior.defaultSuffix") : ""}</option>)}
          </select>
        </Row>
      </Group>

      <Group title={t("agent.behavior.group.retry")}>
        <Row icon={<RotateCcw size={15} />} title={t("agent.behavior.autoRetry.title")} hint={t("agent.behavior.autoRetry.hint")}>
          <Switch label={t("agent.behavior.autoRetry.title")} checked={retry.enabled} onChange={(enabled) => void setRetry({ enabled })} />
        </Row>
        <Row title={t("agent.behavior.retry.max.title")} hint={t("agent.behavior.retry.max.hint")} disabled={!retry.enabled}>
          <select className="agent-behavior__select" aria-label={t("agent.behavior.retry.max.aria")} value={retry.maxRetries} disabled={!retry.enabled} onChange={(e) => void setRetry({ maxRetries: Number(e.target.value) })}>
            {withCurrent(RETRY_OPTIONS, retry.maxRetries).map((n) => <option key={n} value={n}>{t("agent.behavior.retry.maxOption", { n })}{n === 3 ? t("agent.behavior.defaultSuffix") : ""}</option>)}
          </select>
        </Row>
      </Group>

      <Group title={t("agent.behavior.group.steering")}>
        <Row icon={<ListOrdered size={15} />} title={t("agent.behavior.steering.title")} hint={t("agent.behavior.steering.hint")}>
          <Segmented label={t("agent.behavior.steering.aria")} value={settings.steeringMode} options={queueOptions} onChange={(v) => void setField("steeringMode", v)} />
        </Row>
        <Row title={t("agent.behavior.followUp.title")} hint={t("agent.behavior.followUp.hint")}>
          <Segmented label={t("agent.behavior.followUp.aria")} value={settings.followUpMode} options={queueOptions} onChange={(v) => void setField("followUpMode", v)} />
        </Row>
      </Group>

      <Group title={t("agent.behavior.group.cache")}>
        <Row icon={<Zap size={15} />} title={t("agent.behavior.cacheWarming.title")} hint={t("agent.behavior.cacheWarming.hint")}>
          <Segmented label={t("agent.behavior.cacheWarming.aria")} value={settings.cacheWarming} options={warmingOptions} onChange={(v) => void setField("cacheWarming", v)} />
        </Row>
      </Group>

      <Group title={t("agent.behavior.group.favorites")}>
        <div className="settings-row agent-behavior__row agent-behavior__row--column">
          <div className="agent-behavior__text">
            <span className="agent-behavior__title"><Star size={15} />{t("agent.behavior.favorites.quickTitle")}</span>
            <span className="agent-behavior__hint">{t("agent.behavior.favorites.quickHint")}</span>
          </div>
          {settings.favoriteModels.length ? (
            <ul className="agent-behavior__favorites" aria-label={t("agent.behavior.favorites.aria")}>
              {settings.favoriteModels.map((key) => {
                const { provider, model } = parseModelKey(key);
                return (
                  <li key={key} className="agent-behavior__favorite">
                    <Star size={13} className="agent-behavior__star" aria-hidden />
                    <span className="agent-behavior__favorite-name">{model}</span>
                    {provider && <span className="agent-behavior__favorite-provider">{provider}</span>}
                    <button type="button" className="settings-reset" aria-label={t("agent.behavior.favorites.removeAria", { model })} onClick={() => removeFavorite(key)}>{t("agent.behavior.favorites.remove")}</button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="agent-behavior__empty">{t("agent.behavior.favorites.empty")}</p>
          )}
        </div>
      </Group>

      {settings.builtins.length > 0 && (
        <Group title={t("agent.behavior.group.builtins")}>
          {settings.builtins.map((b) => (
            <Row key={b.id} icon={<Puzzle size={15} />} title={b.label} hint={b.description ?? b.id}>
              <Switch label={b.label} checked={b.enabled} onChange={(on) => void setBuiltin(b.id, on)} />
            </Row>
          ))}
          <p className="agent-behavior__note">{t("agent.behavior.builtins.note")}</p>
        </Group>
      )}

      <p className={"agent-behavior__status" + (status?.kind === "error" ? " agent-behavior__status--error" : "")} role="status" aria-live="polite">
        {saving ? t("agent.behavior.saving") : status?.text ?? ""}
      </p>
    </div>
  );
}
