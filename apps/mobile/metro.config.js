// Metro config (20261115-mobile.md Phase 3.5 preview).
//
// `expo-sqlite` on web loads a WASM worker; Metro only bundles `.wasm` when it
// is declared as an asset. Native builds ignore this file's asset change.
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.resolver.assetExts.push('wasm')

module.exports = config
