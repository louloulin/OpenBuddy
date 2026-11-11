import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { COMMANDS, EVENTS } from '../dist-electron/shared/contract.js';
await mkdir(new URL('../dist-electron/', import.meta.url), { recursive: true });
const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
await writeFile(new URL('../dist-electron/preload.cjs', import.meta.url), preload.replace('/* COMMANDS */ []', JSON.stringify(COMMANDS)).replace('/* EVENTS */ []', JSON.stringify(EVENTS)));
