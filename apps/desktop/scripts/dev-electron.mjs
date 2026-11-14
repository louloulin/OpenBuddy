import { spawn } from 'node:child_process';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = new Set();
function start(args) { const child = spawn(pnpm, args, { stdio: 'inherit', shell: process.platform === 'win32' }); children.add(child); child.on('exit', () => children.delete(child)); return child; }
function run(args) { return new Promise((resolve, reject) => { const child = start(args); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))); }); }
const stop = () => { for (const child of children) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });
try {
  await run(['exec', 'tsc', '--noEmit', '-p', 'apps/desktop/tsconfig.json']);
  await run(['exec', 'node', 'apps/desktop/scripts/build-electron.mjs']);
  const vite = start(['dev', '--host', '127.0.0.1']);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (vite.exitCode !== null) throw new Error('Vite stopped before startup');
    try { if ((await fetch('http://127.0.0.1:1420/')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Vite startup timed out');
  await run(['exec', 'electron', '.']);
} catch (error) { console.error(error); process.exitCode = 1; } finally { stop(); }
