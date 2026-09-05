export type ConversationPublication = "none" | "animation-frame" | "immediate";

export type ConversationEvent = {
	seq: number;
	time?: number;
	type: string;
	data: unknown;
	raw: unknown;
};

export type ConversationDataStore = {
	get: (key: string) => unknown;
};

export type StepLocation = {
	turn: number;
	step: number;
	start?: ConversationEvent;
	end?: ConversationEvent;
	status: "open" | "closed" | "unknown";
	data: ConversationDataStore;
};

export type TurnLocation = {
	turn: number;
	start?: ConversationEvent;
	end?: ConversationEvent;
	status: "open" | "closed" | "unknown";
	steps: readonly StepLocation[];
	data: ConversationDataStore;
};

export type ConversationTimelineSnapshot = {
	turnOrder: readonly number[];
	turns: ReadonlyMap<number, TurnLocation>;
};

export type ConversationLocation =
	| { kind: "session" }
	| { kind: "unresolved" }
	| { kind: "turn"; turn: TurnLocation }
	| { kind: "step"; turn: TurnLocation; step: StepLocation };

export type ConversationMatch = {
	event: ConversationEvent;
	role: "start" | "update";
	location: ConversationLocation;
};

export type ConversationNodeContext<State = unknown> = {
	key: string;
	kind: string;
	id: string;
	matches: readonly ConversationMatch[];
	start: ConversationMatch;
	state: State;
	current: ReadonlyMap<string, ConversationViewNode | null>;
};

export type ConversationPreviousContext<State = unknown> = {
	key: string;
	kind: string;
	id: string;
	startSeq: number;
	state: State;
	matches: readonly ConversationMatch[];
	windowGap: boolean;
};

export type ConversationViewNode = {
	key: string;
	kind: string;
	id: string;
	target: string;
	data: unknown;
};

export type ConversationViewBuilder = {
	empty: unknown;
	replace: (input: { nodes: readonly ConversationViewNode[]; timeline: ConversationTimelineSnapshot }) => unknown;
	apply: (input: { upserts: readonly ConversationViewNode[]; timeline: ConversationTimelineSnapshot }) => unknown;
};

export type ConversationViewDefinition = {
	target: string;
	create?: () => ConversationViewBuilder;
};

export type ConversationDefinition = {
	kind: string;
	target?: string;
	match: (event: ConversationEvent) => { id: string; role: "start" | "update" } | null;
	start: (context: ConversationNodeContext<unknown>, match: ConversationMatch, reader: { previous: <State>(kind: string) => ConversationPreviousContext<State> | undefined }) => unknown;
	update: (context: ConversationNodeContext<unknown>, match: ConversationMatch) => unknown;
	publication?: (match: ConversationMatch) => ConversationPublication;
	buildLocationData?: (context: ConversationNodeContext<unknown>, scope: "turn" | "step") => { kind: "turn" | "step"; turn: number; step?: number; key: string; value: unknown } | null;
	buildViewNode?: (context: ConversationNodeContext<unknown>) => ConversationViewNode | null;
};

export type ConversationEventRegistryLike = {
	entries: () => readonly ConversationDefinition[];
	fallbackEntry?: () => ConversationDefinition | undefined;
};

export type ConversationViewRegistryLike = {
	entries: () => readonly ConversationViewDefinition[];
};

export type ConversationTargetSnapshot = {
	order: readonly string[];
	nodes: ReadonlyMap<string, ConversationViewNode>;
};

type InternalContext = {
	key: string;
	kind: string;
	id: string;
	definition: ConversationDefinition;
	start?: ConversationMatch;
	matches: ConversationMatch[];
	state: unknown;
	current: Map<string, ConversationViewNode | null>;
};

type LocationCoordinates = { turn?: number; step?: number; session?: true };
type StepDraft = { turn: number; step: number; firstSeq: number; start?: ConversationEvent; end?: ConversationEvent };
type LocationDraft = { turn: number; firstSeq: number; start?: ConversationEvent; end?: ConversationEvent; steps: Map<number, StepDraft> };

const PUBLICATION_RANK: Record<ConversationPublication, number> = { none: 0, "animation-frame": 1, immediate: 2 };
const SESSION_LOCATION: ConversationLocation = { kind: "session" };
const UNRESOLVED_LOCATION: ConversationLocation = { kind: "unresolved" };

function contextKey(kind: string, id: string): string {
	return `${kind.length}:${kind}${id}`;
}

function maximumPublication(left: ConversationPublication, right: ConversationPublication): ConversationPublication {
	return PUBLICATION_RANK[left] >= PUBLICATION_RANK[right] ? left : right;
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function eventOf(value: unknown, fallbackSeq: number): ConversationEvent {
	const record = recordOf(value);
	const nested = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
		? recordOf(record.payload)
		: record.data && typeof record.data === "object" && !Array.isArray(record.data)
			? recordOf(record.data)
			: record;
	const seq = typeof record.sessionSequence === "number" ? record.sessionSequence
		: typeof record.seq === "number" ? record.seq
			: typeof record.sequence === "number" ? record.sequence : fallbackSeq;
	const time = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : typeof record.time === "number" ? record.time : undefined;
	return {
		seq,
		...(time !== undefined && Number.isFinite(time) ? { time } : {}),
		type: typeof nested.type === "string" ? nested.type : typeof record.type === "string" ? record.type : "unknown",
		data: nested.payload ?? nested.data ?? nested,
		raw: value,
	};
}

function eventData(event: ConversationEvent): Record<string, unknown> {
	return recordOf(event.data);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function defaultViewBuilder(): ConversationViewBuilder {
	let current: ConversationTargetSnapshot = { order: [], nodes: new Map() };
	return {
		empty: current,
		replace: ({ nodes }) => {
			const next = nodes.slice();
			current = { order: next.map((node) => node.key), nodes: new Map(next.map((node) => [node.key, node])) };
			return current;
		},
		apply: ({ upserts }) => {
			const nodes = new Map(current.nodes);
			const order = [...current.order];
			for (const node of upserts) {
				if (!nodes.has(node.key)) order.push(node.key);
				nodes.set(node.key, node);
			}
			current = { order, nodes };
			return current;
		},
	};
}

class LocationIndex {
	private coordinates = new Map<number, LocationCoordinates>();
	private locations = new Map<number, ConversationLocation>();
	private timeline: ConversationTimelineSnapshot = { turnOrder: [], turns: new Map() };
	private turnData = new Map<number, Map<string, unknown>>();
	private stepData = new Map<string, Map<string, unknown>>();

	rebuild(events: readonly ConversationEvent[]): void {
		const coordinates = new Map<number, LocationCoordinates>();
		const turns = new Map<number, LocationDraft>();
		let currentTurn: number | undefined;
		let currentStep: number | undefined;
		const turnDraft = (turn: number, seq: number): LocationDraft => {
			const existing = turns.get(turn);
			if (existing) {
				existing.firstSeq = Math.min(existing.firstSeq, seq);
				return existing;
			}
			const created = { turn, firstSeq: seq, steps: new Map() };
			turns.set(turn, created);
			return created;
		};
		const stepDraft = (turn: number, step: number, seq: number) => {
			const owner = turnDraft(turn, seq);
			const existing = owner.steps.get(step);
			if (existing) {
				existing.firstSeq = Math.min(existing.firstSeq, seq);
				return existing;
			}
			const created: StepDraft = { turn, step, firstSeq: seq };
			owner.steps.set(step, created);
			return created;
		};
		for (const event of events.slice().sort((left, right) => left.seq - right.seq)) {
			const data = eventData(event);
			const explicitTurn = numberValue(data.turn);
			const explicitStep = numberValue(data.step);
			if (event.type === "turn/start") {
				currentTurn = explicitTurn;
				currentStep = undefined;
			} else if (event.type === "step/start") {
				currentTurn = explicitTurn;
				currentStep = explicitStep;
			}
			if (explicitTurn !== undefined) {
				if (currentTurn !== explicitTurn) currentStep = undefined;
				currentTurn = explicitTurn;
				if (explicitStep !== undefined) currentStep = explicitStep;
			}
			const session = data.turn === null;
			const turn = session ? undefined : explicitTurn ?? currentTurn;
			const step = session || event.type === "turn/start" || event.type === "turn/end" ? undefined : explicitStep ?? (turn === currentTurn ? currentStep : undefined);
			coordinates.set(event.seq, { ...(session ? { session: true as const } : {}), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }) });
			if (turn !== undefined) turnDraft(turn, event.seq);
			if (turn !== undefined && step !== undefined) stepDraft(turn, step, event.seq);
			if (event.type === "turn/start" && turn !== undefined) turnDraft(turn, event.seq).start = event;
			if (event.type === "turn/end" && turn !== undefined) turnDraft(turn, event.seq).end = event;
			if (event.type === "step/start" && turn !== undefined && step !== undefined) stepDraft(turn, step, event.seq).start = event;
			if (event.type === "step/end" && turn !== undefined && step !== undefined) stepDraft(turn, step, event.seq).end = event;
			if (event.type === "step/end" && currentTurn === turn && currentStep === step) currentStep = undefined;
			if (event.type === "turn/end" && currentTurn === turn) {
				currentTurn = undefined;
				currentStep = undefined;
			}
		}
		this.coordinates = coordinates;
		this.rebuildTimeline(turns);
		this.locations = new Map([...coordinates.keys()].map((seq) => [seq, this.resolve(seq)]));
	}

	setData(values: readonly { owner: string; data: { kind: "turn" | "step"; turn: number; step?: number; key: string; value: unknown } }[], scope?: "turn" | "step"): void {
		const turnData = scope === "step" ? this.turnData : new Map<number, Map<string, unknown>>();
		const stepData = scope === "turn" ? this.stepData : new Map<string, Map<string, unknown>>();
		if (scope === "turn") turnData.clear();
		if (scope === "step") stepData.clear();
		for (const { owner, data } of values) {
			const target = data.kind === "turn"
				? (turnData.get(data.turn) ?? new Map<string, unknown>())
				: (stepData.get(`${data.turn}:${data.step}`) ?? new Map<string, unknown>());
			if (target.has(data.key) && target.get(`__owner:${data.key}`) !== owner) throw new Error(`conversation Location data "${data.key}" is already owned`);
			target.set(data.key, data.value);
			target.set(`__owner:${data.key}`, owner);
			if (data.kind === "turn") turnData.set(data.turn, target);
			else if (data.step !== undefined) stepData.set(`${data.turn}:${data.step}`, target);
		}
		this.turnData = turnData;
		this.stepData = stepData;
	}

	snapshot(): ConversationTimelineSnapshot { return this.timeline; }
	locationOf(seq: number): ConversationLocation { return this.locations.get(seq) ?? SESSION_LOCATION; }

	private rebuildTimeline(drafts: Map<number, LocationDraft>): void {
		const turns = new Map<number, TurnLocation>();
		for (const draft of [...drafts.values()].sort((left, right) => left.firstSeq - right.firstSeq)) {
			const steps = [...draft.steps.values()].sort((left, right) => left.firstSeq - right.firstSeq).map((step): StepLocation => ({
				turn: step.turn,
				step: step.step,
				...(step.start ? { start: step.start } : {}),
				...(step.end ? { end: step.end } : {}),
				status: step.end ? "closed" : step.start ? "open" : "unknown",
				data: { get: (key) => this.stepData.get(`${step.turn}:${step.step}`)?.get(key) },
			}));
			turns.set(draft.turn, {
				turn: draft.turn,
				...(draft.start ? { start: draft.start } : {}),
				...(draft.end ? { end: draft.end } : {}),
				status: draft.end ? "closed" : draft.start ? "open" : "unknown",
				steps,
				data: { get: (key) => this.turnData.get(draft.turn)?.get(key) },
			});
		}
		const turnOrder = [...turns.keys()];
		this.timeline = { turnOrder, turns };
	}

	private resolve(seq: number): ConversationLocation {
		const coordinates = this.coordinates.get(seq);
		if (coordinates?.turn === undefined) return coordinates?.session ? SESSION_LOCATION : SESSION_LOCATION;
		const turn = this.timeline.turns.get(coordinates.turn);
		if (!turn) return UNRESOLVED_LOCATION;
		if (coordinates.step === undefined) return { kind: "turn", turn };
		const step = turn.steps.find((candidate) => candidate.step === coordinates.step);
		return step ? { kind: "step", turn, step } : { kind: "turn", turn };
	}
}

export class OpenBuddyConversationAssembler {
	private readonly contexts = new Map<string, InternalContext>();
	private readonly inputs = new Map<number, ConversationEvent>();
	private readonly snapshots = new Map<string, unknown>();
	private readonly views = new Map<string, { target: string; builder: ConversationViewBuilder; snapshot: unknown }>();
	private readonly locations = new LocationIndex();
	private hasMore = false;

	constructor(private readonly eventDefinitions: ConversationEventRegistryLike, private readonly viewDefinitions: ConversationViewRegistryLike) {
		this.resetViews();
	}

	replaceWindow(entries: readonly unknown[], hasMore = false): ConversationPublication {
		this.inputs.clear();
		this.contexts.clear();
		this.hasMore = hasMore;
		const events = entries.map((entry, index) => eventOf(entry, index)).sort((left, right) => left.seq - right.seq);
		for (const event of events) this.inputs.set(event.seq, event);
		this.rebuild(events);
		this.materialize(true);
		return "immediate";
	}

	append(entry: unknown): ConversationPublication {
		const nextSeq = this.inputs.size === 0 ? 0 : Math.max(...this.inputs.keys()) + 1;
		const event = eventOf(entry, nextSeq);
		if (this.inputs.has(event.seq)) return "none";
		this.inputs.set(event.seq, event);
		this.rebuild([...this.inputs.values()].sort((left, right) => left.seq - right.seq));
		this.materialize(false);
		return this.publicationFor(event);
	}

	prepend(entries: readonly unknown[], hasMore = false): ConversationPublication {
		const firstSeq = this.inputs.size === 0 ? 0 : Math.min(...this.inputs.keys());
		for (const [index, entry] of entries.entries()) {
			const event = eventOf(entry, firstSeq - entries.length + index);
			if (!this.inputs.has(event.seq)) this.inputs.set(event.seq, event);
		}
		this.hasMore = hasMore;
		this.rebuild([...this.inputs.values()].sort((left, right) => left.seq - right.seq));
		this.materialize(true);
		return "immediate";
	}

	rebuildRegistry(): ConversationPublication {
		this.resetViews();
		this.rebuild([...this.inputs.values()].sort((left, right) => left.seq - right.seq));
		this.materialize(true);
		return "immediate";
	}

	flush(): boolean { return true; }

	snapshot(target: string): ConversationTargetSnapshot | undefined {
		const value = this.snapshots.get(target);
		return value && typeof value === "object" && "order" in value && "nodes" in value ? value as ConversationTargetSnapshot : undefined;
	}

	snapshotValue(target: string): unknown { return this.snapshots.get(target); }

	snapshotsByTarget(): Readonly<Record<string, ConversationTargetSnapshot>> {
		return Object.freeze(Object.fromEntries([...this.snapshots].map(([target, value]) => [target, value as ConversationTargetSnapshot])));
	}

	getHasMore(): boolean { return this.hasMore; }

	timeline(): ConversationTimelineSnapshot { return this.locations.snapshot(); }

	private resetViews(): void {
		this.views.clear();
		this.snapshots.clear();
		const targets = new Set<string>();
		for (const entry of this.viewDefinitions.entries()) {
			targets.add(entry.target);
			const builder = entry.create?.() ?? defaultViewBuilder();
			this.views.set(entry.target, { target: entry.target, builder, snapshot: builder.empty });
		}
		for (const definition of this.eventDefinitions.entries()) if (definition.target && !targets.has(definition.target)) {
			const builder = defaultViewBuilder();
			this.views.set(definition.target, { target: definition.target, builder, snapshot: builder.empty });
		}
	}

	private rebuild(events: readonly ConversationEvent[]): void {
		this.locations.rebuild(events);
		this.contexts.clear();
		const definitions = this.eventDefinitions.entries();
		for (const event of events) {
			const matchedTargets = new Set<string>();
			for (const definition of definitions) {
				const result = definition.match(event);
				if (!result || !result.id) continue;
				if (definition.target) matchedTargets.add(definition.target);
				this.accept(definition, result.id, result.role, event);
			}
			const fallback = this.eventDefinitions.fallbackEntry?.();
			if (fallback?.target && !matchedTargets.has(fallback.target)) {
				const result = fallback.match(event);
				if (result?.id) this.accept(fallback, result.id, result.role, event);
			}
		}
	}

	private accept(definition: ConversationDefinition, id: string, role: "start" | "update", event: ConversationEvent): void {
		const key = contextKey(definition.kind, id);
		const match: ConversationMatch = { event, role, location: this.locations.locationOf(event.seq) };
		let context = this.contexts.get(key);
		if (!context) {
			context = { key, kind: definition.kind, id, definition, matches: [], state: undefined, current: new Map() };
			this.contexts.set(key, context);
		}
		if (role === "start" && context.start) throw new Error(`conversation Context ${key} received more than one start Match`);
		context.matches.push(match);
		if (role === "start") context.start = match;
		if (context.start) {
			context.state = this.startState(context);
		}
	}

	private startState(context: InternalContext): unknown {
		if (!context.start) return undefined;
		const state = context.definition.start(this.publicContext(context), context.start, {
			previous: <State>(kind: string) => this.previous<State>(kind, context.start!.event.seq),
		});
		if (state === undefined) throw new Error(`conversation Definition "${context.kind}" returned undefined from start()`);
		context.state = state;
		for (const match of context.matches.slice(1)) {
			const next = context.definition.update(this.publicContext(context), match);
			if (next === undefined) throw new Error(`conversation Definition "${context.kind}" returned undefined from update()`);
			context.state = next;
		}
		return context.state;
	}

	private previous<State>(kind: string, seq: number): ConversationPreviousContext<State> | undefined {
		let result: ConversationPreviousContext<State> | undefined;
		for (const context of this.contexts.values()) {
			if (context.kind !== kind || !context.start || context.start.event.seq >= seq || context.state === undefined) continue;
			if (!result || context.start.event.seq > result.startSeq) result = {
				key: context.key,
				kind: context.kind,
				id: context.id,
				startSeq: context.start.event.seq,
				state: context.state as State,
				matches: context.matches,
				windowGap: this.hasMore && !result,
			};
		}
		return result;
	}

	private publicContext(context: InternalContext): ConversationNodeContext<unknown> {
		if (!context.start) throw new Error(`conversation Context ${context.key} has no start Match`);
		return { key: context.key, kind: context.kind, id: context.id, matches: context.matches, start: context.start, state: context.state, current: context.current };
	}

	private materialize(replace: boolean): void {
		const locationData: Array<{ owner: string; data: { kind: "turn" | "step"; turn: number; step?: number; key: string; value: unknown } }> = [];
		for (const scope of ["step", "turn"] as const) {
			for (const context of this.contexts.values()) {
				if (context.state === undefined || !context.start || !context.definition.buildLocationData) continue;
				const value = context.definition.buildLocationData(this.publicContext(context), scope);
				if (!value) continue;
				if (value.kind !== scope || value.key !== context.kind || numberValue(value.turn) === undefined || (value.kind === "step" && numberValue(value.step) === undefined)) throw new Error(`conversation Definition "${context.kind}" returned invalid ${scope} Location data`);
				locationData.push({ owner: context.key, data: value });
			}
			this.locations.setData(locationData, scope);
		}
		const byTarget = new Map<string, ConversationViewNode[]>();
		for (const target of this.views.keys()) byTarget.set(target, []);
		for (const context of this.contexts.values()) {
			if (context.state === undefined || !context.start || !context.definition.target || !context.definition.buildViewNode || !byTarget.has(context.definition.target)) continue;
			const target = context.definition.target;
			const value = context.definition.buildViewNode(this.publicContext(context));
			if (value === null) continue;
			if (value.key !== context.key || value.target !== target) throw new Error(`conversation Definition "${context.kind}" returned an unstable view node`);
			context.current.set(target, value);
			byTarget.get(target)?.push(value);
		}
		for (const [target, view] of this.views) {
			const nodes = byTarget.get(target) ?? [];
			view.snapshot = replace
				? view.builder.replace({ nodes, timeline: this.locations.snapshot() })
				: view.builder.apply({ upserts: nodes, timeline: this.locations.snapshot() });
			this.snapshots.set(target, view.snapshot);
		}
	}

	private publicationFor(event: ConversationEvent): ConversationPublication {
		let publication: ConversationPublication = "none";
		for (const definition of this.eventDefinitions.entries()) {
			const result = definition.match(event);
			if (!result) continue;
			const match: ConversationMatch = { event, role: result.role, location: this.locations.locationOf(event.seq) };
			publication = maximumPublication(publication, definition.publication?.(match) ?? "immediate");
		}
		return publication === "none" ? "immediate" : publication;
	}
}
