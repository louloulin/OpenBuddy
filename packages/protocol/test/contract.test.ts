// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isCommand, isEvent, validatePayload } from '../src/contract.js';

describe('IPC boundary contract', () => {
  it('rejects commands and events outside the finite capabilities', () => {
    expect(isCommand('agent_send')).toBe(true);
    expect(isCommand('exec')).toBe(false);
    expect(isCommand('__proto__')).toBe(false);
    expect(isEvent('agent://event')).toBe(true);
    expect(isEvent('openbuddy:invoke')).toBe(false);
  });
  it('accepts plain structured values and bounds hostile input', () => {
    expect(validatePayload({ sessionId: 'one', input: ['a', true, null] })).toEqual({ sessionId: 'one', input: ['a', true, null] });
    expect(() => validatePayload([])).toThrow('expected object');
    expect(() => validatePayload(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('forbidden key');
    expect(() => validatePayload({ text: 'a'.repeat(8 * 1024 * 1024 + 1) })).toThrow('too long');
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 22; index++) nested = { nested };
    expect(() => validatePayload(nested)).toThrow('too complex');
  });
});
