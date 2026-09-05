/**
 * OpenBuddy Token 内省面板。
 *
 * 把任意 access_token / refresh_token 交给 Casdoor /api/v1/introspect 校验，
 * 返回 active 标志 + 标准 OAuth2 声明（sub / scope / exp / iat / aud / iss
 * / jti 等）。每次内省会写入 `casdoor.management` 审计事件，可用于排查
 * SSO、OAuth PKCE、退登与会话撤销时的 token 验证问题。
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, Search } from "lucide-react";
import {
  casdoorIntrospectToken,
  casdoorStatus,
} from "@/lib/casdoor/casdoor-client";
import type {
  CasdoorIntrospectInput,
  CasdoorTokenIntrospection,
} from "@/lib/casdoor/casdoor-client";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

function formatEpoch(value: number | undefined): string {
  if (typeof value !== "number") return "—";
  try {
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  } catch {
    return String(value);
  }
}

export function TokenIntrospectionPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [hint, setHint] = useState<CasdoorIntrospectInput["tokenTypeHint"]>("access_token");
  const [result, setResult] = useState<CasdoorTokenIntrospection | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await casdoorStatus().catch(() => null);
      if (cancelled) return;
      setTenantId(session?.tenantContext.activeTenantId ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleIntrospect = useCallback(async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setMessage({ kind: "warn", text: "请粘贴或输入要校验的 token" });
      setResult(null);
      return;
    }
    setLoading(true);
    try {
      const data = await casdoorIntrospectToken({ token: trimmed, tokenTypeHint: hint });
      setResult(data);
      setMessage({
        kind: data.active ? "ok" : "warn",
        text: data.active
          ? `token 有效（${data.tokenType ?? hint ?? "access_token"} · ${data.sub ?? data.username ?? "未知主体"}）`
          : "token 当前在 Casdoor 端被视为无效（可能已撤销或过期）",
      });
    } catch (error) {
      setResult(null);
      setMessage({ kind: "err", text: `内省失败：${describeError(error)}` });
    } finally {
      setLoading(false);
    }
  }, [token, hint]);

  const handleReset = useCallback(() => {
    setResult(null);
    setMessage(null);
    setToken("");
    setHint("access_token");
  }, []);

  return (
    <SectionShell
      title="Token 内省"
      desc="通过 Casdoor /api/v1/introspect 校验任意 access_token 或 refresh_token 是否有效，查看 scope / 过期时间 / 主体 / jti 等。每次校验都会写入审计日志。"
    >
      {!tenantId ? (
        <p className="settings-hint">请先登录并选择租户，再使用 Token 内省。</p>
      ) : (
        <p className="settings-hint">当前租户：<strong>{tenantId}</strong> · 需要 <code>tenant.users.read</code> 权限</p>
      )}

      <div className="account-section" data-testid="token-introspection-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <KeyRound size={16} /> 输入 Token
          </h3>
        </div>

        <div className="settings-row">
          <div className="settings-row__label">
            <span>token 类型</span>
          </div>
          <div className="settings-row__control">
            <label className="settings-radio">
              <input
                type="radio"
                name="token-type-hint"
                value="access_token"
                checked={hint === "access_token"}
                onChange={() => setHint("access_token")}
                data-testid="token-introspection-hint-access"
              />
              access_token
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="token-type-hint"
                value="refresh_token"
                checked={hint === "refresh_token"}
                onChange={() => setHint("refresh_token")}
                data-testid="token-introspection-hint-refresh"
              />
              refresh_token
            </label>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row__label">
            <span>token 值</span>
          </div>
          <div className="settings-row__control">
            <textarea
              className="settings-textarea"
              rows={4}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="粘贴完整 JWT 或 Opaque token…"
              data-testid="token-introspection-input"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="settings-actions">
          <button
            className="settings-btn"
            onClick={handleIntrospect}
            disabled={loading}
            data-testid="token-introspection-submit"
          >
            {loading ? <Loader2 size={14} className="spin" /> : <Search size={14} />} 内省
          </button>
          <button
            className="settings-btn settings-btn--ghost"
            onClick={handleReset}
            disabled={loading}
            data-testid="token-introspection-reset"
          >
            <RefreshCw size={14} /> 清空
          </button>
        </div>
      </div>

      {result && (
        <div className="account-section" data-testid="token-introspection-result">
          <div className="account-section__header">
            <h3 className="account-section__title">
              <KeyRound size={16} /> 内省结果
            </h3>
            <span
              className={`account-badge ${result.active ? "account-badge--ok" : "account-badge--err"}`}
              data-testid="token-introspection-active-badge"
            >
              {result.active ? "active = true" : "active = false"}
            </span>
          </div>

          <ul className="shortcuts-list">
            <li className="shortcuts-list__row" data-testid="token-introspection-row-sub">
              <span className="shortcuts-list__action">主体 (sub)</span>
              <span className="shortcuts-list__key">{result.sub ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-username">
              <span className="shortcuts-list__action">用户名 (username)</span>
              <span className="shortcuts-list__key">{result.username ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-client">
              <span className="shortcuts-list__action">客户端 (client_id)</span>
              <span className="shortcuts-list__key">{result.clientId ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-scope">
              <span className="shortcuts-list__action">scope</span>
              <span className="shortcuts-list__key">{result.scope ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-token-type">
              <span className="shortcuts-list__action">token 类型</span>
              <span className="shortcuts-list__key">{result.tokenType ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-iss">
              <span className="shortcuts-list__action">签发者 (iss)</span>
              <span className="shortcuts-list__key">{result.iss ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-aud">
              <span className="shortcuts-list__action">受众 (aud)</span>
              <span className="shortcuts-list__key">{result.aud ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-jti">
              <span className="shortcuts-list__action">jti</span>
              <span className="shortcuts-list__key">{result.jti ?? "—"}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-iat">
              <span className="shortcuts-list__action">签发时间 (iat)</span>
              <span className="shortcuts-list__key">{formatEpoch(result.iat)}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-nbf">
              <span className="shortcuts-list__action">生效时间 (nbf)</span>
              <span className="shortcuts-list__key">{formatEpoch(result.nbf)}</span>
            </li>
            <li className="shortcuts-list__row" data-testid="token-introspection-row-exp">
              <span className="shortcuts-list__action">过期时间 (exp)</span>
              <span className="shortcuts-list__key">{formatEpoch(result.exp)}</span>
            </li>
          </ul>
        </div>
      )}

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="token-introspection-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default TokenIntrospectionPanel;
