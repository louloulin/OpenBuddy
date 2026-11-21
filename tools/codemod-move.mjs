#!/usr/bin/env node
// mv-first codemod (20261115-md §7.1).
//
//   node tools/codemod-move.mjs tools/move-map/M3-services.json [--dry]
//
// Move map: { "moves": [ { "from": "electron/services/", "to": "packages/services/src/" },
//                         { "from": "electron/agent/pi.ts", "to": "packages/engine/src/pi-engine.ts" } ] }
// A "from" ending in "/" moves every file below it (prefix rename).
//
// 1. Snapshots the import graph (static/dynamic imports, re-exports, vi.mock, require, CSS @import,
//    asset imports) of every source file.
// 2. `git mv`s the files (history follows with `git log --follow`).
// 3. Rewrites every specifier whose importer or target moved, keeping its style:
//    - target in another package → `@openbuddy/<pkg>` (index) or `@openbuddy/<pkg>/<subpath>`
//    - `@/…` alias inside the web app stays an alias
//    - relative specs stay relative and keep their extension style (`./x.js`, `./x`, `./dir`)
// 4. Proves the move is pure: the graph after, mapped back through the move map, must equal the
//    graph before — no edge added, none lost. Exits 1 otherwise.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative, sep, posix } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const mapFile = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!mapFile) { console.error('usage: codemod-move.mjs <move-map.json> [--dry]'); process.exit(2); }
const { moves } = JSON.parse(readFileSync(resolve(mapFile), 'utf8'));

const CODE = /\.(tsx?|mts|cts|mjs|cjs|js)$/;
const SCAN = /\.(tsx?|mts|cts|mjs|cjs|js|css)$/;
const posixRel = (from, to) => relative(from, to).split(sep).join('/');
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-electron', 'release', '.git'].includes(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(posixRel(ROOT, p));
  }
  return out;
}
const SCAN_DIRS = ['electron', 'src', 'apps', 'packages', 'scripts', 'tools', 'public'];
const listFiles = () => SCAN_DIRS.flatMap(d => walk(join(ROOT, d)));
const ROOT_FILES = ['vite.config.ts', 'vitest.config.ts', 'package.json', 'index.html'];

// Resolution against a given tree state.
function makeResolver(fileSet) {
  const webRoot = fileSet.has('apps/web/src/app/main.tsx') || [...fileSet].some(f => f.startsWith('apps/web/src/')) ? 'apps/web/src' : 'src';
  const EXT = ['', '.ts', '.tsx', '.mts', '.mjs', '.cjs', '.js', '/index.ts', '/index.tsx'];
  return {
    webRoot,
    resolve(from, spec) {
      let base;
      if (spec.startsWith('@/')) base = `${webRoot}/${spec.slice(2)}`;
      else if (spec.startsWith('@openbuddy/')) {
        const [, pkg, ...rest] = spec.split('/');
        base = rest.length ? `packages/${pkg}/src/${rest.join('/')}` : `packages/${pkg}/src/index`;
      } else if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
      else return null;
      const stripped = base.replace(/\.(js)$/, '');
      for (const e of EXT) for (const b of [base, stripped]) if (fileSet.has(b + e)) return b + e;
      return undefined;
    },
  };
}
// The prefixes are lookbehinds so a match covers only the quoted specifier: nested specifiers
// such as vi.importActual<typeof import("a")>("a") are both seen.
const SPEC_RE = /(?<=(?:import|export)\s[^'"`;]*?from\s+|import\(\s*|^\s*import\s+|vi\.mock\(\s*|vi\.importActual(?:<[^>]*>)?\(\s*|require\(\s*|@import\s+(?:url\()?)(['"])([^'"]+)\1/gm;
function edgesOf(file, src, resolver) {
  const out = [];
  for (const m of src.matchAll(SPEC_RE)) {
    const spec = m[2];
    const target = resolver.resolve(file, spec);
    if (target === null) continue;
    out.push({ spec, target, index: m.index + 1 });
  }
  return out;
}

const before = listFiles().concat(ROOT_FILES.filter(f => existsSync(join(ROOT, f))));
const beforeSet = new Set(before);
const resolverBefore = makeResolver(beforeSet);

// old path → new path
const mapping = new Map();
for (const { from, to } of moves) {
  if (from.endsWith('/')) {
    const hits = before.filter(f => f.startsWith(from));
    if (!hits.length) throw new Error(`no files under ${from}`);
    for (const f of hits) mapping.set(f, to + f.slice(from.length));
  } else {
    if (!beforeSet.has(from)) throw new Error(`missing ${from}`);
    mapping.set(from, to);
  }
}
const mapPath = f => mapping.get(f) ?? f;
for (const [, to] of mapping) if (beforeSet.has(to) && !mapping.has(to)) throw new Error(`target exists: ${to}`);

// Graph before (only scanned code/css files are importers).
const graphBefore = new Map();
const unresolvedBefore = [];
for (const f of before) {
  if (!SCAN.test(f)) continue;
  const src = readFileSync(join(ROOT, f), 'utf8');
  const edges = edgesOf(f, src, resolverBefore);
  for (const e of edges) if (e.target === undefined) unresolvedBefore.push(`${f} -> ${e.spec}`);
  graphBefore.set(f, { src, edges });
}

// New tree file set and resolver.
const after = before.map(mapPath);
const afterSet = new Set(after);
const resolverAfter = makeResolver(afterSet);
const pkgOf = p => p.match(/^packages\/([^/]+)\/src\//)?.[1];
// An importer under packages/<pkg>/test/ belongs to <pkg>: its imports of <pkg>/src stay relative.
const importerPkgOf = p => p.match(/^packages\/([^/]+)\/(?:src|test)\//)?.[1];

function makeSpec(fromNew, targetNew, oldSpec, oldTarget) {
  const tPkg = pkgOf(targetNew), fPkg = importerPkgOf(fromNew);
  const codeExt = /\.(tsx?|mts|cts)$/;
  if (tPkg && tPkg !== fPkg && CODE.test(targetNew)) {
    const sub = targetNew.slice(`packages/${tPkg}/src/`.length).replace(codeExt, '').replace(/\.(mjs|cjs|js)$/, m => m);
    return sub === 'index' ? `@openbuddy/${tPkg}` : `@openbuddy/${tPkg}/${sub}`;
  }
  const webRoot = resolverAfter.webRoot;
  const omitIndex = /\/index\.tsx?$/.test(oldTarget) && !/\/index(\.[a-z]+)?$/.test(oldSpec) && !/^\.\.?$/.test(oldSpec);
  const hadJs = /\.js$/.test(oldSpec) && codeExt.test(oldTarget);
  const explicitExt = !hadJs && /\.[a-z]+$/.test(oldSpec) && oldTarget.endsWith(oldSpec.match(/\.[a-z]+$/)[0]);
  const finish = p => {
    if (omitIndex) return p.replace(/\/index\.tsx?$/, '');
    if (hadJs) return p.replace(codeExt, '.js');
    if (explicitExt) return p;
    return p.replace(codeExt, '');
  };
  if (oldSpec.startsWith('@/') && targetNew.startsWith(webRoot + '/') && fromNew.startsWith(webRoot + '/')) return '@/' + finish(targetNew.slice(webRoot.length + 1));
  let rel = posixRel(dirname(fromNew), targetNew);
  if (!rel.startsWith('.')) rel = './' + rel;
  return finish(rel);
}

// Rewrite contents.
const rewrites = new Map();
let changedSpecs = 0;
for (const [f, { src, edges }] of graphBefore) {
  const fNew = mapPath(f);
  let out = '';
  let last = 0;
  for (const e of edges) {
    if (e.target === undefined) continue;
    const tNew = mapPath(e.target);
    if (fNew === f && tNew === e.target) continue;
    const next = makeSpec(fNew, tNew, e.spec, e.target);
    if (next === e.spec) continue;
    out += src.slice(last, e.index) + next;
    last = e.index + e.spec.length;
    changedSpecs++;
  }
  if (last) rewrites.set(f, out + src.slice(last));
}

console.log(`MOVE ${mapping.size} files, rewrite ${changedSpecs} specifiers in ${rewrites.size} files${DRY ? ' (dry run)' : ''}`);
if (DRY) {
  for (const [a, b] of mapping) console.log(`  mv ${a} -> ${b}`);
  process.exit(0);
}
// Apply: write rewritten contents first (at old paths), then git mv.
for (const [f, text] of rewrites) writeFileSync(join(ROOT, f), text);
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n'));
for (const [from, to] of mapping) {
  mkdirSync(dirname(join(ROOT, to)), { recursive: true });
  if (tracked.has(from)) execFileSync('git', ['mv', from, to], { cwd: ROOT });
  else execFileSync('mv', [join(ROOT, from), join(ROOT, to)]);
}

// Prove purity: graph after == graph before mapped through the move map.
const key = (a, b) => `${a} -> ${b}`;
const expected = new Set();
for (const [f, { edges }] of graphBefore) for (const e of edges) if (e.target !== undefined) expected.add(key(mapPath(f), mapPath(e.target)));
const actual = new Set();
const unresolvedAfter = [];
for (const f of after) {
  if (!SCAN.test(f)) continue;
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const e of edgesOf(f, src, resolverAfter)) {
    if (e.target === undefined) unresolvedAfter.push(`${f} -> ${e.spec}`);
    else actual.add(key(f, e.target));
  }
}
const lost = [...expected].filter(k => !actual.has(k));
const added = [...actual].filter(k => !expected.has(k));
const newlyUnresolved = unresolvedAfter.length - unresolvedBefore.length;
if (lost.length || added.length || newlyUnresolved > 0) {
  console.error('PURITY_FAIL');
  for (const k of lost) console.error('  lost  ', k);
  for (const k of added) console.error('  added ', k);
  for (const k of unresolvedAfter) console.error('  unresolved', k);
  process.exit(1);
}
console.log(`PURITY_OK ${actual.size} edges preserved, unresolved before/after ${unresolvedBefore.length}/${unresolvedAfter.length}`);
