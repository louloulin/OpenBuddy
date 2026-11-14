/**
 * 策略设置面板 —— 企业策略/IOA 替代的 UI。
 *
 * 展示当前策略集(模型白名单、技能上传、权限模式、功能禁用),支持查看/编辑。
 */
import { useEffect, useState } from "react";
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
} from "@/features/settings/policy-engine";
import { CheckIcon, XCloseIcon } from "@openbuddy/ui/icon/icons/index";

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
  }, []);

  const update = (rules: PolicyRule[]) => {
    const merged = mergeRules(rules);
    savePolicy(merged);
    setPolicy(merged);
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
  const setPermissionMode = (mode: "ask" | "auto" | "always-approve" | "") => {
    const rules = policy.rules.filter((r) => r.type !== "permission-mode");
    if (mode) rules.push({ type: "permission-mode", value: mode, priority: 1 });
    update(rules);
  };

  return (
    <div className="policy-panel" role="region" aria-label="策略设置">
      <div className="policy-panel__head">
        <span className="policy-panel__title">策略设置</span>
        <span className="policy-panel__hint">本地策略预览，尚未强制执行</span>
      </div>

      <p className="policy-panel__hint">规则仅保存在本机供预览，不会限制实际模型调用、技能安装或主进程权限。</p>

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
        <select value={lockedMode ?? ""} onChange={(e) => setPermissionMode(e.target.value as "ask" | "auto" | "always-approve" | "")}>
          <option value="">不锁定(用户自选)</option>
          <option value="ask">审批模式</option>
          <option value="auto">自动模式</option>
          <option value="always-approve">始终允许</option>
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
