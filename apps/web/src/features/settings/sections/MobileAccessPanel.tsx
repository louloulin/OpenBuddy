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
import { useLocale } from "@/shared/i18n";
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

const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", android: "Android" };

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 平台标签：浏览器/手机 需要翻译，iOS/Android 是产品名。 */
function platformLabel(platform: string, t: Translate): string {
  if (platform === "web") return t("mobile.platformWeb");
  if (platform === "mobile") return t("mobile.platformMobile");
  return PLATFORM_LABEL[platform] ?? platform;
}

function relative(iso: string | null | undefined, t: Translate): string {
  if (!iso) return t("mobile.neverConnected");
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return t("mobile.unknownTime");
  const delta = Date.now() - ms;
  if (delta < 60_000) return t("mobile.justNow");
  if (delta < 3_600_000) return t("mobile.minutesAgo", { n: Math.floor(delta / 60_000) });
  if (delta < 86_400_000) return t("mobile.hoursAgo", { n: Math.floor(delta / 3_600_000) });
  return t("mobile.daysAgo", { n: Math.floor(delta / 86_400_000) });
}

function secondsLeft(expiresAt: string): number {
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : 0;
}

export function MobileAccessPanel() {
  const { t } = useLocale();
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
    if (!window.confirm(t("mobile.revokeConfirm", { name: device.name }))) return;
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
      <SectionShell title={t("mobile.title")} desc={t("mobile.browserDesc")}>
        <p className="settings-hint">{t("mobile.browserHint")}</p>
      </SectionShell>
    );
  }

  return (
    <SectionShell
      title={t("mobile.title")}
      desc={t("mobile.desc")}
    >
      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      {state && !state.configured ? (
        <p className="settings-hint">
          {t("mobile.notConfiguredLead")}<code>OPENBUDDY_GATEWAY_URL</code>{t("mobile.listSep")}<code>OPENBUDDY_GATEWAY_AGENT_TOKEN</code>{t("mobile.notConfiguredAnd")}<code>OPENBUDDY_GATEWAY_ADMIN_TOKEN</code>{t("mobile.notConfiguredTail")}
        </p>
      ) : null}

      {state?.configured ? (
        <>
          <div className="mobile-access__pair">
            <button className="settings-btn settings-btn--primary" onClick={() => void startPairing()} disabled={busy}>
              {pairing ? t("mobile.regenerateCode") : t("mobile.generateCode")}
            </button>
            {pairing ? (
              <div className="mobile-access__code">
                {qr ? <img className="mobile-access__qr" src={qr} alt={t("mobile.qrAlt")} /> : null}
                <div className="mobile-access__digits">{pairing.code.replace(/(\d{4})(\d{4})/, "$1 $2")}</div>
                <p className="settings-hint">
                  {countdown > 0 ? t("mobile.codeValidSeconds", { n: countdown }) : t("mobile.codeExpired")} · {t("mobile.gateway", { url: state.gatewayUrl ?? "" })}
                </p>
              </div>
            ) : (
              <p className="settings-hint">{t("mobile.codeOneTime")}</p>
            )}
          </div>

          <h3 className="settings-subtitle">{t("mobile.connectedPhones")}</h3>
          {state.devices.length === 0 ? (
            <p className="settings-hint">{t("mobile.noDevices")}</p>
          ) : (
            <ul className="mobile-access__devices">
              {state.devices.map(device => (
                <li key={device.id} className="mobile-access__device">
                  <div>
                    <strong>{device.name}</strong>
                    <span className="mobile-access__meta">
                      {platformLabel(device.platform, t)} · {t("mobile.lastSeen", { when: relative(device.lastSeenAt, t) })}
                      {device.revokedAt ? ` · ${t("mobile.revoked")}` : ""}
                    </span>
                  </div>
                  {device.revokedAt ? null : (
                    <button className="settings-btn settings-btn--danger" onClick={() => void revoke(device)} disabled={busy}>
                      {t("mobile.revoke")}
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
