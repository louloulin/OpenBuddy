export default {
  inject: ["rendererContributions"],
  apply(ctx) {
    const registry = ctx.get("rendererContributions");
    if (!registry?.register) return undefined;
    return registry.register({
      kind: "settings",
      id: "external-dsh-plugin/settings",
      payload: { title: "External DSH Plugin", description: "Loaded from a dsh.client package" },
    });
  },
};
