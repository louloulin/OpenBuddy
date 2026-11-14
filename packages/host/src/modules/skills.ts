import { bool, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `skills` module. Skills and slash commands. */
export function skillsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    skills_list: (p) =>
      engine.skills.list(typeof p.cwd === "string" ? p.cwd : engine.currentCwd),
    skills_add: async (p) => {
      await engine.skills.add(text(p.path));
      await engine.reload();
    },
    skills_remove: async (p) => {
      await engine.skills.remove(text(p.path));
      await engine.reload();
    },
    skills_toggle: async (p) => {
      engine.skills.toggle(text(p.name), bool(p.enabled));
      await engine.reload();
    },
    commands_list: () => engine.commands(),
  };
  return { id: "skills", commands };
}
