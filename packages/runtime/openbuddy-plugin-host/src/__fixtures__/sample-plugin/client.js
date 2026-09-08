/**
 * Sample renderer-side (slot track) entry for `@fixture/sample-plugin`.
 *
 * Loaded by the renderer's boot graph when `dsh.client` (or the
 * OpenBuddy-native `openbuddy.client`) is declared in `package.json`.
 * The slot track `apply(ctx)` registers a small renderer contribution
 * so the host's SlotCore can render the badge widget.
 */
export default {
  inject: ["rendererContributions"],
  apply(ctx) {
    const registry = ctx.get("rendererContributions");
    if (!registry?.register) return undefined;
    return registry.register({
      kind: "settings",
      id: "sample-plugin/badge",
      payload: { title: "Sample Plugin", description: "Phase K.2 reference plugin" },
    });
  },
};