// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ProtocolError, isProtocolErrorCode, parseProtocolError, stripErrorWrappers } from '../src/errors.js';

describe('protocol errors (pii W0.6)', () => {
  it('ProtocolError carries the code in its message so it survives Electron IPC', () => {
    const error = new ProtocolError('invalid_payload', 'query');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('invalid_payload');
    expect(error.message).toBe('invalid_payload: query');
    expect(new ProtocolError('not_found').message).toBe('not_found');
  });

  it('parses codes out of IPC rejections, preload rejections and plain errors', () => {
    expect(parseProtocolError(new Error("Error invoking remote method 'openbuddy:invoke': Error: invalid_payload: query"))).toEqual({ code: 'invalid_payload', message: 'query' });
    expect(parseProtocolError("Error: Error invoking remote method 'openbuddy:invoke': Error: session_not_loaded: abc")).toEqual({ code: 'session_not_loaded', message: 'abc' });
    expect(parseProtocolError(new Error('not_implemented: agents_list'))).toEqual({ code: 'not_implemented', message: 'agents_list' });
    expect(parseProtocolError('model_not_found')).toEqual({ code: 'model_not_found', message: undefined });
    expect(parseProtocolError(new ProtocolError('already_exists', 'name taken', { name: 'x' }))).toEqual({ code: 'already_exists', message: 'name taken', details: { name: 'x' } });
    expect(parseProtocolError({ code: 'session_busy' })).toEqual({ code: 'session_busy', message: undefined, details: undefined });
  });

  it('does not mistake ordinary messages for codes', () => {
    for (const text of ['timeout', 'fetch failed', '会话未加载', 'ENOENT: no such file', 'some_function is not defined', '', '429 Too Many Requests'])
      expect(parseProtocolError(text)).toBeUndefined();
    expect(parseProtocolError(undefined)).toBeUndefined();
    expect(parseProtocolError({ code: 404 })).toBeUndefined();
  });

  it('knows the protocol codes and strips nested wrappers', () => {
    expect(isProtocolErrorCode('invalid_payload')).toBe(true);
    expect(isProtocolErrorCode('file_changed')).toBe(false);
    expect(stripErrorWrappers("Error: Error invoking remote method 'x': Error: Error: session_busy")).toBe('session_busy');
  });
});
