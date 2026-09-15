const asar = require('/Users/louloulin/appx/OpenBuddy/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const fs = require('node:fs');

// Try without leading slash
const files = [
  'cli/dist/web-ui/index.html',
  'cli/dist/web-ui/assets/index-B0dxQZal.css',
];

for (const f of files) {
  try {
    const buf = asar.extractFile('/tmp/wb-app.asar', f);
    const out = '/tmp/wb-' + f.split('/').pop();
    fs.writeFileSync(out, buf);
    console.log('OK', f, '→', out, '(' + buf.length + ' bytes)');
  } catch (e) {
    console.error('FAIL', f, e.message);
  }
}
