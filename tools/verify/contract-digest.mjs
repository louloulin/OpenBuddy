#!/usr/bin/env node
// Location-free digest of release/contract-matrix.json (produced by `pnpm audit:ipc`).
// File moves change handler/caller locations but must not change which commands are
// whitelisted, handled, called from the UI, or their status (20261115-md §7.1 gate).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { counts, matrix } = JSON.parse(readFileSync(process.argv[2] ?? 'release/contract-matrix.json', 'utf8'));
const rows = matrix.map(r => [r.command, r.whitelisted, !!r.handler, r.status, r.reachability, (r.callers ?? []).map(c => c.symbol).sort().join(','), (r.uiEntries ?? []).length].join('|')).sort();
const digest = createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
console.log('CONTRACT', JSON.stringify(counts), 'rows', rows.length, 'digest', digest);
