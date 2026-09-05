/**
 * @openbuddy/team-team/pi — Pi SDK extension adapter for the team Tools.
 *
 * The Cordis Service-class `Team` (defined in `./index.ts`) holds the
 * authoritative state — on-disk teams.json, create/status/delete — but the LLM
 * can only reach it from inside the Pi tool loop if we register a Pi SDK
 * extension that wires up `pi.registerTool(...)` calls against the live
 * Service. This file is the bridge.
 *
 * It is intentionally separate from the Service itself: the Service is
 * reusable (renderer, automation runner, CLI), while this adapter is the
 * only piece that knows about `ExtensionAPI`. Tests for the Service should
 * never touch Pi SDK APIs.
 *
 * Implementation note: this is a thin *statically importable* module. Pi SDK
 * extensions have the shape `(pi: ExtensionAPI) => void` and run inside
 * `createAgentSession({ extensions: [...] })`. The Cordis context's Team
 * service is mounted by `electron/main/agent-host.ts` before the LLM fires,
 * so by the time any `team_create` tool call runs, `ctx.team` is already
 * available. We capture it via the exported `_ctxRef` Module-level
 * singleton from the main module.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { teamToolsHandlers } from "./index";

export default function teamToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_create",
		description: "Spawn a multi-agent team to tackle a goal in parallel.",
		label: "Create team",
		parameters: Type.Object({ goal: Type.String(), size: Type.Optional(Type.Union([Type.Literal("small"), Type.Literal("medium"), Type.Literal("large")])) }),
		execute: async (_toolCallId, args) => {
			const team = await teamToolsHandlers.create(args.goal, args.size ?? "medium");
		return { content: [{ type: "text", text: JSON.stringify({ ok: true, teamId: team.id, members: team.members.length }) }], details: { ok: true, teamId: team.id, members: team.members.length } };
		},
	});

	pi.registerTool({
		name: "team_status",
		description: "Get the current status and member outputs of a running team.",
		label: "Team status",
		parameters: Type.Object({ teamId: Type.String() }),
		execute: async (_toolCallId, args) => {
			const team = await teamToolsHandlers.status(args.teamId);
			if (!team) return { content: [{ type: "text", text: `team ${args.teamId} not found` }], details: { ok: false } };
			const result = {
				ok: true,
				status: team.status,
				members: team.members.map((m) => ({
					id: m.id,
					role: m.role,
					status: m.status,
					output: m.output?.slice(0, 500),
				})),
			};
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "team_delete",
		description: "Mark a team as deleted and remove it from disk.",
		label: "Delete team",
		parameters: Type.Object({ teamId: Type.String() }),
		execute: async (_toolCallId, args) => {
			const ok = await teamToolsHandlers.delete(args.teamId);
			return { content: [{ type: "text", text: JSON.stringify({ ok }) }], details: { ok } };
		},
	});
}

export function createTeamTools(): ToolDefinition[] {
	const tools: ToolDefinition[] = [];
	teamToolsExtension({ registerTool: (tool: ToolDefinition) => tools.push(tool) } as unknown as ExtensionAPI);
	return tools;
}
