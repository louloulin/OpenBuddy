import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Save, Cpu } from "lucide-react";
import { providersLocalGet, providersLocalProbe, providersLocalSet } from "@openbuddy/client/agent-client";
import { DEFAULT_LOCAL_MODEL_CONFIG, type LocalModelConfig, type LocalModelProbe, type LocalModelState } from "@openbuddy/protocol/local-model";
import { errorText } from "./shared";

/**
 * 设置 · 模型 · 本地模型 (20261116-pii W8).
 *
 * Points OpenBuddy at a local llama.cpp server (OpenAI-compatible `/v1`), probes its
 * model list and registers it as a normal provider, so the model picker, experts and
 * sub-agents can all use it.
 */
export function LocalModelCard({ onSaved }: { onSaved?: () => void }) {
  const [state, setState] = useState<LocalModelState | null>(null);
  const [draft, setDraft] = useState<LocalModelConfig>(DEFAULT_LOCAL_MODEL_CONFIG);
  const [probe, setProbe] = useState<LocalModelProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    providersLocalGet()
      .then((result) => { if (!cancelled) { setState(result); setDraft(result.config); } })
      .catch((error) => { if (!cancelled) setMsg({ kind: "err", text: `读取本地模型配置失败：${errorText(error)}` }); });
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
        ? { kind: "ok", text: `已连接，发现 ${result.models.length} 个模型 · ${result.ms}ms` }
        : { kind: "err", text: `连接失败：${result.error ?? "未知错误"}` });
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
      setMsg({ kind: "ok", text: next.config.enabled ? "本地模型已启用，可在模型菜单里选择" : "已停用本地模型" });
      onSaved?.();
    } catch (error) {
      setMsg({ kind: "err", text: `保存失败：${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const choices = Array.from(new Set([...(probe?.models ?? []), ...(state?.models.map((model) => model.modelId) ?? []), ...(draft.model ? [draft.model] : [])]));

  return (
    <section className="ms-local" aria-label="本地模型">
      <div className="ms-local__head">
        <div className="ms-local__title"><Cpu size={16} /><span>本地模型</span><span className="ms-local__badge">llama.cpp</span></div>
        <label className="ms-local__switch">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          <span>{draft.enabled ? "已启用" : "已停用"}</span>
        </label>
      </div>
      <p className="ms-local__hint">连接本机 llama-server（OpenAI 兼容 <code>/v1</code>）。启用后会出现在模型菜单、专家与子代理里，请求不出本机。</p>
      <div className="ms-local__row">
        <label className="ms-local__field ms-local__field--wide">
          <span>服务地址</span>
          <input value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:8080/v1" spellCheck={false} />
        </label>
        <button type="button" className="ms-btn" onClick={() => void runProbe()} disabled={busy || !draft.baseUrl.trim()}>
          {busy ? <Loader2 size={14} className="ms-spin" /> : <RefreshCw size={14} />}探测
        </button>
      </div>
      <div className="ms-local__row">
        <label className="ms-local__field">
          <span>模型</span>
          {choices.length > 0 ? (
            <select value={draft.model} onChange={(event) => update({ model: event.target.value })} aria-label="本地模型">
              <option value="">选择模型…</option>
              {choices.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input value={draft.model} onChange={(event) => update({ model: event.target.value })} placeholder="例如 qwen2.5-7b-instruct" spellCheck={false} />
          )}
        </label>
        <label className="ms-local__field">
          <span>上下文窗口</span>
          <input type="number" min={1024} step={1024} value={draft.contextWindow} onChange={(event) => update({ contextWindow: Number(event.target.value) || 8192 })} />
        </label>
        <label className="ms-local__field">
          <span>最大输出</span>
          <input type="number" min={256} step={256} value={draft.maxTokens} onChange={(event) => update({ maxTokens: Number(event.target.value) || 4096 })} />
        </label>
      </div>
      <div className="ms-local__actions">
        <label className="ms-local__check">
          <input type="checkbox" checked={draft.setDefault} onChange={(event) => update({ setDefault: event.target.checked })} />
          <span>设为新任务的默认模型</span>
        </label>
        <button type="button" className="ms-btn ms-btn--primary" onClick={() => void save()} disabled={busy || (draft.enabled && !draft.model.trim())}>
          {busy ? <Loader2 size={14} className="ms-spin" /> : <Save size={14} />}保存
        </button>
      </div>
      {msg && <p className={"ms-local__msg ms-local__msg--" + msg.kind} role="status">{msg.text}</p>}
    </section>
  );
}
