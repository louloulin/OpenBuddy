// Main-process build (20261115-md M0): esbuild bundles apps/desktop/src/main/index.ts and every internal
// workspace module into dist-electron/main.js. npm dependencies stay external, so the
// packaged app still loads Pi, its WASM and dynamic resources from node_modules.
// Type checking is separate: `tsc --noEmit -p apps/desktop/tsconfig.json`.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
// Workspace packages (`workspace:*`) are source: bundle them. Everything else is external.
const external = ['electron', ...Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !String(v).startsWith('workspace:')).map(([name]) => name)];
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', external, absWorkingDir: root, tsconfig: 'apps/desktop/tsconfig.json', logLevel: 'warning' };

const out = new URL('../../../dist-electron/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({ ...common, entryPoints: ['apps/desktop/src/main/index.ts'], outfile: 'dist-electron/main.js', sourcemap: true });

// The preload is plain CJS; its command/event allow-lists come from the shared contract.
const contract = await build({ ...common, entryPoints: ['packages/protocol/src/contract.ts'], write: false });
const { COMMANDS, EVENTS } = await import(`data:text/javascript;base64,${Buffer.from(contract.outputFiles[0].text).toString('base64')}`);
const preload = await readFile(new URL('../../../apps/desktop/src/preload/preload.cjs', import.meta.url), 'utf8');
await writeFile(new URL('preload.cjs', out), preload.replace('/* COMMANDS */ []', JSON.stringify(COMMANDS)).replace('/* EVENTS */ []', JSON.stringify(EVENTS)));

// file:// responses may not traverse the HTTP header hook: embed production CSP.
const indexURL = new URL('../../../dist/index.html', import.meta.url);
try {
  let html = await readFile(indexURL, 'utf8');
  // Same policy as apps/desktop/src/main/index.ts; only artifact previews (ob-preview://, sandboxed) may be framed.
  const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src ob-preview:";
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  const next = html.includes('http-equiv="Content-Security-Policy"')
    ? html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, tag)
    : html.replace('<head>', `<head>\n    ${tag}`);
  if (next !== html) await writeFile(indexURL, next);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
