import {
	createEventEnvelope,
	type EventEnvelope,
	type EventEnvelopePayload,
} from "./event-envelope";

export interface EventBridgeOptions {
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly generation?: number;
	readonly now?: () => string;
	readonly id?: () => string;
}

/**
 * Main-process event adapter shared by the Electron boundary and preload.
 * Sequence numbers are monotonic for the lifetime of the adapter; generation
 * changes invalidate old renderer subscriptions without changing event shape.
 */
export class EventEnvelopeBridge {
	private sequence = 0;
	private generation: number;
	private readonly options: EventBridgeOptions;

	constructor(options: EventBridgeOptions = {}) {
		this.options = options;
		this.generation = options.generation ?? 0;
	}

	setGeneration(generation: number): void {
		if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError("generation must be a non-negative safe integer");
		this.generation = generation;
	}

	getGeneration(): number { return this.generation; }

	emit<TPayload extends EventEnvelopePayload>(kind: string, payload: TPayload, options: Pick<EventBridgeOptions, "sessionId" | "taskId"> = {}): EventEnvelope<TPayload> {
		const sequence = this.sequence++;
		const id = this.options.id ?? (() => `evt-${this.generation}-${sequence}`);
		return createEventEnvelope({
			eventId: id(),
			...(options.taskId ?? this.options.taskId ? { taskId: options.taskId ?? this.options.taskId } : {}),
			...(options.sessionId ?? this.options.sessionId ? { sessionId: options.sessionId ?? this.options.sessionId } : {}),
			generation: this.generation,
			sequence,
			timestamp: (this.options.now ?? (() => new Date().toISOString()))(),
			kind,
			payload,
		});
	}
}

export function isCurrentEventGeneration(event: Pick<EventEnvelope, "generation">, generation: number): boolean {
	return event.generation === generation;
}
