import type { Context } from "@openbuddy/cordis";
import type { RendererPlugin } from "@openbuddy/renderer-host";

function contributionPlugin(
  id: string,
  kind: "sidebar" | "composer",
  label: string,
  hidden = false,
): RendererPlugin & { id: string } {
  return {
    id,
    name: id,
    inject: ["rendererContributions"],
    apply: (ctx: Context) => {
      const registry = ctx.get("rendererContributions") as {
        register: (value: { kind: typeof kind; id: string; payload: Record<string, unknown> }) => () => void;
      };
      return registry.register({
        kind,
        id,
        payload: { label, source: "openbuddy-bundle-base", hidden },
      });
    },
  };
}

export const rendererSidebarPlugin = contributionPlugin(
  "openbuddy-renderer-sidebar",
  "sidebar",
  "OpenBuddy Agent",
  // v0.14.x: WorkBuddy-style sidebar does not surface this entry;
  // plugin id 保留以兼容第三方贡献者。
  true,
);

export const rendererComposerPlugin = contributionPlugin(
  "openbuddy-renderer-composer",
  "composer",
  "Ask OpenBuddy",
  // 占位死按钮(无动作),与 sidebar 条目同理:隐藏渲染,保留插件 id 兼容。
  true,
);

export const openBuddyRendererPluginIndex: ReadonlyMap<string, RendererPlugin> = new Map([
  [rendererSidebarPlugin.name!, rendererSidebarPlugin],
  [rendererComposerPlugin.name!, rendererComposerPlugin],
]);
