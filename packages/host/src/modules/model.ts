import { object, text, unsupported } from "@openbuddy/services/settings/settings";
import { validateThinkingLevel } from "@openbuddy/engine/pi-engine";
import { modelKey } from "@openbuddy/services/providers/providers";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `model` module. Per-session model and thinking level; default model settings. */
export function modelModule(ctx: HostContext): HostModule {
  const { emit, engine, update } = ctx;
  const commands: Record<string, Handler> = {
    agent_set_model: (p) =>
      engine.setModel(
        text(p.sessionId),
        text(p.modelId),
        typeof p.providerId === "string" ? p.providerId : undefined,
      ),
    agent_get_model_state: (p) => engine.modelState(text(p.sessionId)),
    agent_set_thinking_level: (p) =>
      engine.setThinkingLevel(text(p.sessionId), p.level),
    agents_defaults_get: () => engine.providers.defaults(),
    agents_defaults_save: (p) => {
      const d = object(p.defaults);
      if (d.rememberToolApprovals === true)
        unsupported("remember tool approvals");
      if (
        typeof d.defaultModel !== "string" ||
        !["ask", "auto", "always-approve"].includes(String(d.defaultPermission))
      )
        throw Error("无效的默认设置");
      const selected = d.defaultModel
        ? engine.providers.entry(
            d.defaultModel as string,
            typeof d.defaultProviderId === "string"
              ? d.defaultProviderId
              : undefined,
          )
        : undefined;
      if (d.defaultModel && !selected) throw Error("default_model_not_found");
      const thinking =
        d.defaultThinkingLevel === undefined
          ? undefined
          : validateThinkingLevel(d.defaultThinkingLevel);
      update((c) => {
        c.defaults = {
          defaultModel: selected
            ? modelKey(selected.providerId, selected.modelId)
            : "",
          defaultProviderId: selected?.providerId,
          defaultThinkingLevel: thinking,
          defaultPermission: String(d.defaultPermission),
          rememberToolApprovals: !!d.rememberToolApprovals,
        };
        c.permissionMode = d.defaultPermission as "ask";
      });
      emit("agent://models-update", {});
    },
  };
  return { id: "model", commands };
}
