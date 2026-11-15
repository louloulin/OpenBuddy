import { bool, text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `skills` module. Skills, the 技能目录 (W2.7) and 我的指令 prompt templates (W2.7 / S8). */
export function skillsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const cwdOf = (p: Record<string, unknown>) => (typeof p.cwd === "string" && p.cwd ? p.cwd : engine.currentCwd);
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
    // 技能目录 (pii W2.7): scan a marketplace root, read a SKILL.md before import.
    skills_catalog_default_root: () => engine.skillCatalog.defaultRoot(),
    skills_catalog_list_roots: (p) => engine.skillCatalog.listRoots(text(p.root)),
    skills_catalog_load: (p) =>
      engine.skillCatalog.load(typeof p.root === "string" && p.root ? p.root : undefined, typeof p.builtinRoot === "string" ? p.builtinRoot : undefined),
    skills_catalog_read_skill: (p) => engine.skillCatalog.readSkill(text(p.dir)),
    // 我的指令 (pii W2.7 / S8): Pi prompt templates in <agentDir>/prompts and trusted <cwd>/.pi/prompts.
    prompts_list: (p) => engine.prompts.list(cwdOf(p)),
    prompts_get: (p) => engine.prompts.get(p.scope === "workspace" ? "workspace" : "global", text(p.name), cwdOf(p)),
    prompts_save: (p) =>
      engine.prompts.save(
        p.scope === "workspace" ? "workspace" : "global",
        {
          name: text(p.name),
          ...(typeof p.description === "string" ? { description: p.description } : {}),
          ...(typeof p.argumentHint === "string" ? { argumentHint: p.argumentHint } : {}),
          content: typeof p.content === "string" ? p.content : "",
        },
        cwdOf(p),
      ),
    prompts_delete: (p) => engine.prompts.delete(p.scope === "workspace" ? "workspace" : "global", text(p.name), cwdOf(p)),
  };
  return { id: "skills", commands };
}
