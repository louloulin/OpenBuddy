import { text } from "@openbuddy/services/settings/settings";
import { ExpertStore } from "@openbuddy/services/agents/store";
import { ExpertLinkRegistry, readExpertLink } from "@openbuddy/services/agents/expert-links";
import { workBuddyTeamChainPrompt, readWorkBuddyPackageFrom, type WorkBuddyPackage } from "@openbuddy/services/agents/workbuddy";
import { CapabilityPackService } from "@openbuddy/services/agents/capability-pack";
import { teamPrompt, teamSeed, teamTemplates } from "@openbuddy/services/agents/teams";
import { clearSessionExpert, setSessionExpert } from "@openbuddy/engine/features/expert";
import { ProtocolError } from "@openbuddy/protocol/errors";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExpertDraft, ExpertEntry, ExpertLinkImportResult, ExpertLinkPreview, WorkBuddyContribution, WorkBuddySkippedContribution } from "@openbuddy/protocol/experts";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * `experts` module (20261116-pii W2.1–W2.3): the expert store (`agents_*`), the catalog and its
 * library directories (`experts_*`), and binding an expert to a session. Command names are the
 * ones the renderer already used; older payload shapes (`{ path }`, `{ name, raw }`) still work.
 */
const optional = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined);
const bool = (value: unknown) => value === true;
const contributionKind = (value: unknown) => (value === "skill" || value === "prompt" || value === "mcp" ? value : "skill");

export function expertsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  // Built on first use: module factories must not touch the context (modules.test.ts).
  let store: ExpertStore | undefined;
  const experts = () => (store ??= new ExpertStore({ dir: ctx.settings.dir, trusted: (cwd) => engine.trusted(cwd) }));
  // 能力包 (B1b): skills → skillPaths, commands → prompts, mcpServers → disabled MCP entries.
  let packs: CapabilityPackService | undefined;
  const capabilityPacks = () =>
    (packs ??= new CapabilityPackService(
      ctx.settings.dir,
      {
        read: () => {
          const config = ctx.settings.config.read();
          return { skillPaths: [...config.skillPaths], disabledSkills: [...config.disabledSkills] };
        },
        write: (value) =>
          ctx.update((config) => {
            config.skillPaths = value.skillPaths;
            config.disabledSkills = value.disabledSkills;
          }),
      },
      (servers) => engine.mcp.registerFromPack(servers),
      (name, enabled) => engine.mcp.toggle(name, enabled),
      (name) => engine.mcp.list().find((server) => server.name === name)?.enabled ?? false,
    ));
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
  /** Install one parsed package: experts, capability contributions and the team prompt (S18/S21/B1b). */
  const installPackage = async (path: string) => {
    let pkg: WorkBuddyPackage | undefined;
    const result = experts().importWorkBuddy(path, (value) => {
      pkg = value;
    });
    const installed = pkg
      ? capabilityPacks().install(pkg)
      : {
          contributions: [] as WorkBuddyContribution[],
          skippedContributions: [] as WorkBuddySkippedContribution[],
          requires: [] as string[],
        };
    const merged = { ...result, ...installed };
    if (!merged.team) return merged;
    const slug = merged.team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workbuddy";
    const saved = new Set((await engine.prompts.list()).map((entry) => entry.name));
    let command = `team-wb-${slug}`;
    for (let n = 2; saved.has(command); n++) command = `team-wb-${slug}-${n}`;
    const team = merged.team;
    const members = team.members.map((id) => {
      const expert = merged.imported.find((entry) => entry.id === id);
      return { id, name: expert?.name ?? id, role: id === team.leadAgent ? "lead" as const : "member" as const, description: expert?.description };
    });
    try {
      await engine.prompts.save("global", {
        name: command,
        description: `WorkBuddy 团队：${team.name}`,
        content: workBuddyTeamChainPrompt(team.name, members),
      });
      return { ...merged, team: { ...team, command } };
    } catch (error) {
      return { ...merged, team: { ...team, error: error instanceof Error ? error.message : String(error) } };
    }
  };
  let linkStore: ExpertLinkRegistry | undefined;
  const linkRegistry = () => (linkStore ??= new ExpertLinkRegistry(ctx.settings.dir));
  /** Canonical registry key: the resolved local path, or the URL as typed. */
  const linkKey = (source: string, path?: string) => (path ? path : source);
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
    // WorkBuddy 兼容 (S18/S21): import a WorkBuddy expert package; team packages also install a
    // `/team-wb-…` prompt so the lead/member roles are usable without a second step.
    experts_import_workbuddy: (p) => installPackage(text(p.path)),
    // 专家链接 (B3b): preview an https URL or local package, then import it once per content digest.
    experts_link_preview: async (p) => {
      const link = await readExpertLink(text(p.source));
      const pkg = link.bytes
        ? readWorkBuddyPackageFrom(link.name, link.bytes)
        : readWorkBuddyPackageFrom(link.path ?? link.source);
      const previous = linkRegistry().get(linkKey(link.source, link.path));
      const preview: ExpertLinkPreview = {
        source: link.source,
        remote: link.remote,
        sha256: link.sha256,
        size: link.size,
        package: pkg.name,
        experts: pkg.drafts.map((item) => ({
          ...(item.draft.id ? { id: item.draft.id } : {}),
          name: item.draft.name,
          ...(item.draft.description ? { description: item.draft.description } : {}),
        })),
        ...(pkg.team ? { team: { name: pkg.team.name, ...(pkg.team.leadAgent ? { leadAgent: pkg.team.leadAgent } : {}), members: pkg.team.memberAgents } } : {}),
        contributions: { skills: pkg.skills.length, prompts: pkg.prompts.length, mcpServers: pkg.mcpServers.length },
        skipped: pkg.skippedContributions,
        requires: pkg.requires,
        duplicate: !!previous && previous.sha256 === link.sha256,
        ...(previous ? { importedExpertIds: previous.experts } : {}),
      };
      return preview;
    },
    experts_link_import: async (p) => {
      const link = await readExpertLink(text(p.source));
      const key = linkKey(link.source, link.path);
      const previous = linkRegistry().get(key);
      if (previous && previous.sha256 === link.sha256) {
        const duplicate: ExpertLinkImportResult = {
          package: previous.package,
          imported: [],
          skipped: [],
          source: link.source,
          sha256: link.sha256,
          duplicate: true,
          importedExpertIds: previous.experts,
        };
        return duplicate;
      }
      let installed;
      if (link.remote) {
        const temp = mkdtempSync(join(tmpdir(), "openbuddy-link-"));
        try {
          const file = join(temp, link.name || "package.zip");
          writeFileSync(file, link.bytes ?? Buffer.alloc(0), { mode: 0o600 });
          installed = await installPackage(file);
        } finally {
          rmSync(temp, { recursive: true, force: true });
        }
      } else {
        installed = await installPackage(link.path ?? link.source);
      }
      const importedExpertIds = installed.imported.map((entry) => entry.id);
      linkRegistry().record({
        source: key,
        sha256: link.sha256,
        package: installed.package,
        experts: importedExpertIds,
        at: new Date().toISOString(),
      });
      const result: ExpertLinkImportResult = {
        ...installed,
        source: link.source,
        sha256: link.sha256,
        duplicate: false,
        importedExpertIds,
      };
      return result;
    },
    // 能力包 (B1a): inspect one WorkBuddy package's installed contributions, switch them, or roll back.
    capability_packs_list: () => capabilityPacks().list(),
    capability_packs_set_enabled: async (p) => {
      const packs = capabilityPacks().setEnabled(text(p.id), bool(p.enabled));
      await engine.reload();
      return packs;
    },
    capability_packs_set_contribution: async (p) => {
      const packs = capabilityPacks().setContribution(text(p.id), contributionKind(p.kind), text(p.name), bool(p.enabled));
      await engine.reload();
      return packs;
    },
    capability_packs_remove: async (p) => {
      const result = capabilityPacks().remove(text(p.id));
      await engine.reload();
      return result;
    },
    // 专家团 (W3.5): preset pipelines, installed as a 我的指令 prompt template.
    teams_list: async () => {      const saved = new Set((await engine.prompts.list()).map((entry) => entry.name));
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
