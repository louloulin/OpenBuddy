import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const files = [
  ['/cli/dist/web-ui/index.html', '/tmp/wb-index.html'],
  ['/cli/dist/web-ui/assets/index-B0dxQZal.css', '/tmp/wb-index.css'],
];

for (const [src, out] of files) {
  await new Promise((resolve) => {
    const p = spawn('node', [
      '/opt/homebrew/lib/node_modules/asar/bin/asar.js',
      'extract-file',
      '/tmp/wb-app.asar',
      src,
      out,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => stderr += d.toString());
    p.on('exit', (code) => {
      if (code === 0) {
        console.log('OK', src);
        resolve();
      } else {
        console.error('FAIL', src, code, stderr.trim().slice(0, 200));
        resolve();
      }
    });
  });
}
