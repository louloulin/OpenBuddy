export default function externalDshPlugin(ctx, config) {
  ctx.provide("externalDsh", { source: config?.source ?? "unknown" });
  return () => ctx.set("externalDsh", undefined);
}
