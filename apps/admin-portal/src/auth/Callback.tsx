import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { handleCallback } from "./oidc-client";

/**
 * Casdoor OIDC 回调页：校验 state + 换 token + 拉 userinfo，然后跳转到 Dashboard。
 */
export function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback(searchParams)
      .then(() => navigate("/", { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [navigate, searchParams]);

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
      <div className="card" style={{ textAlign: "center" }}>
        {error ? (
          <>
            <h2 style={{ color: "var(--wb-status-error)" }}>登录失败</h2>
            <p>{error}</p>
            <a className="btn btn-secondary" href="/login">返回登录</a>
          </>
        ) : (
          <>
            <h2>正在完成登录…</h2>
            <p style={{ color: "var(--wb-text-tertiary)" }}>校验 OIDC 回调并换取访问令牌</p>
          </>
        )}
      </div>
    </div>
  );
}
