// Barrel: the per-command wrappers live in api/<module>.ts, grouped by the §5.3 host modules (20261115-md R5).
// Kept so every `@openbuddy/client/agent-client` importer and vi.mock path keeps working unchanged.
export type { ModelState } from "@openbuddy/protocol/dto";

export * from "./api/session";
export * from "./api/turn";
export * from "./api/model";
export * from "./api/providers";
export * from "./api/approvals";
export * from "./api/extensions";
export * from "./api/skills";
export * from "./api/mcp";
export * from "./api/notifications";
export * from "./api/artifacts";
export * from "./api/files";
export * from "./api/native";
export * from "./api/events";
export * from "./api/host";
export * from "./api/experts";
export * from "./api/memory";

// Appendix B: wrappers for commands the main-process contract does not implement (kept, not deleted).
export * from "./api/deferred/connectors";
export * from "./api/deferred/skills-catalog";
export * from "./api/deferred/experts";
export * from "./api/deferred/assistants";
export * from "./api/deferred/automations";
export * from "./api/deferred/marketplace";
export * from "./api/deferred/misc";

/** `memory_flush` is the only memory command left deferred (pii §3.3). */
export { memoryFlush } from "./api/deferred/memory-only";
