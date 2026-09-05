/**
 * End-to-end smoke test for a renderer plugin loaded through the same runtime
 * WorkBuddy's UI uses. The example plugin registers a sidebar contribution and
 * subscribes to a couple of agent events; the test runs the whole loader
 * lifecycle and asserts the contribution is observable from the cordis context.
 */
import { describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import {
  RendererPluginLoader,
  createRendererContext,
  type RendererContributionRegistry,
  type RendererEventRegistry,
} from "../src/index";
import * as examplePluginModule from "./example-plugin";
const examplePlugin = examplePluginModule as unknown as Parameters<typeof RendererPluginLoader>[0] extends never ? never : { apply: typeof examplePluginModule.apply; name?: string };

describe("renderer-plugin integration", () => {
  it("loads the example plugin and exposes its sidebar contribution", async () => {
    const ctx = createRendererContext(new Context());
    const loader = new RendererPluginLoader(ctx, async () => examplePlugin);
    await loader.load([{ id: "example", name: examplePlugin.name ?? "example", config: { label: "Hi" } }]);

    const contributions = ctx.get("rendererContributions") as RendererContributionRegistry;
    const items = contributions.list();
    expect(items.map((c) => c.id)).toContain("example-sidebar");
    expect(items.find((c) => c.id === "example-sidebar")?.payload).toEqual({ label: "Hi" });

    await loader.dispose();
    expect(contributions.list()).toEqual([]);
  });

  it("isolates plugin lifecycle from renderer event listeners", async () => {
    const ctx = createRendererContext(new Context());
    const loader = new RendererPluginLoader(ctx, async () => examplePlugin);
    const events = ctx.get("rendererEvents") as RendererEventRegistry;
    const seen: string[] = [];
    events.on("plugin/loaded", () => seen.push("loaded"));
    events.on("plugin/unloaded", () => seen.push("unloaded"));

    await loader.load([{ id: "example", name: "example" }]);
    await loader.dispose();
    expect(seen).toEqual(["loaded", "unloaded"]);
  });
});
