import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Layers, ListOrdered, Puzzle, RotateCcw, Star, Zap } from "lucide-react";
import { settingsAgentGet, settingsAgentSet } from "@openbuddy/client/api/model";
import type { AgentSettings, AgentSettingsPatch, CacheWarmingMode, QueueDeliveryMode } from "@openbuddy/protocol/agent-settings";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import "./agent-behavior.css";

/**
 * 设置 · 智能体 → 运行行为 (20261116-pii W0.4). Every control saves at once into pi-settings.json
 * through `settings_agent_set`; the engine hands the change to every open session immediately.
 */

const RESERVE_OPTIONS = [8192, 16384, 32768, 65536];
const KEEP_OPTIONS = [10000, 20000, 40000, 80000];
const RETRY_OPTIONS = [1, 2, 3, 5, 8, 10];
const QUEUE_OPTIONS: ReadonlyArray<readonly [QueueDeliveryMode, string]> = [["one-at-a-time", "逐条"], ["all", "合并"]];
const WARMING_OPTIONS: ReadonlyArray<readonly [CacheWarmingMode, string]> = [["off", "关闭"], ["streaming", "回复时"], ["idle", "始终"]];

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
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    settingsAgentGet()
      .then((value) => { if (alive) setSettings(value); })
      .catch((error) => { if (alive) setStatus({ kind: "error", text: `读取失败：${friendlyError(error)}` }); });
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (patch: AgentSettingsPatch, optimistic: (s: AgentSettings) => AgentSettings) => {
    const id = ++seq.current;
    setSettings((s) => (s ? optimistic(s) : s));
    setSaving(true);
    setStatus(null);
    try {
      const saved = await settingsAgentSet(patch);
      if (id === seq.current) { setSettings(saved); setStatus({ kind: "ok", text: "已保存，已打开的任务立即生效" }); }
    } catch (error) {
      if (id === seq.current) {
        setStatus({ kind: "error", text: `保存失败：${friendlyError(error)}` });
        settingsAgentGet().then(setSettings).catch(() => {});
      }
    } finally {
      if (id === seq.current) setSaving(false);
    }
  }, []);

  if (!settings) return status ? <p className="settings-msg settings-msg--warn">{status.text}</p> : <p className="settings-hint">正在读取智能体设置…</p>;
  const { autoCompaction: compaction, autoRetry: retry } = settings;
  const setCompaction = (patch: Partial<AgentSettings["autoCompaction"]>) => save({ autoCompaction: patch }, (s) => ({ ...s, autoCompaction: { ...s.autoCompaction, ...patch } }));
  const setRetry = (patch: Partial<AgentSettings["autoRetry"]>) => save({ autoRetry: patch }, (s) => ({ ...s, autoRetry: { ...s.autoRetry, ...patch } }));
  const setField = <K extends "steeringMode" | "followUpMode" | "cacheWarming">(key: K, value: AgentSettings[K]) => save({ [key]: value }, (s) => ({ ...s, [key]: value }));
  const removeFavorite = (key: string) => {
    const next = settings.favoriteModels.filter((k) => k !== key);
    void save({ favoriteModels: next }, (s) => ({ ...s, favoriteModels: next }));
  };
  const setBuiltin = (id: string, enabled: boolean) => save({ builtins: { [id]: enabled } }, (s) => ({ ...s, builtins: s.builtins.map((b) => (b.id === id ? { ...b, enabled } : b)) }));

  return (
    <div className="agent-behavior" aria-busy={saving}>
      <Group title="上下文与压缩">
        <Row icon={<Layers size={15} />} title="自动压缩" hint="上下文快满时，自动把较早的对话总结成摘要，长任务不中断">
          <Switch label="自动压缩" checked={compaction.enabled} onChange={(enabled) => void setCompaction({ enabled })} />
        </Row>
        <Row title="压缩时机" hint="上下文剩余空间少于这个值时开始压缩；越大越早压缩" disabled={!compaction.enabled}>
          <select className="agent-behavior__select" aria-label="压缩时机" value={compaction.reserveTokens} disabled={!compaction.enabled} onChange={(e) => void setCompaction({ reserveTokens: Number(e.target.value) })}>
            {withCurrent(RESERVE_OPTIONS, compaction.reserveTokens).map((n) => <option key={n} value={n}>剩余 {formatTokenCount(n)}{n === 16384 ? "（默认）" : ""}</option>)}
          </select>
        </Row>
        <Row title="保留最近内容" hint="压缩时原样保留的最近对话量，其余部分会被总结" disabled={!compaction.enabled}>
          <select className="agent-behavior__select" aria-label="保留最近内容" value={compaction.keepRecentTokens} disabled={!compaction.enabled} onChange={(e) => void setCompaction({ keepRecentTokens: Number(e.target.value) })}>
            {withCurrent(KEEP_OPTIONS, compaction.keepRecentTokens).map((n) => <option key={n} value={n}>{formatTokenCount(n)} tokens{n === 20000 ? "（默认）" : ""}</option>)}
          </select>
        </Row>
      </Group>

      <Group title="出错重试">
        <Row icon={<RotateCcw size={15} />} title="自动重试" hint="遇到限流、服务过载或网络中断时，等待片刻后自动重试">
          <Switch label="自动重试" checked={retry.enabled} onChange={(enabled) => void setRetry({ enabled })} />
        </Row>
        <Row title="最多重试" hint="连续失败超过这个次数就停下并提示你" disabled={!retry.enabled}>
          <select className="agent-behavior__select" aria-label="最多重试次数" value={retry.maxRetries} disabled={!retry.enabled} onChange={(e) => void setRetry({ maxRetries: Number(e.target.value) })}>
            {withCurrent(RETRY_OPTIONS, retry.maxRetries).map((n) => <option key={n} value={n}>{n} 次{n === 3 ? "（默认）" : ""}</option>)}
          </select>
        </Row>
      </Group>

      <Group title="回复中发送的消息">
        <Row icon={<ListOrdered size={15} />} title="插话" hint="回复中按 Ctrl/⌘+Enter 插入的话。逐条：每轮只送一条；合并：攒下的一次送出">
          <Segmented label="插话的发送方式" value={settings.steeringMode} options={QUEUE_OPTIONS} onChange={(v) => void setField("steeringMode", v)} />
        </Row>
        <Row title="追加" hint="回复中按 Enter 排队的消息，在本轮结束后发送。合并会把排队的几条一起发出">
          <Segmented label="追加的发送方式" value={settings.followUpMode} options={QUEUE_OPTIONS} onChange={(v) => void setField("followUpMode", v)} />
        </Row>
      </Group>

      <Group title="提示缓存">
        <Row icon={<Zap size={15} />} title="缓存预热" hint="让模型服务商的提示缓存保持有效，长对话更快、更省。“始终”会在空闲时发送少量预热请求">
          <Segmented label="缓存预热" value={settings.cacheWarming} options={WARMING_OPTIONS} onChange={(v) => void setField("cacheWarming", v)} />
        </Row>
      </Group>

      <Group title="收藏模型">
        <div className="settings-row agent-behavior__row agent-behavior__row--column">
          <div className="agent-behavior__text">
            <span className="agent-behavior__title"><Star size={15} />快速切换</span>
            <span className="agent-behavior__hint">在输入框的模型菜单里点 ☆ 收藏；对话中按 Ctrl/⌘+P 在收藏的模型之间轮换</span>
          </div>
          {settings.favoriteModels.length ? (
            <ul className="agent-behavior__favorites" aria-label="收藏的模型">
              {settings.favoriteModels.map((key) => {
                const { provider, model } = parseModelKey(key);
                return (
                  <li key={key} className="agent-behavior__favorite">
                    <Star size={13} className="agent-behavior__star" aria-hidden />
                    <span className="agent-behavior__favorite-name">{model}</span>
                    {provider && <span className="agent-behavior__favorite-provider">{provider}</span>}
                    <button type="button" className="settings-reset" aria-label={`取消收藏 ${model}`} onClick={() => removeFavorite(key)}>取消收藏</button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="agent-behavior__empty">还没有收藏的模型</p>
          )}
        </div>
      </Group>

      {settings.builtins.length > 0 && (
        <Group title="内置扩展">
          {settings.builtins.map((b) => (
            <Row key={b.id} icon={<Puzzle size={15} />} title={b.label} hint={b.description ?? b.id}>
              <Switch label={b.label} checked={b.enabled} onChange={(on) => void setBuiltin(b.id, on)} />
            </Row>
          ))}
          <p className="agent-behavior__note">内置扩展是 OpenBuddy 自带的功能，不受“用户扩展”总开关影响；切换后已打开的任务会自动重新加载。</p>
        </Group>
      )}

      <p className={"agent-behavior__status" + (status?.kind === "error" ? " agent-behavior__status--error" : "")} role="status" aria-live="polite">
        {saving ? "保存中…" : status?.text ?? ""}
      </p>
    </div>
  );
}
