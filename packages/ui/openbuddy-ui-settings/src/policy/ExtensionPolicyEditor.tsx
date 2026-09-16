/**
 * ExtensionPolicyEditor — Pi 扩展准入名单编辑器(allow / deny)。
 *
 * 保存走 `extensionPolicySave()`:主进程做 trim + 去重 + 类型校验,以 0600
 * 写进 Pi agent root 的 `openbuddy-extension-policy.json`;下一次扩展解析
 * (configure 阶段)读回该文件 —— **不绕过** policy resolver / audit report /
 * needs-review gate 这三道既有闸门。
 *
 * 与 WorkBuddy 的差别是这里的:名单是**本地文件**,不上云、不需要管理员,
 * 用户自己就是策略的所有者。
 */
import { useEffect, useState } from "react";
import { extensionPolicyGet, extensionPolicySave } from "@/lib/agent/pi-client";

export interface ExtensionPolicyEditorProps {
  /** 初始名单(省略时从主进程读一次)。 */
  initial?: { allowlistPackageNames: string[]; denylistPackageNames: string[] };
  /** 保存成功回调。 */
  onSaved?: (policy: { allowlistPackageNames: string[]; denylistPackageNames: string[] }) => void;
  /** 瞬时反馈。 */
  onToast?: (message: string) => void;
}

/** 一行一个包名(逗号也当分隔符),trim + 去重。 */
function parseNames(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

export function ExtensionPolicyEditor({ initial, onSaved, onToast }: ExtensionPolicyEditorProps) {
  const [allowlist, setAllowlist] = useState(initial?.allowlistPackageNames.join("\n") ?? "");
  const [denylist, setDenylist] = useState(initial?.denylistPackageNames.join("\n") ?? "");
  const [status, setStatus] = useState<string>("");

  // initial 缺省时自己拉一次 —— 面板挂在设置里,打开时应该显示**当前**名单,
  // 而不是一张空表让人误以为"没有任何限制"。
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void extensionPolicyGet()
      .then((policy) => {
        if (cancelled) return;
        setAllowlist(policy.allowlistPackageNames.join("\n"));
        setDenylist(policy.denylistPackageNames.join("\n"));
      })
      .catch(() => {
        if (!cancelled) setStatus("无法读取当前扩展策略");
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const save = async () => {
    try {
      const result = await extensionPolicySave({
        allowlistPackageNames: parseNames(allowlist),
        denylistPackageNames: parseNames(denylist),
      });
      setStatus("已保存,下次解析扩展时生效");
      onSaved?.(result.policy);
    } catch {
      setStatus("保存失败");
      onToast?.("扩展策略保存失败");
    }
  };

  return (
    <div className="extension-policy-editor" data-testid="extension-policy-editor">
      <label className="extension-policy-editor__field">
        <span className="extension-policy-editor__label">允许名单(allowlist)</span>
        <textarea
          data-testid="extension-policy-allowlist"
          placeholder="一行一个包名,例如 pi-mcp-adapter"
          value={allowlist}
          onChange={(event) => setAllowlist(event.target.value)}
        />
      </label>
      <label className="extension-policy-editor__field">
        <span className="extension-policy-editor__label">拒绝名单(denylist)</span>
        <textarea
          data-testid="extension-policy-denylist"
          placeholder="一行一个包名,例如 pi-sketchy"
          value={denylist}
          onChange={(event) => setDenylist(event.target.value)}
        />
      </label>
      <div className="extension-policy-editor__actions">
        <button type="button" data-testid="extension-policy-save" onClick={() => void save()}>
          保存并重新解析
        </button>
        {status && (
          <output role="status" data-testid="extension-policy-status">
            {status}
          </output>
        )}
      </div>
    </div>
  );
}
