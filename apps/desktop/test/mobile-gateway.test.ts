// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createMobileGateway, MobileGatewayError } from '../src/main/mobile-gateway.js';

function stubFetch(routes: Record<string, (init: RequestInit) => { status?: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const handler = routes[`${init.method ?? 'GET'} ${path}`];
    if (!handler) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    const { status = 200, body } = handler(init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('desktop mobile gateway client (§4.4)', () => {
  it('mints a pairing code with the admin credential and binds it to this desktop', async () => {
    const { fetchImpl, calls } = stubFetch({
      'POST /pair/start': () => ({
        body: { code: '12345678', expiresAt: '2026-11-17T10:02:00.000Z', scopes: ['sessions:read'], desktopId: 'd-1' },
      }),
    });
    const gateway = createMobileGateway({
      gatewayUrl: 'https://gw.test/',
      adminToken: 'admin-secret',
      desktopId: 'd-1',
      fetchImpl,
    });

    const pairing = await gateway.pairStart();
    expect(pairing).toEqual({
      code: '12345678',
      expiresAt: '2026-11-17T10:02:00.000Z',
      scopes: ['sessions:read'],
      desktopId: 'd-1',
    });
    expect(calls[0]!.url).toBe('https://gw.test/pair/start');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer admin-secret');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      scopes: ['sessions:read', 'sessions:write', 'approve'],
      desktopId: 'd-1',
    });
  });

  it('lists devices in the shape the panel renders', async () => {
    const { fetchImpl } = stubFetch({
      'GET /admin/devices': () => ({
        body: {
          devices: [
            {
              id: 'd1', name: '我的手机', platform: 'ios', scopes: ['sessions:read'],
              createdAt: '2026-11-16T09:00:00.000Z', lastSeenAt: '2026-11-17T09:00:00.000Z', revokedAt: null, desktopId: 'd-1',
            },
            { id: 'bad' },
            { name: 'no id' },
          ],
        },
      }),
    });
    const gateway = createMobileGateway({ gatewayUrl: 'https://gw.test', adminToken: 't', fetchImpl });
    expect(await gateway.listDevices()).toEqual([
      {
        id: 'd1', name: '我的手机', platform: 'ios',
        createdAt: '2026-11-16T09:00:00.000Z', lastSeenAt: '2026-11-17T09:00:00.000Z', revokedAt: null, desktopId: 'd-1',
      },
      { id: 'bad', name: '未命名设备', platform: 'unknown', lastSeenAt: null, revokedAt: null },
    ]);
  });

  it('revokes one device and surfaces gateway refusals with their status', async () => {
    const { fetchImpl, calls } = stubFetch({
      'POST /admin/devices/d1/revoke': () => ({ body: { revoked: true } }),
      'POST /admin/devices/gone/revoke': () => ({ status: 404, body: { error: 'not found' } }),
    });
    const gateway = createMobileGateway({ gatewayUrl: 'https://gw.test', adminToken: 't', fetchImpl });

    await gateway.revokeDevice('d1');
    expect(calls[0]!.url).toBe('https://gw.test/admin/devices/d1/revoke');

    const failure = await gateway.revokeDevice('gone').catch(error => error);
    expect(failure).toBeInstanceOf(MobileGatewayError);
    expect((failure as MobileGatewayError).status).toBe(404);
    expect((failure as MobileGatewayError).message).toBe('not found');
  });

  it('reports where it points, so the panel can show the gateway', () => {
    const gateway = createMobileGateway({ gatewayUrl: 'https://gw.test/', adminToken: 't', fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch });
    expect(gateway.status()).toEqual({ configured: true, gatewayUrl: 'https://gw.test' });
  });
});
