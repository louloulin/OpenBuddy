import { text } from "@openbuddy/services/settings/settings";
import { ExpertStore } from "@openbuddy/services/agents/store";
import { teamPrompt, teamSeed, teamTemplates } from "@openbuddy/services/agents/teams";
import { clearSessionExpert, setSessionExpert } from "@openbuddy/engine/features/expert";
import { ProtocolError } from "@openbuddy/protocol/errors";
import type { ExpertDraft, ExpertEntry } from "@openbuddy/protocol/experts";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * `experts` module (20261116-pii W2.1–W2.3): the expert store (`agents_*`), the catalog and its
 * library directories (`experts_*`), and binding an expert to a session. Command names are the
 * ones the renderer already used; older payload shapes (`{ path }`, `{ name, raw }`) still work.
 */
const optional = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined);

export function expertsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  // Built on first use: module factories must not touch the context (modules.test.ts).
  let store: ExpertStore | undefined;
  const experts = () => (store ??= new ExpertStore({ dir: ctx.settings.dir, trusted: (cwd) => engine.trusted(cwd) }));
  /** The cwd whose trusted `.pi/agents` joins the catalog: the payload's, else the focused session's. */
  const cwdOf = (p: Record<string, unknown>) => optional(p.cwd) ?? engine.currentCwd;
  const sessionCwd = (id: string) => {
    if (!engine.has(id)) throw new ProtocolError("session_not_loaded", "会话未加载");
    return engine.live(id).sessionManager.getCwd();
  };
  const profile = (expert: ExpertEntry) => ({
    id: expert.id, name: expert.name, avatar: expert.image ?? expert.emoji, scope: expert.scope, prompt: expert.prompt,
    model: expert.model, thinking: expert.thinking, tools: expert.tools, skills: expert.skills, connectors: expert.connectors,
  });
  const commands: Record<string, Handler> = {
    agents_list: (p) => experts().list(cwdOf(p)),
    agents_get: (p) => (typeof p.path === "string" ? experts().getByPath(p.path) : experts().get(text(p.id), cwdOf(p))),
    agents_save: (p) =>
      p.expert && typeof p.expert === "object"
        ? experts().save(p.expert as ExpertDraft, p.mode === "create" || p.mode === "update" ? p.mode : undefined)
        : experts().saveRaw(text(p.name), text(p.raw)),
    agents_delete: (p) => experts().delete(typeof p.path === "string" ? { path: p.path } : { id: text(p.id) }),
    agents_template: (p) =>
      experts().template(
        p.expert && typeof p.expert === "object"
          ? (p.expert as ExpertDraft)
          : { name: text(p.name), description: optional(p.description), prompt: typeof p.systemPrompt === "string" ? p.systemPrompt : "" },
      ),
    agent_set_session_expert: async (p) => {
      const id = text(p.sessionId);
      const expert = experts().get(text(p.expertId), sessionCwd(id));
      return setSessionExpert(engine, id, profile(expert));
    },
    agent_clear_session_expert: (p) => clearSessionExpert(engine, text(p.sessionId)),
    experts_default_root: () => experts().ensureUserDir(),
    experts_list_roots: () => experts().listRoots(),
    experts_set_roots: (p) => experts().setRoots(strings(p.roots) ?? []),
    experts_load: (p) => experts().catalog(cwdOf(p)),
    experts_read_agent_prompt: (p) => experts().get(text(p.id), cwdOf(p)).raw,
    experts_thumbnail: (p) => experts().image(text(p.path), 1024 * 1024).base64,
    experts_image_bytes: (p) => {
      const image = experts().image(text(p.path), 4 * 1024 * 1024);
      return `data:${image.mime};base64,${image.base64}`;
    },
    experts_link_agents: (p) => experts().importFrom(text(p.root), strings(p.ids)),
    // WorkBuddy 兼容 (S18): import a WorkBuddy expert package (ZIP or extracted folder).
    experts_import_workbuddy: (p) => experts().importWorkBuddy(text(p.path)),
    // 专家团 (W3.5): preset pipelines, installed as a 我的指令 prompt template.
    teams_list: async () => {
      const saved = new Set((await engine.prompts.list()).map((entry) => entry.name));
      return teamTemplates((command) => saved.has(command));
    },
    teams_install: async (p) => {
      const team = teamSeed(text(p.id));
      if (!team) throw new ProtocolError("team_not_found", "找不到这个专家团");
      await engine.prompts.save("global", { name: team.command, description: team.description, content: teamPrompt(team) });
      return teamTemplates((command) => command === team.command)[0];
    },
  };
  return { id: "experts", commands };
}
