const asar = require('/Users/louloulin/appx/OpenBuddy/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const fs = require('node:fs');

const files = [
  '/cli/dist/web-ui/index.html',
  '/cli/dist/web-ui/assets/index-B0dxQZal.css',
];

for (const f of files) {
  try {
    // Use statFile which should work
    const stat = asar.statFile('/tmp/wb-app.asar', f);
    console.log('stat OK', f, JSON.stringify(stat));
    
    const buf = asar.extractFile('/tmp/wb-app.asar', f);
    const out = '/tmp/wb-' + f.split('/').pop();
    fs.writeFileSync(out, buf);
    console.log('OK', f, '→', out, '(' + buf.length + ' bytes)');
  } catch (e) {
    console.error('FAIL', f, e.message);
  }
}
