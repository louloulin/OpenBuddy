export const EVENT_ENVELOPE_SCHEMA_VERSION = 1 as const;

export type EventEnvelopePayload = null | boolean | number | string | EventEnvelopePayload[] | {
	readonly [key: string]: EventEnvelopePayload;
};

export interface EventEnvelope<TPayload extends EventEnvelopePayload = EventEnvelopePayload> {
	readonly schemaVersion: typeof EVENT_ENVELOPE_SCHEMA_VERSION;
	readonly eventId: string;
	readonly taskId?: string;
	readonly sessionId?: string;
	readonly generation: number;
	readonly sequence: number;
	readonly timestamp: string;
	readonly kind: string;
	readonly payload: TPayload;
}

export interface EventEnvelopeInput<TPayload extends EventEnvelopePayload = EventEnvelopePayload> {
	eventId: string;
	taskId?: string;
	sessionId?: string;
	generation: number;
	sequence: number;
	timestamp: string;
	kind: string;
	payload: TPayload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen: Set<object> = new Set()): value is EventEnvelopePayload {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value as object);
	if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
	if (!isPlainObject(value)) return false;
	return Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new TypeError(`event envelope ${field} must be a non-empty string`);
	}
}

function requireCounter(value: unknown, field: string): asserts value is number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`event envelope ${field} must be a non-negative safe integer`);
	}
}

/**
 * Create the wire-safe event shape shared by Main, preload and renderer.
 * The returned object is detached from the input so callers cannot mutate an
 * already-issued event after it has entered a queue or audit log.
 */
export function createEventEnvelope<TPayload extends EventEnvelopePayload>(
	input: EventEnvelopeInput<TPayload>,
): EventEnvelope<TPayload> {
	validateEventEnvelopeInput(input);
	return Object.freeze({
		schemaVersion: EVENT_ENVELOPE_SCHEMA_VERSION,
		eventId: input.eventId,
		...(input.taskId === undefined ? {} : { taskId: input.taskId }),
		...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
		generation: input.generation,
		sequence: input.sequence,
		timestamp: input.timestamp,
		kind: input.kind,
		payload: input.payload,
	});
}

export function validateEventEnvelope(value: unknown): asserts value is EventEnvelope {
	if (!isPlainObject(value)) throw new TypeError("event envelope must be a plain object");
	const envelope = value as Record<string, unknown>;
	if (envelope.schemaVersion !== EVENT_ENVELOPE_SCHEMA_VERSION) throw new TypeError("event envelope schemaVersion is unsupported");
	validateEventEnvelopeInput(envelope as unknown as EventEnvelopeInput);
}

function validateEventEnvelopeInput(input: EventEnvelopeInput): void {
	requireNonEmpty(input.eventId, "eventId");
	if (input.taskId !== undefined) requireNonEmpty(input.taskId, "taskId");
	if (input.sessionId !== undefined) requireNonEmpty(input.sessionId, "sessionId");
	requireCounter(input.generation, "generation");
	requireCounter(input.sequence, "sequence");
	requireNonEmpty(input.timestamp, "timestamp");
	if (Number.isNaN(Date.parse(input.timestamp))) throw new TypeError("event envelope timestamp must be an ISO date");
	requireNonEmpty(input.kind, "kind");
	if (!isJsonValue(input.payload)) throw new TypeError("event envelope payload must be JSON-safe");
}
