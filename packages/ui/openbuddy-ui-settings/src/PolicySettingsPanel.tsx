/**
 * 策略设置面板 —— 企业策略/IOA 替代的 UI。
 *
 * 展示当前策略集(模型白名单、技能上传、权限模式、功能禁用),支持查看/编辑。
 */
import { useEffect, useState } from "react";
import { useT } from "@/lib/platform/i18n";
import {
  mergeRules,
  getPolicyValue,
  isModelAllowed,
  canUploadSkill,
  getLockedPermissionMode,
  serializePolicySet,
  deserializePolicySet,
  type PolicyRule,
  type PolicySet,
} from "@/lib/security/policy-engine";
import { CheckIcon, XCloseIcon } from "@openbuddy/ui-primitives/icons";
import { invoke } from "@/lib/platform/electron-api";

const POLICY_KEY = "openbuddy.policy";

function loadPolicy(): PolicySet {
  if (typeof window === "undefined") return { rules: [] };
  try {
    const raw = window.localStorage.getItem(POLICY_KEY);
    if (!raw) return { rules: [] };
    return deserializePolicySet(raw);
  } catch {
    return { rules: [] };
  }
}

function savePolicy(set: PolicySet): void {
  try {
    window.localStorage.setItem(POLICY_KEY, serializePolicySet(set));
  } catch {
    /* noop */
  }
}

export function PolicySettingsPanel({ onToast: _onToast }: { onToast?: (msg: string) => void }) {
  const [policy, setPolicy] = useState<PolicySet>({ rules: [] });
  const [modelInput, setModelInput] = useState("");
  const [featureInput, setFeatureInput] = useState("");

  useEffect(() => {
    setPolicy(loadPolicy());
    void invoke<{ rules: PolicyRule[] }>("policy:get")
      .then((remote) => {
        const next = mergeRules(remote.rules ?? []);
        setPolicy(next);
        savePolicy(next);
      })
      .catch(() => undefined);
  }, []);

  const update = (rules: PolicyRule[]) => {
    const merged = mergeRules(rules);
    savePolicy(merged);
    setPolicy(merged);
    void invoke("policy:save", { policy: merged }).catch(() => _onToast?.("策略已保存到本地界面，但 Electron 持久化失败"));
  };

  const whitelist = getPolicyValue<string[]>(policy, "model-whitelist") ?? [];
  const disabledFeatures = getPolicyValue<string[]>(policy, "disabled-features") ?? [];
  const lockedMode = getLockedPermissionMode(policy);

  const addModel = () => {
    const m = modelInput.trim();
    if (!m || whitelist.includes(m)) return;
    update([...policy.rules, { type: "model-whitelist", value: [...whitelist, m], priority: 1 }]);
    setModelInput("");
  };
  const removeModel = (m: string) => {
    update([...policy.rules, { type: "model-whitelist", value: whitelist.filter((x) => x !== m), priority: 1 }]);
  };
  const addFeature = () => {
    const f = featureInput.trim();
    if (!f || disabledFeatures.includes(f)) return;
    update([...policy.rules, { type: "disabled-features", value: [...disabledFeatures, f], priority: 1 }]);
    setFeatureInput("");
  };
  const removeFeature = (f: string) => {
    update([...policy.rules, { type: "disabled-features", value: disabledFeatures.filter((x) => x !== f), priority: 1 }]);
  };
  const toggleSkillUpload = () => {
    const current = canUploadSkill(policy);
    update([...policy.rules, { type: "skill-upload", value: current, priority: 0 }, { type: "skill-upload", value: !current, priority: 1 }]);
  };
  const setPermissionMode = (mode: "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions" | "") => {
    const rules = policy.rules.filter((r) => r.type !== "permission-mode");
    if (mode) rules.push({ type: "permission-mode", value: mode, priority: 1 });
    update(rules);
  };
  // 文案走 i18n,默认 zh-CN
  const tLockedNone = useT("permission.lockedModeNone");
  const tDefault = useT("permission.modes.default");
  const tAccept = useT("permission.modes.acceptEdits");
  const tDontAsk = useT("permission.modes.dontAsk");
  const tPlan = useT("permission.modes.plan");
  const tBypass = useT("permission.modes.bypassPermissions");

  return (
    <div className="policy-panel" role="region" aria-label="策略设置">
      <div className="policy-panel__head">
        <span className="policy-panel__title">策略设置</span>
        <span className="policy-panel__hint">本地策略管控(企业策略的可移植替代)</span>
      </div>

      {/* 模型白名单 */}
      <div className="policy-panel__section">
        <div className="policy-panel__section-title">模型白名单 {whitelist.length > 0 && `(${whitelist.length})`}</div>
        {whitelist.length > 0 ? (
          <div className="policy-panel__chips">
            {whitelist.map((m) => (
              <span key={m} className="policy-panel__chip">
                {m}
                <button type="button" onClick={() => removeModel(m)} aria-label={`移除 ${m}`}>×</button>
              </span>
            ))}
          </div>
        ) : (
          <p className="policy-panel__muted">无限制(所有模型可用)</p>
        )}
        <div className="policy-panel__input-row">
          <input type="text" placeholder="模型 id(如 gpt-4)" value={modelInput} onChange={(e) => setModelInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addModel()} />
          <button type="button" onClick={addModel}>添加</button>
        </div>
      </div>

      {/* 技能上传策略 */}
      <div className="policy-panel__section">
        <div className="policy-panel__section-title">技能上传</div>
        <label className="policy-panel__toggle">
          <input type="checkbox" checked={canUploadSkill(policy)} onChange={toggleSkillUpload} />
          <span>允许上传/安装技能</span>
        </label>
      </div>

      {/* 权限模式 */}
      <div className="policy-panel__section">
        <div className="policy-panel__section-title">锁定权限模式</div>
        <select value={lockedMode ?? ""} onChange={(e) => setPermissionMode(e.target.value as "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions" | "")}>
          <option value="">{tLockedNone}</option>
          <option value="default">{tDefault}</option>
          <option value="acceptEdits">{tAccept}</option>
          <option value="dontAsk">{tDontAsk}</option>
          <option value="plan">{tPlan}</option>
          <option value="bypassPermissions">{tBypass}</option>
        </select>
      </div>

      {/* 禁用功能 */}
      <div className="policy-panel__section">
        <div className="policy-panel__section-title">禁用功能 {disabledFeatures.length > 0 && `(${disabledFeatures.length})`}</div>
        {disabledFeatures.length > 0 ? (
          <div className="policy-panel__chips">
            {disabledFeatures.map((f) => (
              <span key={f} className="policy-panel__chip policy-panel__chip--danger">
                {f}
                <button type="button" onClick={() => removeFeature(f)} aria-label={`启用 ${f}`}>×</button>
              </span>
            ))}
          </div>
        ) : (
          <p className="policy-panel__muted">无禁用功能</p>
        )}
        <div className="policy-panel__input-row">
          <input type="text" placeholder="功能名(如 browser-preview)" value={featureInput} onChange={(e) => setFeatureInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFeature()} />
          <button type="button" onClick={addFeature}>禁用</button>
        </div>
      </div>

      {/* 策略检查预览 */}
      <div className="policy-panel__section">
        <div className="policy-panel__section-title">策略检查(预览)</div>
        <div className="policy-panel__checks">
          <span className={isModelAllowed(policy, "gpt-4") ? "ok" : "deny"}>
            gpt-4:{" "}
            {isModelAllowed(policy, "gpt-4") ? (
              <>
                <CheckIcon size="sm" /> 允许
              </>
            ) : (
              <>
                <XCloseIcon size="sm" /> 禁止
              </>
            )}
          </span>
          <span className={canUploadSkill(policy) ? "ok" : "deny"}>
            技能上传:{" "}
            {canUploadSkill(policy) ? (
              <>
                <CheckIcon size="sm" /> 允许
              </>
            ) : (
              <>
                <XCloseIcon size="sm" /> 禁止
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
