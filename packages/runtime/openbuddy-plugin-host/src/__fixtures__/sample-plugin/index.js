/**
 * @fixture/sample-plugin — Phase K.2 reference plugin.
 *
 * Demonstrates the canonical shape that the OpenBuddyPlugin SDK
 * (Phase K.1 manifest + Phase K.2 track serialisers) consumes. The
 * module exports a default function that Cordis plugins can apply; the
 * `pi` track uses the inline name (`@fixture/sample-plugin:extension`)
 * to bind the ExtensionFactory registered in `./extensions/index.js`.
 */
export default function samplePlugin(ctx, config) {
  ctx.provide("samplePlugin", {
    source: "openbuddy.plugin.v1",
    greeting: config?.greeting ?? "hello from sample-plugin",
  });
  return () => ctx.set("samplePlugin", undefined);
}