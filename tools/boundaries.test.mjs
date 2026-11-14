// @vitest-environment node
// P3.1 (20261115-md): module boundaries are a blocking test. A category count may only shrink;
// after fixing violations run `node tools/check-boundaries.mjs --update-baseline`.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('no boundary category grows beyond tools/boundaries-baseline.json', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [join(import.meta.dirname, 'check-boundaries.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    throw new Error(`${error.stdout ?? ''}${error.stderr ?? ''}`);
  }
  expect(output).toContain('BOUNDARIES_OK');
});
