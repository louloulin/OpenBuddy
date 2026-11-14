#!/usr/bin/env node
// Module boundary checker (20261115-md §5.2 / P0.5 / P3.1).
//
// Builds the internal import graph of electron/ src/ apps/ packages/ (static imports,
// re-exports, dynamic import(), vi.mock paths) and reports, per category:
//   unresolved      imports that point at nothing
//   layer           an import that crosses layers against §5.2
//   forbidden       a module a layer must not use (electron, node:*, react …)
//   bridge          renderer code touching the Electron bridge outside client/platform
//   feature-deep    apps/web feature reaching into another feature instead of its index.ts
//   feature-edge    feature → feature edge not in the allowed DAG
//   cycle           strongly connected components (> 1 file)
//   unreachable     source files no entry point reaches
//   size            source files over the line budget (minus the exemption list)
//
// Paths are matched for both the old (electron/, src/) and the new layout, so the same
// rules run before, during and after the mv-first migration.
//
//   node tools/check-boundaries.mjs                 summary
//   node tools/check-boundaries.mjs --json out.json full report
//   node tools/check-boundaries.mjs --check         fail if any category count grew vs the baseline
//   node tools/check-boundaries.mjs --update-baseline
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'tools/boundaries-baseline.json');
const SIZE_BUDGET = 600;
// Deferred features are moved, not split (20261115-md R8); the rest must come down.
const SIZE_EXEMPT = [
  /features\/automation\//, /components\/automation\//, /AutomationPanel\.tsx$/,
];

const LAYERS = [
  { name: 'protocol', match: ['packages/protocol/'], allow: [], forbid: [/^node:/, /^react/, /^electron$/, /^@earendil-works\//] },
  { name: 'kernel', match: ['packages/kernel/'], allow: ['protocol'], forbid: [/^electron$/, /^react/] },
  { name: 'services', match: ['packages/services/'], allow: ['kernel', 'protocol'], forbid: [/^electron$/, /^react/] },
  { name: 'engine', match: ['packages/engine/'], allow: ['services', 'kernel', 'protocol'], forbid: [/^electron$/, /^react/] },
  { name: 'host', match: ['packages/host/'], allow: ['engine', 'services', 'kernel', 'protocol'], forbid: [/^electron$/, /^react/] },
  { name: 'desktop', match: ['apps/desktop/', 'electron/'], allow: ['host', 'engine', 'services', 'kernel', 'protocol'], forbid: [/^react/] },
  { name: 'client', match: ['packages/client/'], allow: ['protocol'], forbid: [/^node:/, /^react/, /^electron$/] },
  { name: 'chat-core', match: ['packages/chat-core/'], allow: ['client', 'protocol'], forbid: [/^node:/, /^react/, /^electron$/] },
  { name: 'platform', match: ['packages/platform/'], allow: ['protocol'], forbid: [/^node:/, /^react/, /^electron$/] },
  { name: 'ui', match: ['packages/ui/'], allow: [], forbid: [/^node:/, /^electron$/] },
  { name: 'markdown', match: ['packages/markdown/'], allow: ['ui'], forbid: [/^node:/, /^electron$/] },
  { name: 'web', match: ['apps/web/', 'src/'], allow: ['chat-core', 'client', 'platform', 'ui', 'markdown', 'protocol'], forbid: [/^node:/, /^electron$/] },
];
// Allowed feature → feature edges in apps/web (§5.2).
const FEATURE_EDGES = {
  chat: ['composer', 'approvals', 'workbench', 'models'],
  home: ['composer', 'models'],
  composer: ['approvals', 'models'],
  sessions: ['approvals'],
  settings: ['models', 'agent-resources'],
  workbench: [],
  projects: ['composer', 'models'], experts: ['composer', 'models'], automation: ['composer', 'models'],
  library: ['composer', 'models'], assistant: ['composer', 'models'],
  approvals: [], models: [], 'agent-resources': [],
};
const BRIDGE_OK = ['client', 'platform'];

const isTest = f => /(__tests__|\/test\/|\.test\.|\.spec\.|test-setup)/.test(f);
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts|cts|mjs|cjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
};
const files = ['electron', 'src', 'apps', 'packages'].flatMap(d => walk(join(ROOT, d))).map(p => relative(ROOT, p).split(sep).join('/'));
const fileSet = new Set(files);
const webRoot = existsSync(join(ROOT, 'apps/web/src')) ? 'apps/web/src' : 'src';
const EXT = ['', '.ts', '.tsx', '.mts', '.mjs', '.cjs', '/index.ts', '/index.tsx'];
function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = `${webRoot}/${spec.slice(2)}`;
  else if (spec.startsWith('@openbuddy/')) {
    const [, pkg, ...rest] = spec.split('/');
    base = rest.length ? `packages/${pkg}/src/${rest.join('/')}` : `packages/${pkg}/src/index`;
  } else if (spec.startsWith('.')) base = relative(ROOT, resolve(ROOT, dirname(from), spec)).split(sep).join('/');
  else return { external: spec };
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  for (const e of EXT) for (const b of [base, stripped]) if (fileSet.has(b + e)) return { file: b + e };
  // Non-code assets (css, svg, json …) are not part of the graph.
  if (/\.(css|svg|png|json|md)$/.test(spec)) return { asset: spec };
  return { unresolved: spec };
}
const layerOf = f => LAYERS.find(l => l.match.some(m => f.startsWith(m)));
const featureOf = f => f.match(/^(?:apps\/web\/src|src)\/features\/([^/]+)\//)?.[1];

const graph = new Map();
const text = new Map();
const report = { unresolved: [], layer: [], forbidden: [], bridge: [], 'feature-deep': [], 'feature-edge': [], cycle: [], unreachable: [], size: [] };
const IMPORT_RE = /(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]|vi\.mock\(\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm;
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  text.set(f, src);
  const deps = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    const r = resolveSpec(f, spec);
    if (r.unresolved) report.unresolved.push(`${f} -> ${spec}`);
    deps.push({ spec, ...r, mock: !!m[4] });
  }
  graph.set(f, deps);
}

for (const [f, deps] of graph) {
  const layer = layerOf(f);
  const lines = text.get(f).split('\n').length;
  if (!isTest(f) && lines > SIZE_BUDGET && !SIZE_EXEMPT.some(re => re.test(f))) report.size.push(`${f} (${lines})`);
  if (!layer || isTest(f)) continue;
  if (!BRIDGE_OK.includes(layer.name) && ['web', 'ui', 'markdown', 'chat-core'].includes(layer.name) && /window\.openbuddy\b/.test(text.get(f))) report.bridge.push(`${f} uses window.openbuddy`);
  for (const d of deps) {
    if (d.mock) continue;
    if (d.external) {
      if (layer.forbid.some(re => re.test(d.external))) report.forbidden.push(`${f} -> ${d.external}`);
      continue;
    }
    if (!d.file) continue;
    const target = layerOf(d.file);
    if (target && target !== layer && !layer.allow.includes(target.name)) report.layer.push(`${layer.name} -> ${target.name}: ${f} -> ${d.file}`);
    // Renderer code importing the raw bridge wrapper instead of the client API.
    if (/(^src\/lib\/ipc\.ts$|^packages\/client\/src\/ipc\.ts$)/.test(d.file) && !BRIDGE_OK.includes(layer.name) && !/agent-client\.ts$/.test(f)) report.bridge.push(`${f} -> ${d.file}`);
    const from = featureOf(f), to = featureOf(d.file);
    if (from && to && from !== to) {
      if (!/\/features\/[^/]+\/index\.tsx?$/.test(d.file)) report['feature-deep'].push(`${f} -> ${d.file}`);
      if (!(FEATURE_EDGES[from] ?? []).includes(to)) report['feature-edge'].push(`${from} -> ${to}: ${f}`);
    }
  }
}

// Strongly connected components over non-test source files (Tarjan).
{
  let index = 0; const stack = []; const on = new Set(); const idx = new Map(); const low = new Map();
  const nodes = files.filter(f => !isTest(f));
  const edges = f => (graph.get(f) ?? []).filter(d => d.file && !d.mock && !isTest(d.file)).map(d => d.file);
  const strong = v => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of edges(v)) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = []; let w;
      do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) report.cycle.push(comp.sort().join(' <-> '));
    }
  };
  for (const v of nodes) if (!idx.has(v)) strong(v);
}

// Reachability from the app entry points.
{
  const entries = ['src/main.tsx', 'apps/web/src/app/main.tsx', 'apps/web/src/main.tsx', 'electron/main.ts', 'apps/desktop/src/main/index.ts'].filter(e => fileSet.has(e));
  const seen = new Set(); const todo = [...entries];
  while (todo.length) { const f = todo.pop(); if (seen.has(f)) continue; seen.add(f); for (const d of graph.get(f) ?? []) if (d.file && !d.mock) todo.push(d.file); }
  for (const f of files) {
    if (seen.has(f) || isTest(f) || /preload\.cjs$|\/scripts\/|^tools\//.test(f)) continue;
    report.unreachable.push(f);
  }
}

const counts = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length]));
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
if (jsonAt >= 0) writeFileSync(resolve(args[jsonAt + 1]), JSON.stringify({ counts, report }, null, 2));
console.log('BOUNDARIES', JSON.stringify(counts));
if (args.includes('--verbose')) for (const [k, v] of Object.entries(report)) for (const x of v) console.log(`  [${k}] ${x}`);
if (args.includes('--update-baseline')) { writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n'); console.log('baseline updated'); }
if (args.includes('--check')) {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const grew = Object.entries(counts).filter(([k, v]) => v > (base[k] ?? 0));
  if (grew.length) {
    console.error('BOUNDARIES_FAIL', grew.map(([k, v]) => `${k}: ${base[k] ?? 0} -> ${v}`).join(', '));
    for (const [k] of grew) for (const x of report[k]) console.error(`  [${k}] ${x}`);
    process.exit(1);
  }
  console.log('BOUNDARIES_OK (no category grew)');
}
