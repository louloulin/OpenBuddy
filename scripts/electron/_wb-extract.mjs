import * as asar from '@electron/asar';
import { writeFileSync } from 'node:fs';

const files = [
  '/cli/dist/web-ui/index.html',
  '/cli/dist/web-ui/assets/index-B0dxQZal.css',
  '/cli/dist/web-ui/assets/index-DaT8fnwQ.js',
];

for (const f of files) {
  try {
    const buf = asar.extractFile('/tmp/wb-app.asar', f);
    const out = '/tmp/wb-' + f.split('/').pop();
    writeFileSync(out, buf);
    console.log('OK', f, '→', out, '(' + buf.length + ' bytes)');
  } catch (e) {
    console.error('FAIL', f, e.message);
  }
}
