module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Reanimated 4 ships its worklet transform inside babel-preset-expo, so no
    // extra plugin entry is needed (adding the old one breaks the build).
  };
};
