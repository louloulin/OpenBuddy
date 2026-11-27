import { describe, expect, it } from 'vitest';
import { loginShellPath } from './shell-path';

describe('loginShellPath（访达启动的精简 PATH）', () => {
  it('从登录 shell 补回 PATH，原有目录保留在前面', () => {
    const minimal = '/usr/bin:/bin:/usr/sbin:/sbin';
    const fixed = loginShellPath({ PATH: minimal, HOME: process.env.HOME, SHELL: process.env.SHELL }, 'darwin');
    expect(fixed?.startsWith(minimal)).toBe(true);
    expect(fixed!.split(':').length).toBeGreaterThan(4);
  });
  it('Windows 不处理', () => {
    expect(loginShellPath({ PATH: 'C:\\x' }, 'win32')).toBeUndefined();
  });
});
