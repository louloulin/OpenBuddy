import type { buildNodes } from "@openbuddy/chat-core/turns";

/** Pixels from the bottom within which the transcript keeps following new content. */
export const STICK_THRESHOLD = 80;
/** Space kept above a just-sent prompt once it is scrolled to the top. */
export const ANCHOR_GAP = 16;
/** Long sessions mount the newest nodes first and older ones in chunks of this size while scrolling up. */
export const RENDER_WINDOW = 30;
/** Readable units in a message: a prompt, each paragraph of text, each step. */
export const charsOf = (m: { parts: Array<{ kind: string; text?: string }> }) => m.parts.reduce((n, p) => n + (p.text?.length ?? 0), 0);
export const blocksOf = (m: { role: string; parts: Array<{ kind: string; text?: string }> }) =>
  m.role === "user" ? 1 : m.parts.reduce((n, p) => n + (p.kind === "text" ? (p.text ?? "").split(/\n\s*\n/).filter((x) => x.trim()).length : 1), 0);
export const nodeIds = (node: ReturnType<typeof buildNodes>[number]) => (node.kind === "turn" ? node.messages.map((m) => m.id) : [node.message.id]);
