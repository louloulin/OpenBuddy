// @vitest-environment node
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it } from 'vitest';
async function bridge() {
  const calls: unknown[][] = [];
  let api: any, authorize: (() => void) | undefined;
  const genuine = { nativeFile: true };
  const code = (await readFile('apps/desktop/src/preload/preload.cjs', 'utf8')).replace('/* COMMANDS */ []', '["agent_send"]');
  vm.runInNewContext(code, { require: () => ({
    contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } },
    ipcRenderer: { invoke: (...args: unknown[]) => { calls.push(args); return args[0] === 'openbuddy:grant-file' ? new Promise<void>(resolve => { authorize = resolve; }) : Promise.resolve('sent'); } },
    webUtils: { getPathForFile: (file: unknown) => file === genuine ? '/chosen/pixel.png' : '' },
  }) });
  return { api, calls, genuine, authorize: () => authorize?.() };
}
it('exposes no raw path registration and rejects synthetic File path forgery', async () => {
  const { api, calls } = await bridge();
  expect(Object.keys(api).sort()).toEqual(['dialog', 'getPathForFile', 'invoke', 'listen', 'window']);
  expect(() => api.getPathForFile({ path: '/private/key' })).toThrow('native_file_required');
  expect(calls).toEqual([]);
});
it('waits for native grant completion before sending attachment references', async () => {
  const { api, calls, genuine, authorize } = await bridge();
  expect(api.getPathForFile(genuine)).toBe('/chosen/pixel.png');
  const pending = api.invoke('agent_send', { text: 'inspect', attachments: [{ path: '/chosen/pixel.png' }] });
  await Promise.resolve();
  expect(calls).toEqual([['openbuddy:grant-file', '/chosen/pixel.png']]);
  authorize();
  await expect(pending).resolves.toBe('sent');
  expect(calls[1]).toEqual(['openbuddy:invoke', 'agent_send', { text: 'inspect', attachments: [{ path: '/chosen/pixel.png' }] }]);
});
