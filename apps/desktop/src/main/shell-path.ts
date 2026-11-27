import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * 从访达 / 启动台打开的 macOS 应用只拿到 launchd 的 PATH（`/usr/bin:/bin:/usr/sbin:/sbin`），
 * Homebrew、mise、nvm、Volta 装的 node/npm 都不在里面。Pi 包管理器安装应用依赖时要 spawn `npm`，
 * 于是打包版里装 UpUp 报 `spawn npm ENOENT`（20261127-upup §1.13 实测）。
 *
 * 做法与 VS Code / fix-path 相同：用登录 shell 读一次真实 PATH（带超时），再补上常见安装目录；
 * 只追加不删除，读不到时保持原样。Windows 不需要（GUI 进程继承用户 PATH）。
 */
export function loginShellPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | undefined {
  if (platform === 'win32') return undefined;
  const current = (env.PATH ?? '').split(delimiter).filter(Boolean);
  let fromShell: string[] = [];
  const shell = env.SHELL && existsSync(env.SHELL) ? env.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
  try {
    const marker = '__OPENBUDDY_PATH__';
    const out = execFileSync(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...env, DISABLE_AUTO_UPDATE: 'true' },
    });
    const match = out.match(new RegExp(`${marker}(.*)${marker}`));
    if (match?.[1]) fromShell = match[1].split(delimiter).filter(Boolean);
  } catch {
    /* 登录 shell 读不到（超时、配置报错）就只靠下面的常见目录 */
  }
  const home = env.HOME ?? homedir();
  const common = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.local', 'bin'),
  ].filter((dir) => existsSync(dir));
  const merged = [...new Set([...current, ...fromShell, ...common])];
  return merged.length > current.length ? merged.join(delimiter) : undefined;
}
