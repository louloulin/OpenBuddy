/**
 * calendar-tools.ts — PI ToolDefinition factory for the calendar capability.
 *
 * Phase C.3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v17 §37.5):
 *   Apply the email-tools factory pattern to the calendar capability
 *   so the agent has first-class tool access to the calendar. The
 *   factory accepts a `CalendarToolHandlers` interface (defined here)
 *   so calendar-tools.ts has zero circular deps with index.ts.
 *
 * Architecture (mirrors email-tools.ts):
 *   - `toolResult` / `ToolArgs` / `objectSchema` helpers are local.
 *   - Tool definitions grouped by category so each is independently
 *     reviewable (READ / MUTATION).
 *   - `createCalendarToolDefinitions(handlers)` is a pure factory.
 *   - `createCalendarPiTools()` + `createCalendarReadOnlyPiTools()`
 *     in index.ts bind the live handlers and re-export the public API.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from electron/main/ and nothing from
 *   index.ts. The `CalendarToolHandlers` interface is local.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// ─── Helpers ────────────────────────────────────────────────────────

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
  };
}
type ToolArgs = Record<string, any>;
const objectSchema = { type: "object", additionalProperties: false };

/**
 * Minimal subset of the calendar service surface that the tool
 * factories consume. The local definition lets calendar-tools.ts load
 * without resolving index.ts (which has a side effect of `mountCalendar`
 * that depends on the Cordis context being alive).
 */
export interface CalendarToolHandlers {
  list(input?: unknown): Promise<unknown>;
  create(input: unknown): Promise<unknown>;
  update(id: string, patch: unknown): Promise<unknown>;
  updateInRoom(id: string, roomId: string, patch: unknown): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  removeInRoom(id: string, roomId: string): Promise<unknown>;
}

// ─── Tool categories ────────────────────────────────────────────────

/**
 * Read-only tools. Safe to expose in any read-only context.
 */
function buildReadOnlyTools(handlers: CalendarToolHandlers): ToolDefinition[] {
  return [
    {
      name: "calendar_list",
      label: "List calendar events",
      description: "列出指定时间范围 / 房间 / 上下文引用的日历事件。",
      parameters: {
        ...objectSchema,
        properties: {
          from: { type: "string", description: "ISO 起始时间（可选）" },
          to: { type: "string", description: "ISO 结束时间（可选）" },
          roomId: { type: "string", description: "按 roomId 过滤（可选）" },
          contextRef: { type: "string", description: "按 contextRef 过滤（可选）" },
        },
      } as ToolDefinition["parameters"],
      execute: async (_id, args: ToolArgs) => toolResult(await handlers.list(args ?? {})),
    },
  ];
}

/**
 * Mutation tools (create / update / remove). Each require user
 * confirmation in the underlying handler as appropriate.
 */
function buildMutationTools(handlers: CalendarToolHandlers): ToolDefinition[] {
  return [
    {
      name: "calendar_create",
      label: "Create calendar event",
      description: "创建日历事件；发送前需要用户确认。",
      parameters: {
        ...objectSchema,
        required: ["title", "start", "end"],
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "ISO 起始时间" },
          end: { type: "string", description: "ISO 结束时间" },
          timeZone: { type: "string" },
          allDay: { type: "boolean" },
          status: { type: "string", enum: ["confirmed", "tentative", "cancelled"] },
          roomId: { type: "string" },
          contextRefs: { type: "array", items: { type: "string" } },
          description: { type: "string" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
        },
      } as ToolDefinition["parameters"],
      execute: async (_id, args: ToolArgs) => toolResult(await handlers.create(args)),
    },
    {
      name: "calendar_update",
      label: "Update calendar event",
      description: "按 eventId 更新事件字段；需要用户确认。",
      parameters: {
        ...objectSchema,
        required: ["id"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          timeZone: { type: "string" },
          allDay: { type: "boolean" },
          status: { type: "string", enum: ["confirmed", "tentative", "cancelled"] },
          contextRefs: { type: "array", items: { type: "string" } },
          description: { type: "string" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
        },
      } as ToolDefinition["parameters"],
      execute: async (_id, args: ToolArgs) => {
        const id = String(args?.id ?? "");
        if (!id) throw new Error("calendar_update requires an id");
        const { id: _omit, ...patch } = args as { id: string } & ToolArgs;
        return toolResult(await handlers.update(id, patch));
      },
    },
    {
      name: "calendar_remove",
      label: "Remove calendar event",
      description: "按 eventId 删除事件；需要用户确认。",
      parameters: {
        ...objectSchema,
        required: ["id"],
        properties: { id: { type: "string" } },
      } as ToolDefinition["parameters"],
      execute: async (_id, args: ToolArgs) => toolResult(await handlers.remove(String(args?.id ?? ""))),
    },
  ];
}

/**
 * Phase C.3 — composes the two tool categories into a single flat
 * list. Mirrors email-tools.ts so the same pattern is used across
 * the two capabilities.
 */
export function createCalendarToolDefinitions(handlers: CalendarToolHandlers): ToolDefinition[] {
  return [
    ...buildReadOnlyTools(handlers),
    ...buildMutationTools(handlers),
  ];
}

/**
 * Phase C.3 — read-only subset. Currently a single tool but kept as
 * a separate factory for symmetry with email-tools.ts so future
 * read-only additions land in one place.
 */
export const CALENDAR_READ_ONLY_TOOL_NAMES = [
  "calendar_list",
] as const;

export function createReadOnlyCalendarToolDefinitions(handlers: CalendarToolHandlers): ToolDefinition[] {
  const names = new Set<string>(CALENDAR_READ_ONLY_TOOL_NAMES);
  return createCalendarToolDefinitions(handlers).filter((tool) => names.has(tool.name));
}