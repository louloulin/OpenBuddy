/**
 * H5 boot (20261115-mobile.md Phase 3.5).
 *
 * When the same bundle is opened in a browser instead of Electron's window,
 * there is no preload bridge. The gateway serves this page under `/h5`, so the
 * page's own origin *is* the gateway: pairing needs only the eight-digit code,
 * and every api/* call rides the `/api` tunnel to the desktop PiBridge.
 *
 * The transport is registered as `ipc.ts`'s fallback, which is why the whole
 * renderer works unchanged.
 */

import { GatewayTransport } from "@openbuddy/client/gateway-transport";
import { hasPreloadBridge, setBridgeFallback } from "@openbuddy/client/ipc";

const KEY_GATEWAY = "openbuddy.h5.gateway";
const KEY_TOKEN = "openbuddy.h5.deviceToken";
const KEY_DEVICE = "openbuddy.h5.deviceName";

export type H5Pairing = {
  gatewayUrl: string;
  deviceToken: string;
  deviceName?: string;
};

/** True when this page is not running inside Electron. */
export function isBrowserHost(): boolean {
  return !hasPreloadBridge();
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function savedPairing(): H5Pairing | null {
  const store = storage();
  if (!store) return null;
  const gatewayUrl = store.getItem(KEY_GATEWAY);
  const deviceToken = store.getItem(KEY_TOKEN);
  if (!gatewayUrl || !deviceToken) return null;
  return { gatewayUrl, deviceToken, deviceName: store.getItem(KEY_DEVICE) ?? undefined };
}

export function forgetPairing(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(KEY_GATEWAY);
  store.removeItem(KEY_TOKEN);
  store.removeItem(KEY_DEVICE);
}

/** Claims the code and remembers the device credential. */
export async function claimPairing(
  gatewayUrl: string,
  code: string,
  deviceName: string,
): Promise<H5Pairing> {
  const response = await fetch(`${gatewayUrl.replace(/\/+$/, "")}/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName, platform: "web" }),
  });
  const body = (await response.json().catch(() => ({}))) as { deviceToken?: string; error?: string };
  if (!response.ok || !body.deviceToken) {
    throw new Error(body.error ?? `配对失败（HTTP ${response.status}）`);
  }
  const pairing: H5Pairing = { gatewayUrl, deviceToken: body.deviceToken, deviceName };
  const store = storage();
  store?.setItem(KEY_GATEWAY, pairing.gatewayUrl);
  store?.setItem(KEY_TOKEN, pairing.deviceToken);
  store?.setItem(KEY_DEVICE, deviceName);
  return pairing;
}

/** Builds the transport and installs it as the renderer's host bridge. */
export function installPairing(pairing: H5Pairing): void {
  const transport = new GatewayTransport({
    baseUrl: `${pairing.gatewayUrl.replace(/\/+$/, "")}/api`,
    token: pairing.deviceToken,
  });
  setBridgeFallback({
    invoke: (command, payload) => transport.invoke(command, payload),
    listen: (event, callback) => transport.listen(event, callback),
  });
}
