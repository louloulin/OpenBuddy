// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createBridgeDispatcher, createBridgeToken, createEngineEventHub } from './mobile-bridge.js';
import type { CommandHandlers } from '@openbuddy/protocol/contract';

describe('engine event hub', () => {
  it('fans an event out to every subscriber', () => {
    const hub = createEngineEventHub();
    const seen: string[] = [];
    const off = hub.subscribe((event) => { seen.push(event); });
    hub.emit('agent://event', { n: 1 });
    off();
    hub.emit('agent://event', { n: 2 });
    expect(seen).toEqual(['agent://event']);
  });

  it('keeps going when one subscriber throws', () => {
    const hub = createEngineEventHub();
    const seen: string[] = [];
    hub.subscribe(() => { throw new Error('boom'); });
    hub.subscribe((event) => { seen.push(event); });
    hub.emit('agent://event', {});
    expect(seen).toEqual(['agent://event']);
  });
});

describe('bridge dispatcher', () => {
  const handlers: CommandHandlers = {
    agent_list_sessions: () => [{ id: 's1' }],
    agent_send: (payload) => ({ echoed: payload.text }),
  };

  it('runs the same handlers the renderer uses', async () => {
    const dispatcher = createBridgeDispatcher(handlers, createEngineEventHub());
    expect(await dispatcher.dispatch('agent_list_sessions', {})).toEqual([{ id: 's1' }]);
    expect(await dispatcher.dispatch('agent_send', { text: 'hi' })).toEqual({ echoed: 'hi' });
  });

  it('refuses a command the desktop does not serve', async () => {
    const dispatcher = createBridgeDispatcher(handlers, createEngineEventHub());
    await expect(dispatcher.dispatch('window_minimize', {})).rejects.toThrow('not_implemented: window_minimize');
  });

  it('advertises the desktop commands, and nothing else', () => {
    const dispatcher = createBridgeDispatcher(handlers, createEngineEventHub());
    expect(dispatcher.servedCommands().sort()).toEqual(['agent_list_sessions', 'agent_send']);
  });

  it('delivers engine events to the bridge subscriber', () => {
    const hub = createEngineEventHub();
    const dispatcher = createBridgeDispatcher(handlers, hub);
    const seen: unknown[] = [];
    dispatcher.listen((_event, payload) => { seen.push(payload); });
    hub.emit('agent://event', { n: 1 });
    expect(seen).toEqual([{ n: 1 }]);
  });
});

describe('bridge token', () => {
  it('is long enough to be unguessable and differs every time', () => {
    const a = createBridgeToken();
    const b = createBridgeToken();
    expect(a).toHaveLength(48);
    expect(a).not.toBe(b);
  });
});
