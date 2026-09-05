import { describe, expect, it } from "vitest";
import { OpenBuddyConversationAssembler, type ConversationDefinition, type ConversationViewBuilder } from "./conversation-assembler";

function definition(): ConversationDefinition {
	return {
		kind: "message",
		target: "chat",
		match: (event) => {
			const data = event.data as { id?: string; messageId?: string; text?: string };
			if (event.type === "user/message" && data.id) return { id: data.id, role: "start" };
			if (event.type === "assistant/message" && data.messageId) return { id: data.messageId, role: "update" };
			return null;
		},
		start: (_context, match) => ({ text: (match.event.data as { text?: string }).text ?? "", updates: 0 }),
		update: (context, match) => ({ ...(context.state as { text: string; updates: number }), text: (match.event.data as { text?: string }).text ?? "", updates: (context.state as { updates: number }).updates + 1 }),
		buildViewNode: (context) => ({ key: context.key, kind: context.kind, id: context.id, target: "chat", data: context.state }),
	};
}

describe("OpenBuddyConversationAssembler", () => {
	it("assembles start/update contexts and stable target snapshots", () => {
		const events = { entries: () => [definition()] };
		const views = { entries: () => [{ target: "chat" }] };
		const assembler = new OpenBuddyConversationAssembler(events, views);
		assembler.replaceWindow([
			{ seq: 2, type: "assistant/message", messageId: "m1", text: "answer" },
			{ seq: 1, type: "user/message", id: "m1", text: "question" },
		]);
		const snapshot = assembler.snapshot("chat");
		expect(snapshot?.order).toEqual(["7:messagem1"]);
		expect(snapshot?.nodes.get("7:messagem1")).toMatchObject({ data: { text: "answer", updates: 1 } });
		const firstNode = snapshot?.nodes.get("7:messagem1");
		assembler.append({ seq: 3, type: "assistant/message", messageId: "m1", text: "final" });
		expect(assembler.snapshot("chat")?.nodes.get("7:messagem1")).toMatchObject({ key: firstNode?.key, data: { text: "final", updates: 2 } });
	});

	it("uses fallback definitions and rebuilds when a registry changes", () => {
		const fallback: ConversationDefinition = {
			kind: "fallback",
			target: "chat",
			match: (event) => ({ id: String(event.seq), role: "start" }),
			start: (_context, match) => match.event.type,
			update: (context) => context.state,
			buildViewNode: (context) => ({ key: context.key, kind: context.kind, id: context.id, target: "chat", data: context.state }),
		};
		const events = { entries: () => [], fallbackEntry: () => fallback };
		const views = { entries: () => [{ target: "chat" }] };
		const assembler = new OpenBuddyConversationAssembler(events, views);
		assembler.replaceWindow([{ seq: 4, type: "unknown", data: {} }]);
		expect(assembler.snapshot("chat")?.nodes.get("8:fallback4")).toMatchObject({ data: "unknown" });
	});

	it("resolves Turn/Step locations and publishes step data before turn data", () => {
		const definition: ConversationDefinition = {
			kind: "scope",
			target: "chat",
			match: (event) => event.type === "step/start" ? { id: "scope", role: "start" } : event.type === "scope/update" ? { id: "scope", role: "update" } : null,
			start: (_context, match) => ({ value: 1, turn: (match.event.data as { turn: number }).turn, step: (match.event.data as { step: number }).step }),
			update: (context, match) => ({ ...(context.state as { value: number; turn: number; step: number }), value: (match.event.data as { value: number }).value }),
			buildLocationData: (context, scope) => {
				const state = context.state as { value: number; turn: number; step: number };
				return scope === "step"
					? { kind: "step", turn: state.turn, step: state.step, key: "scope", value: { value: state.value } }
					: { kind: "turn", turn: state.turn, key: "scope", value: { fromStep: context.start.location.kind === "step" ? context.start.location.step.data.get("scope") : undefined } };
			},
			buildViewNode: (context) => ({ key: context.key, kind: context.kind, id: context.id, target: "chat", data: context.start.location }),
		};
		const assembler = new OpenBuddyConversationAssembler(
			{ entries: () => [definition] },
			{ entries: () => [{ target: "chat" }] },
		);
		assembler.replaceWindow([
			{ seq: 1, type: "turn/start", data: { turn: 2 } },
			{ seq: 2, type: "step/start", data: { turn: 2, step: 1 } },
		]);
		const location = assembler.snapshot("chat")?.nodes.get("5:scopescope")?.data as { kind?: string };
		expect(location?.kind).toBe("step");
		expect(assembler.timeline().turns.get(2)?.steps).toHaveLength(1);
	});

	it("uses a registered view builder and honors publication cadence", () => {
		const applied: unknown[][] = [];
		const builder: ConversationViewBuilder = {
			empty: { nodes: [] },
			replace: ({ nodes }) => ({ nodes }),
			apply: ({ upserts }) => { applied.push([...upserts]); return { nodes: upserts }; },
		};
		const definition = { ...definitionForBuilder(), publication: () => "animation-frame" as const };
		const assembler = new OpenBuddyConversationAssembler(
			{ entries: () => [definition] },
			{ entries: () => [{ target: "chat", create: () => builder }] },
		);
		assembler.replaceWindow([{ seq: 1, type: "builder/start", data: {} }]);
		expect(assembler.append({ seq: 2, type: "builder/update", data: {} })).toBe("animation-frame");
		expect(applied).toHaveLength(1);
	});
});

function definitionForBuilder(): ConversationDefinition {
	return {
		kind: "builder",
		target: "chat",
		match: (event) => event.type === "builder/start" ? { id: "1", role: "start" } : event.type === "builder/update" ? { id: "1", role: "update" } : null,
		start: () => ({ count: 0 }),
		update: (context) => ({ count: (context.state as { count: number }).count + 1 }),
		buildViewNode: (context) => ({ key: context.key, kind: context.kind, id: context.id, target: "chat", data: context.state }),
	};
}
