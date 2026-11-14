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

export function ModelEditor({ provider, original, taken, onCancel, onSaved }: {
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
