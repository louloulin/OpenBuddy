/**
 * @openbuddy/sample-plugin — fixture entrypoint for the manifest
 * serializer smoke test. The actual modules referenced by `plugin.json`
 * are intentionally absent — the fixture exists to validate that the
 * SDK parses + serializes the JSON shape correctly. The host decides
 * how to resolve the module paths; see
 * `packages/runtime/openbuddy-plugin-sdk/src/__tests__/fixtures.test.ts`.
 */
export const samplePluginInfo = {
  name: "@openbuddy/sample-plugin",
  version: "0.1.0",
};
