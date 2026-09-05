export type HistoryPaginationEntry = {
	seq?: unknown;
	sequence?: unknown;
	type?: unknown;
	surface?: unknown;
	surfaceOp?: unknown;
	sourceEventSeqs?: unknown;
	message?: unknown;
	payload?: unknown;
	data?: unknown;
	[key: string]: unknown;
};

export const DEFAULT_HISTORY_MAX_MESSAGES = 50;

function sequenceOf(entry: HistoryPaginationEntry): number | undefined {
	const value = entry.seq ?? entry.sequence;
	return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function roleOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const role = (value as { role?: unknown }).role;
	return typeof role === "string" ? role : undefined;
}

function isMessageEntry(entry: HistoryPaginationEntry): boolean {
	if (entry.surface === "shadowed") return false;
	if (entry.surfaceOp && typeof entry.surfaceOp === "object" && !Array.isArray(entry.surfaceOp)
		&& (entry.surfaceOp as { op?: unknown }).op === "replace") return false;
	if (entry.type === "user/message" || entry.type === "assistant/message") return true;
	if (entry.type !== "message") return false;
	return roleOf(entry.message) === "user" || roleOf(entry.message) === "assistant"
		|| roleOf(entry.payload) === "user" || roleOf(entry.payload) === "assistant"
		|| roleOf(entry.data) === "user" || roleOf(entry.data) === "assistant";
}

function groupStartOf(entry: HistoryPaginationEntry, fallback: number): number {
	if (!Array.isArray(entry.sourceEventSeqs)) return fallback;
	const sources = entry.sourceEventSeqs.filter((value): value is number => Number.isSafeInteger(value) && value >= 0);
	return sources.length ? Math.min(fallback, ...sources) : fallback;
}

function legacyPage(entries: readonly HistoryPaginationEntry[], maxMessages: number): { entries: HistoryPaginationEntry[]; hasMore: boolean } {
	if (entries.length <= maxMessages) return { entries: [...entries], hasMore: false };
	return { entries: entries.slice(-maxMessages), hasMore: true };
}

export function paginateHistory(
	entries: readonly HistoryPaginationEntry[],
	beforeSeq?: number,
	maxMessages = DEFAULT_HISTORY_MAX_MESSAGES,
): { entries: HistoryPaginationEntry[]; hasMore: boolean } {
	const limit = Number.isSafeInteger(maxMessages) && maxMessages > 0 ? maxMessages : DEFAULT_HISTORY_MAX_MESSAGES;
	const window = beforeSeq === undefined
		? [...entries]
		: entries.filter((entry) => {
			const sequence = sequenceOf(entry);
			return sequence !== undefined && sequence < beforeSeq;
		});
	const messages = window
		.map((entry, index) => ({ entry, sequence: sequenceOf(entry), index }))
		.filter((value): value is { entry: HistoryPaginationEntry; sequence: number; index: number } => value.sequence !== undefined && isMessageEntry(value.entry));
	if (!messages.length) return legacyPage(window, limit);

	const selected = messages.slice(-limit);
	const cut = groupStartOf(selected[0].entry, selected[0].sequence);
	const page = window.filter((entry) => {
		const sequence = sequenceOf(entry);
		return sequence !== undefined && sequence >= cut;
	});
	const hasMore = messages.some((message) => message.sequence < cut);
	return { entries: page, hasMore };
}
