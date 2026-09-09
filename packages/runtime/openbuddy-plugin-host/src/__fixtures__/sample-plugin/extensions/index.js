/**
 * Sample PI extension for `@fixture/sample-plugin`.
 *
 * Loaded by PI's `loadExtensions()` after the host resolves the manifest's
 * `pi` track inline id. Demonstrates the smallest viable ExtensionAPI
 * surface for the K.2 SDK: a single `registerCommand` + the SDK-injected
 * config defaults from `plugin.json`.
 */
export default function samplePiExtension(pi, config) {
  const greeting = config?.greeting ?? "hello from sample-plugin";
  pi.registerCommand("sample-plugin", {
    description: "Phase K.2 reference plugin — echoes the greeting from plugin.json",
    handler: async () => greeting,
  });
}