// 内置 UpUp (20261127-upup §1.15)：electron-builder 的 extraResources 会无条件丢掉 node_modules
// （实测 filter 写 '**/node_modules/**/*' 也没用，Resources/upup 只剩 40 MB），UpUp 扩展因此加载不了。
// 这里在 afterPack（签名之前）把 scripts/bundle-upup.mjs 产出的 vendor/upup 原样拷进 Resources/upup，
// 保留 npm 工作区的相对符号链接（node_modules/@upup/* → ../../packages/*）。
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

exports.default = async function afterPack(context) {
  const source = resolve(__dirname, '../../../vendor/upup');
  if (!existsSync(join(source, '.openbuddy-bundle.json'))) {
    throw new Error(`内置 UpUp 缺失：${source}（先运行 pnpm bundle:upup）`);
  }
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const target = join(resources, 'upup');
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, verbatimSymlinks: true, filter: (from) => !from.includes(`${'/'}node_modules${'/'}.cache`) });
  console.log(`  • bundled UpUp  target=${target}`);
};
