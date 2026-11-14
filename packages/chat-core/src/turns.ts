import type { ChatMessage, MessagePart, ToolCallView } from "./transcript";

/** One row of the transcript: a user prompt, the assistant turn answering it, or a divider. */
export type ChatNode =
  | { kind: "user"; key: string; message: ChatMessage }
  | { kind: "turn"; key: string; messages: ChatMessage[]; user?: ChatMessage }
  | { kind: "notice"; key: string; message: ChatMessage };

/** Group consecutive assistant messages into one turn per user prompt. */
export function buildNodes(messages: ChatMessage[]): ChatNode[] {
  const nodes: ChatNode[] = [];
  let user: ChatMessage | undefined;
  let turn: Extract<ChatNode, { kind: "turn" }> | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      user = message;
      turn = undefined;
      nodes.push({ kind: "user", key: message.id, message });
    } else if (message.role === "notice") {
      turn = undefined;
      nodes.push({ kind: "notice", key: message.id, message });
    } else if (turn) {
      turn.messages.push(message);
    } else {
      turn = { kind: "turn", key: message.id, messages: [message], user };
      nodes.push(turn);
    }
  }
  return nodes;
}

export interface ProcessItem { part: MessagePart; key: string }
export interface TurnContent {
  /** Thinking, tool calls and interim text before the final answer. */
  process: ProcessItem[];
  /** Final answer text (after the last tool call). */
  answer: string;
  tools: ToolCallView[];
}

export function splitTurn(messages: ChatMessage[]): TurnContent {
  const items: ProcessItem[] = messages.flatMap((message) => message.parts.map((part, i) => ({ part, key: `${message.id}:${part.contentIndex ?? i}` })));
  const lastTool = items.map((item) => item.part.kind).lastIndexOf("tool_call");
  const tail = items.slice(lastTool + 1);
  const answerItems = tail.filter((item) => item.part.kind === "text");
  const process = [...items.slice(0, lastTool + 1), ...tail.filter((item) => item.part.kind !== "text")];
  const tools = items.flatMap((item) => (item.part.kind === "tool_call" ? [item.part.toolCall] : []));
  return {
    process,
    answer: answerItems.map((item) => (item.part.kind === "text" ? item.part.text : "")).filter(Boolean).join("\n\n"),
    tools,
  };
}

/** Start/end of a turn: user prompt time → last finished message. */
export function turnTiming(messages: ChatMessage[], user?: ChatMessage): { start?: number; end?: number } {
  const start = user?.meta?.timestamp ?? messages[0]?.meta?.timestamp;
  let end: number | undefined;
  for (const message of messages) {
    const at = message.meta?.endedAt ?? message.meta?.timestamp;
    if (at && (!end || at > end)) end = at;
  }
  return { start, end };
}

export function turnModel(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].meta?.model) return messages[i].meta!.model;
  return undefined;
}

export function turnError(messages: ChatMessage[]): { stopReason?: string; errorMessage?: string } {
  const last = messages.at(-1);
  return { stopReason: last?.meta?.stopReason, errorMessage: last?.meta?.errorMessage };
}

/** Markdown export of a turn (answer plus thinking as details). */
export function turnMarkdown(messages: ChatMessage[]): string {
  return messages
    .flatMap((message) => message.parts)
    .map((part) => (part.kind === "text" ? part.text : part.kind === "thought" ? `<details>\n<summary>思考过程</summary>\n\n${part.text}\n\n</details>` : ""))
    .filter(Boolean)
    .join("\n\n");
}
