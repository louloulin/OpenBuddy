import type { Context } from "@openbuddy/cordis";
import type { RendererContributionRegistry } from "../src/index";

export const name = "workbuddy-example-sidebar";
export const inject = ["rendererContributions"] as const;

export function apply(ctx: Context, config?: { label?: string }): () => void {
  const registry = ctx.get("rendererContributions") as RendererContributionRegistry;
  const unregister = registry.register({
    kind: "sidebar",
    id: "example-sidebar",
    payload: { label: config?.label ?? "Example" },
  });
  return unregister;
}
