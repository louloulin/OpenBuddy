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

/* ------------------------------------------------------------------ */
/* 厂商编辑 */

export function ProviderEditor({ original, takenIds, onCancel, onSaved }: {
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
