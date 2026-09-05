import type { RendererPluginProfile } from "@openbuddy/renderer-host";

export {
  openBuddyRendererPluginIndex,
  rendererComposerPlugin,
  rendererSidebarPlugin,
} from "./renderer-plugins";

export const openBuddyRendererEntries: RendererPluginProfile["entries"] = [
  { id: "openbuddy-renderer-sidebar", name: "openbuddy-renderer-sidebar" },
  { id: "openbuddy-renderer-composer", name: "openbuddy-renderer-composer" },
];

export const openBuddyDeepSeekRendererEntries: RendererPluginProfile["entries"] = [
  { id: "openbuddy-dsh-client-ui-slots", name: "@deepseek-ai/dsh-client-ui-slots/client" },
  { id: "openbuddy-dsh-client-locale", name: "@deepseek-ai/dsh-client-locale/client" },
  { id: "openbuddy-dsh-client-connection", name: "@deepseek-ai/dsh-client-connection/client" },
  { id: "openbuddy-dsh-client-runtime", name: "@deepseek-ai/dsh-client-runtime/client", inject: ["connection"] },
  { id: "openbuddy-dsh-client-ui-commands", name: "@deepseek-ai/dsh-client-ui-commands/client", inject: ["connection"] },
  { id: "openbuddy-dsh-api-remotes", name: "@deepseek-ai/dsh-api-remotes/client", inject: ["connection"] },
  { id: "openbuddy-dsh-client-ui-layout", name: "@deepseek-ai/dsh-client-ui-layout/client", inject: ["slots", "theme"] },
  { id: "openbuddy-dsh-client-ui-theme", name: "@deepseek-ai/dsh-client-ui-theme/client", inject: ["connection", "locale"] },
  { id: "openbuddy-dsh-client-ui-renderer", name: "@deepseek-ai/dsh-client-ui-renderer/client", inject: ["slots"] },
  { id: "openbuddy-dsh-client-ui-conversation", name: "@deepseek-ai/dsh-client-ui-conversation/client", inject: ["slots", "layout"] },
  { id: "openbuddy-dsh-client-ui-sidebar", name: "@deepseek-ai/dsh-client-ui-sidebar/client", inject: ["slots", "layout"] },
  { id: "openbuddy-dsh-client-ui-workspace", name: "@deepseek-ai/dsh-client-ui-workspace/client", inject: ["slots", "connection", "sessions", "workspaces"] },
  { id: "openbuddy-dsh-client-ui-brand-official", name: "@deepseek-ai/dsh-client-ui-brand-official/client", inject: ["slots"] },
  { id: "openbuddy-dsh-client-ui-attachment", name: "@deepseek-ai/dsh-client-ui-attachment/client", inject: ["slots"] },
  { id: "openbuddy-dsh-client-ui-deliverables", name: "@deepseek-ai/dsh-client-ui-deliverables/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-input-trigger", name: "@deepseek-ai/dsh-client-ui-input-trigger/client", inject: ["slots", "sessions", "locale"] },
  { id: "openbuddy-dsh-client-ui-message-feedback", name: "@deepseek-ai/dsh-client-ui-message-feedback/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-subagent", name: "@deepseek-ai/dsh-client-ui-subagent/client", inject: ["slots", "sessions", "locale"] },
  { id: "openbuddy-dsh-client-ui-user-questions", name: "@deepseek-ai/dsh-client-ui-user-questions/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-trajectory", name: "@deepseek-ai/dsh-client-ui-trajectory/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-agent-preset", name: "@deepseek-ai/dsh-client-ui-agent-preset/client", inject: ["slots", "locale", "connection", "remote", "settingsScope"] },
  { id: "openbuddy-dsh-client-ui-settings-plugins", name: "@deepseek-ai/dsh-client-ui-settings-plugins/client", inject: ["slots", "locale", "connection", "remote", "settingsScope"] },
  { id: "openbuddy-dsh-client-ui-settings-plugin-inventory", name: "@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client", inject: ["slots", "locale", "remote"] },
  { id: "openbuddy-dsh-client-ui-permission-presets", name: "@deepseek-ai/dsh-client-ui-permission-presets/client", inject: ["slots", "locale", "connection", "remote", "settingsScope"] },
  { id: "openbuddy-dsh-client-ui-directory-picker-native", name: "@deepseek-ai/dsh-client-ui-directory-picker-native/client", inject: ["slots", "workspaces"] },
  { id: "openbuddy-dsh-client-ui-directory-picker-browse", name: "@deepseek-ai/dsh-client-ui-directory-picker-browse/client", inject: ["slots", "workspaces", "locale"] },
  { id: "openbuddy-dsh-client-ui-model-selection", name: "@deepseek-ai/dsh-client-ui-model-selection/client", inject: ["commandUi", "connection"] },
  { id: "openbuddy-dsh-client-ui-goal", name: "@deepseek-ai/dsh-client-ui-goal/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-skill", name: "@deepseek-ai/dsh-client-ui-skill/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-jobs", name: "@deepseek-ai/dsh-client-ui-jobs/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-workflow-run", name: "@deepseek-ai/dsh-client-ui-workflow-run/client", inject: ["slots", "locale"] },
  { id: "openbuddy-dsh-client-ui-settings", name: "@deepseek-ai/dsh-client-ui-settings/client", inject: ["connection", "remote"] },
  { id: "openbuddy-dsh-client-ui-settings-general", name: "@deepseek-ai/dsh-client-ui-settings-general/client", inject: ["slots"] },
  { id: "openbuddy-dsh-client-ui-settings-models", name: "@deepseek-ai/dsh-client-ui-settings-models/client", inject: ["slots", "connection"] },
];

export function createOpenBuddyRendererProfile(
  entries: RendererPluginProfile["entries"] = openBuddyRendererEntries,
  patches: NonNullable<RendererPluginProfile["patches"]> = [],
): RendererPluginProfile {
  return { entries: [...entries], patches };
}
