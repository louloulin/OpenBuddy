/**
 * 手机接入 (20261115-mobile.md §4.4).
 *
 * The desktop half of pairing: mint a one-time code, show it as a QR the phone
 * scans, and manage the phones already bound to this computer. The gateway's
 * admin credential never reaches this component — `mobile_*` commands run in
 * the main process (`apps/desktop/src/native/mobile-access.ts`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { invoke } from "@openbuddy/client/ipc";
import { useCapability } from "@/app/state/capabilities-store";
import { SectionShell } from "./shared";

type Pairing = { code: string; expiresAt: string; qr?: string; scopes: string[] };
type Device = {
  id: string;
  name: string;
  platform: string;
  createdAt?: string;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
};
type DevicesAnswer = { configured: boolean; gatewayUrl: string | null; devices: Device[] };

const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android", web: "浏览器", mobile: "手机" };

function relative(iso: string | null | undefined): string {
  if (!iso) return "从未连接";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "未知";
  const delta = Date.now() - ms;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

function secondsLeft(expiresAt: string): number {
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : 0;
}

export function MobileAccessPanel() {
  const available = useCapability("mobile_pair_start");
  const [state, setState] = useState<DevicesAnswer | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await invoke<DevicesAnswer>("mobile_devices_list"));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    void load();
  }, [available, load]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const startPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<Pairing>("mobile_pair_start", {});
      setPairing(next);
      setQr(next.qr ? await QRCode.toDataURL(next.qr, { margin: 1, width: 220 }) : null);
      setCountdown(secondsLeft(next.expiresAt));
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => {
        const left = secondsLeft(next.expiresAt);
        setCountdown(left);
        if (left <= 0 && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
          setPairing(null);
          setQr(null);
        }
      }, 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: Device) => {
    if (!window.confirm(`断开「${device.name}」？它会立即失去访问权，需要重新扫码。`)) return;
    setBusy(true);
    try {
      await invoke("mobile_device_revoke", { id: device.id });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return (
      <SectionShell title="手机接入" desc="这台电脑运行在浏览器里，配对码只能在桌面应用里生成。">
        <p className="settings-hint">在桌面端打开「设置 → 手机接入」扫码配对；浏览器页面在网关的 /h5 下可自行输入配对码。</p>
      </SectionShell>
    );
  }

  return (
    <SectionShell
      title="手机接入"
      desc="用手机扫描二维码，把 OpenBuddy 变成随身遥控器。对话在你的电脑上执行，模型密钥从不离开桌面。"
    >
      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      {state && !state.configured ? (
        <p className="settings-hint">
          还没有配置网关。启动桌面时设置 <code>OPENBUDDY_GATEWAY_URL</code>、<code>OPENBUDDY_GATEWAY_AGENT_TOKEN</code>
          与 <code>OPENBUDDY_GATEWAY_ADMIN_TOKEN</code>，这里就会出现配对码。
        </p>
      ) : null}

      {state?.configured ? (
        <>
          <div className="mobile-access__pair">
            <button className="settings-btn settings-btn--primary" onClick={() => void startPairing()} disabled={busy}>
              {pairing ? "重新生成配对码" : "生成配对码"}
            </button>
            {pairing ? (
              <div className="mobile-access__code">
                {qr ? <img className="mobile-access__qr" src={qr} alt="配对二维码" /> : null}
                <div className="mobile-access__digits">{pairing.code.replace(/(\d{4})(\d{4})/, "$1 $2")}</div>
                <p className="settings-hint">
                  {countdown > 0 ? `${countdown} 秒内有效` : "已过期，请重新生成"} · 网关 {state.gatewayUrl}
                </p>
              </div>
            ) : (
              <p className="settings-hint">配对码只能用一次；生成后请在两分钟内扫码。</p>
            )}
          </div>

          <h3 className="settings-subtitle">已连接的手机</h3>
          {state.devices.length === 0 ? (
            <p className="settings-hint">还没有手机连接过这台电脑。</p>
          ) : (
            <ul className="mobile-access__devices">
              {state.devices.map(device => (
                <li key={device.id} className="mobile-access__device">
                  <div>
                    <strong>{device.name}</strong>
                    <span className="mobile-access__meta">
                      {PLATFORM_LABEL[device.platform] ?? device.platform} · 最后连接 {relative(device.lastSeenAt)}
                      {device.revokedAt ? " · 已断开" : ""}
                    </span>
                  </div>
                  {device.revokedAt ? null : (
                    <button className="settings-btn settings-btn--danger" onClick={() => void revoke(device)} disabled={busy}>
                      断开
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </SectionShell>
  );
}
