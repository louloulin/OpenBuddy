import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, Shield } from "lucide-react";
import {
  DEFAULT_OIDC_CONFIG,
  loadOidcConfig,
  saveOidcConfig,
  startLogin,
  type OidcConfig,
} from "./oidc-client";

/**
 * 登录页：让管理员选择/覆盖 Casdoor issuer + clientId，
 * 然后走标准 OIDC/PKCE 流程。
 */
export function Login() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<OidcConfig>(() => loadOidcConfig() ?? DEFAULT_OIDC_CONFIG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      saveOidcConfig(cfg);
      await startLogin(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--wb-bg-primary)",
      }}
    >
      <form className="card" style={{ width: 420 }} onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Shield size={28} color="var(--wb-text-brand)" />
          <h1 style={{ margin: 0, fontSize: 22 }}>OpenBuddy Admin Portal</h1>
        </div>
        <p style={{ color: "var(--wb-text-tertiary)", marginTop: 0 }}>
          企业级 Agent 工作台管理控制台。通过 Casdoor OIDC/PKCE 登录。
        </p>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", marginBottom: 4, color: "var(--wb-text-secondary)" }}>
            Casdoor Issuer
          </span>
          <input
            className="input"
            style={{ width: "100%" }}
            value={cfg.issuer}
            onChange={(e) => setCfg({ ...cfg, issuer: e.target.value })}
            placeholder="https://casdoor.example.com"
            required
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", marginBottom: 4, color: "var(--wb-text-secondary)" }}>
            Client ID
          </span>
          <input
            className="input"
            style={{ width: "100%" }}
            value={cfg.clientId}
            onChange={(e) => setCfg({ ...cfg, clientId: e.target.value })}
            required
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", marginBottom: 4, color: "var(--wb-text-secondary)" }}>
            Redirect URI
          </span>
          <input
            className="input"
            style={{ width: "100%" }}
            value={cfg.redirectUri}
            onChange={(e) => setCfg({ ...cfg, redirectUri: e.target.value })}
            required
          />
        </label>

        <label style={{ display: "block", marginBottom: 24 }}>
          <span style={{ display: "block", marginBottom: 4, color: "var(--wb-text-secondary)" }}>
            Scope
          </span>
          <input
            className="input"
            style={{ width: "100%" }}
            value={cfg.scope}
            onChange={(e) => setCfg({ ...cfg, scope: e.target.value })}
          />
        </label>

        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          <LogIn size={16} /> {busy ? "跳转中…" : "登录 Casdoor"}
        </button>

        {error && (
          <p style={{ color: "var(--wb-status-error)", marginTop: 12 }}>
            登录失败：{error}
          </p>
        )}

        <p style={{ color: "var(--wb-text-tertiary)", marginTop: 16, fontSize: 12 }}>
          登录成功后会自动跳转到 Dashboard。如需返回客户端设置，请前往 OpenBuddy Desktop 的「设置 → 账户管理」。
        </p>
      </form>
    </div>
  );
}
