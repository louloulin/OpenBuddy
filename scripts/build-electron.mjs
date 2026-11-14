import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { COMMANDS, EVENTS } from '../dist-electron/shared/contract.js';
await mkdir(new URL('../dist-electron/', import.meta.url), { recursive: true });
const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
await writeFile(new URL('../dist-electron/preload.cjs', import.meta.url), preload.replace('/* COMMANDS */ []', JSON.stringify(COMMANDS)).replace('/* EVENTS */ []', JSON.stringify(EVENTS)));
// file:// responses may not traverse the HTTP header hook: embed production CSP.
const indexURL = new URL('../dist/index.html', import.meta.url);
try {
  let html = await readFile(indexURL, 'utf8');
  // Same policy as electron/main.ts; only artifact previews (ob-preview://, sandboxed) may be framed.
  const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src ob-preview:";
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  const next = html.includes('http-equiv="Content-Security-Policy"')
    ? html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, tag)
    : html.replace('<head>', `<head>\n    ${tag}`);
  if (next !== html) await writeFile(indexURL, next);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
