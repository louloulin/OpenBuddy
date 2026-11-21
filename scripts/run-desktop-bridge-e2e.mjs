/**
 * Runs the desktop-bridge end-to-end check (scripts/e2e-desktop-bridge.ts).
 *
 * The desktop half has to run the way the packaged app runs: bundled to
 * JavaScript and executed by Node. Two processes are involved — the Bun
 * gateway and the Node desktop — because the two runtimes cannot share one
 * process (Bun's `Bun.serve` and node's `http` in the same runtime make Bun
 * reject its own Response objects).
 */

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'))

// Workspace packages are source and get bundled; npm dependencies stay
// external, exactly like the desktop build does.
const external = [
  'electron',
  ...Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([, version]) => !String(version).startsWith('workspace:'))
    .map(([name]) => name),
]

// The bundle lives inside the repository so Node resolves the external npm
// dependencies from the repo's own node_modules.
const outDir = join(root, 'node_modules/.cache/openbuddy-desktop-e2e')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const outfile = join(outDir, 'desktop-bridge-e2e.mjs')
await build({
  entryPoints: ['scripts/e2e-desktop-bridge.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  absWorkingDir: root,
  tsconfig: 'tsconfig.json',
  logLevel: 'warning',
})

// A gateway may be supplied from the outside (a container, a remote host);
// otherwise one is started here.
const suppliedGateway = process.env.OPENBUDDY_E2E_GATEWAY
const gateway = suppliedGateway ? null : spawn('bun', ['run', 'scripts/e2e-gateway-process.ts'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
})

const info = suppliedGateway ? JSON.parse(suppliedGateway) : await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('the gateway did not report its address')), 20_000)
  gateway.stdout.on('data', chunk => {
    buffer += String(chunk)
    const line = buffer.split('\n').find(candidate => candidate.includes('"ready"'))
    if (!line) return
    clearTimeout(timer)
    resolve(JSON.parse(line))
  })
  gateway.on('exit', code => { clearTimeout(timer); reject(new Error(`the gateway exited with ${code}`)) })
})

const desktop = spawn('node', [outfile], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, OPENBUDDY_E2E_GATEWAY: JSON.stringify(info) },
})

const code = await new Promise(resolve => desktop.on('exit', resolve))
gateway?.kill('SIGTERM')
await rm(outDir, { recursive: true, force: true })
process.exit(code ?? 1)
