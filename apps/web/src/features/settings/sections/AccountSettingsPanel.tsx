import { appConfirm } from "../../../shared/ui/AppDialog";
import { useCallback, useEffect, useState } from "react";
import { Key } from "lucide-react";
import {
  accountGetApiKey,
  accountSetApiKey,
  agentAuthStatus,
  type AuthStatus,
} from "@openbuddy/client/agent-client";
import { SectionShell } from "./shared";

// ---------- 账户 ----------

export function AccountSettingsPanel() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // API key editor state.
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, k] = await Promise.all([
        agentAuthStatus().catch(() => null),
        accountGetApiKey().catch(() => null),
      ]);
      setAuth(a);
      setApiKey(k);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSaveKey = async () => {
    setBusy(true);
    try {
      await accountSetApiKey(keyDraft.trim() || null);
      setMsg(keyDraft.trim() ? "API Key 已保存" : "API Key 已清除");
      setEditingKey(false);
      setKeyDraft("");
      reload();
    } catch (e) {
      setMsg(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClearKey = async () => {
    if (!(await appConfirm({ title: "确定清除 xAI API Key？", confirmLabel: "清除", danger: true }))) return;
    setBusy(true);
    try {
      await accountSetApiKey(null);
      setMsg("API Key 已清除");
      reload();
    } catch (e) {
      setMsg(`清除失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const maskedKey = apiKey ? maskKey(apiKey) : null;

  return (
    <SectionShell
      title="API Key 管理"
      desc="xAI API Key（BYOK 认证）。无需浏览器登录 x.ai；设置 Key 或在「模型」tab 配置 BYOK provider 即可使用。"
    >
      {loading ? (
        <p className="settings-hint">加载中…</p>
      ) : (
        <>
          {/* BYOK providers */}
          {auth && auth.providers.length > 0 && (
            <div className="settings-row">
              <div className="settings-row__label">
                <span>BYOK 模型</span>
              </div>
              <div className="settings-row__control">
                <code>{auth.providers.join(", ")}</code>
              </div>
            </div>
          )}

          {/* API Key 管理 */}
          <div className="account-section">
            <h4 className="account-section__title">xAI API Key</h4>
            {!editingKey ? (
              <div className="settings-row">
                <div className="settings-row__label">
                  <Key size={16} />
                  <span>当前 Key</span>
                </div>
                <div className="settings-row__control">
                  {maskedKey ? (
                    <code>{showKey ? apiKey : maskedKey}</code>
                  ) : (
                    <span className="settings-warn">未设置</span>
                  )}
                  {maskedKey && (
                    <button
                      className="settings-reset"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? "隐藏" : "显示"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="account-key-editor">
                <input
                  type="password"
                  className="account-key-editor__input"
                  placeholder="xai-..."
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  autoFocus
                />
                <div className="account-key-editor__actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => {
                      setEditingKey(false);
                      setKeyDraft("");
                    }}
                    disabled={busy}
                  >
                    取消
                  </button>
                  <button
                    className="btn btn--primary"
                    onClick={handleSaveKey}
                    disabled={busy}
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
            {!editingKey && (
              <div className="settings-actions">
                <button
                  className="settings-btn"
                  onClick={() => {
                    setKeyDraft(apiKey ?? "");
                    setEditingKey(true);
                  }}
                  disabled={busy}
                >
                  {apiKey ? "更换" : "设置"} API Key
                </button>
                {apiKey && (
                  <button
                    className="settings-btn settings-btn--danger"
                    onClick={handleClearKey}
                    disabled={busy}
                  >
                    清除
                  </button>
                )}
              </div>
            )}
            <p className="settings-hint">
              API Key 存在 <code>应用数据目录/pi/config</code>，并设置
              <code>XAI_API_KEY</code> 环境变量。BYOK 模型在「模型」tab 配置。
            </p>
          </div>

          {msg && <p className="settings-msg">{msg}</p>}

          {!auth?.ready && (
            <p className="settings-hint">
              未就绪。请设置 xAI API Key，或在「模型」tab 配置 BYOK provider。
            </p>
          )}
        </>
      )}
    </SectionShell>
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
