/**
 * Pairing gate for the browser build (20261115-mobile.md Phase 3.5).
 *
 * The page is served same-origin by the gateway, so the address field is only
 * needed when the gateway lives elsewhere (a local dev server, an H5 bundle on
 * a static host). One code, one button, then the real application loads.
 */

import { useState } from "react";
import { claimPairing, installPairing } from "./boot";

export function PairingGate({ onPaired }: { onPaired: () => void }) {
  const [gateway, setGateway] = useState(() => (typeof location === "undefined" ? "" : location.origin));
  const [code, setCode] = useState("");
  const [name, setName] = useState("浏览器");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!/^\d{8}$/.test(trimmed)) {
      setError("配对码是 8 位数字。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pairing = await claimPairing(gateway.trim().replace(/\/+$/, ""), trimmed, name.trim() || "浏览器");
      installPairing(pairing);
      onPaired();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h5-gate">
      <form className="h5-gate__card" onSubmit={submit}>
        <div className="h5-gate__mark" aria-hidden>✦</div>
        <h1 className="h5-gate__title">连接你的电脑</h1>
        <p className="h5-gate__lead">
          在桌面端 OpenBuddy 打开「手机接入」，把 8 位配对码填在这里。
          对话在你的电脑上执行，模型密钥从不离开桌面。
        </p>

        <label className="h5-gate__label" htmlFor="h5-gateway">网关地址</label>
        <input
          id="h5-gateway"
          className="h5-gate__input"
          value={gateway}
          onChange={event => setGateway(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />

        <label className="h5-gate__label" htmlFor="h5-code">8 位配对码</label>
        <input
          id="h5-code"
          className="h5-gate__input h5-gate__input--code"
          value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          placeholder="••••••••"
          autoFocus
        />

        <label className="h5-gate__label" htmlFor="h5-name">设备名</label>
        <input
          id="h5-name"
          className="h5-gate__input"
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={40}
        />

        {error ? <div className="h5-gate__error" role="alert">{error}</div> : null}

        <button className="h5-gate__submit" type="submit" disabled={busy || code.length !== 8}>
          {busy ? "连接中…" : "连接"}
        </button>
      </form>
    </div>
  );
}
