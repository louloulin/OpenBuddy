import { createServer } from 'node:http';

/**
 * 手机接入走查用的假网关 (G4-4)：只实现设置面板真正调用的三个 admin 端点，
 * 让面板进入「已配置」状态，从而能验证设备列表、推送测试与远程控制禁用。
 */
export async function startFakeGateway() {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.url === '/pair/start' && req.method === 'POST') {
      return reply(200, {
        code: '12345678',
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        scopes: ['sessions:read'],
      });
    }
    if (req.url === '/admin/devices' && req.method === 'GET') {
      return reply(200, {
        devices: [{ id: 'd1', name: '我的手机', platform: 'ios', lastSeenAt: new Date().toISOString(), revokedAt: null }],
      });
    }
    if (/^\/admin\/devices\/[^/]+\/revoke$/.test(req.url ?? '') && req.method === 'POST') {
      return reply(200, { revoked: true });
    }
    return reply(404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    port: server.address().port,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
