import type { CommandHandlers } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

/**
 * Native `mobile_*` commands (20261115-mobile.md §4.4).
 *
 * The desktop settings page needs to mint a pairing code and to see/revoke the
 * phones bound to this computer. The gateway's admin credential stays in the
 * main process, so these three commands are the renderer's whole surface: a
 * code, a list, and a revoke.
 *
 * `mobileGateway` is absent when the desktop was started without a gateway
 * address; the commands then answer "not configured" instead of throwing, so
 * the panel can explain the state rather than show an error.
 */
export function mobileAccessCommands(ctx: NativeContext): CommandHandlers {
  const gateway = ctx.options.mobileGateway;

  const requireGateway = () => {
    if (!gateway) throw new Error('mobile_gateway_not_configured: set OPENBUDDY_GATEWAY_URL and OPENBUDDY_GATEWAY_ADMIN_TOKEN');
    return gateway;
  };

  const commands: CommandHandlers = {
    mobile_pair_start: async payload => {
      const scopes = Array.isArray(payload.scopes)
        ? payload.scopes.filter((scope): scope is string => typeof scope === 'string')
        : undefined;
      const pairing = await requireGateway().pairStart(scopes);
      return {
        ...pairing,
        // The QR the phone scans: the same payload `parsePairQr` accepts.
        qr: `openbuddy://pair?gateway=${encodeURIComponent(gateway!.status().gatewayUrl)}&code=${encodeURIComponent(pairing.code)}`,
      };
    },

    mobile_devices_list: async () => {
      if (!gateway) return { configured: false, gatewayUrl: null, devices: [] };
      const status = gateway.status();
      // Only this computer's phones: a shared gateway may serve several.
      const devices = (await gateway.listDevices()).filter(device =>
        !status.desktopId || !device.desktopId || device.desktopId === status.desktopId);
      return { configured: true, gatewayUrl: status.gatewayUrl, devices };
    },

    mobile_device_revoke: async payload => {
      if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 128) {
        throw new Error('invalid_payload: id');
      }
      await requireGateway().revokeDevice(payload.id);
      return { revoked: true };
    },
  };
  return commands;
}
