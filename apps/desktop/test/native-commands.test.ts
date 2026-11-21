// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ dialog: {}, clipboard: {}, nativeImage: {}, BrowserWindow: {} }));
import { COMMANDS } from '@openbuddy/protocol/commands';
import { HOST_MODULES } from '@openbuddy/host/modules/index';
import type { HostContext } from '@openbuddy/host/handlers';
import type { NativeContext } from '../src/native/context.js';
import { NATIVE_COMMANDS } from '../src/native/index.js';
import { exportCommands } from '../src/native/export.js';
import { clipboardCommands } from '../src/native/clipboard.js';
import { windowCommands } from '../src/native/window.js';
import { dialogCommands } from '../src/native/dialog.js';
import { trayCommands } from '../src/native/tray.js';
import { mobileAccessCommands } from '../src/native/mobile-access.js';

// Factories only build closures; nothing on the context is touched until a command runs.
const native = { window: {}, fileAccess: {}, exportGrants: new Set(), options: {} } as unknown as NativeContext;
const host = { options: { shell: {} }, settings: {}, emit: () => {}, engine: {}, update: () => {}, servedCommands: () => [] } as unknown as HostContext;

describe('desktop native commands (20261115-md §5.3)', () => {
  it('NATIVE_COMMANDS lists exactly the commands registered by ../native', () => {
    const registered = Object.keys({ ...exportCommands(native), ...clipboardCommands(native), ...windowCommands(native), ...dialogCommands(native), ...trayCommands(native), ...mobileAccessCommands(native) });
    expect([...registered].sort()).toEqual([...NATIVE_COMMANDS].sort());
  });
  it('host modules plus native commands serve the whole contract on desktop', () => {
    const served = new Set([...HOST_MODULES.flatMap(create => Object.keys(create(host).commands)), ...NATIVE_COMMANDS]);
    expect(COMMANDS.filter(c => !served.has(c))).toEqual([]);
    expect([...served].filter(c => !(COMMANDS as readonly string[]).includes(c))).toEqual([]);
  });
});
