/**
 * P2-13: thin re-export facade.
 *
 * The original 2,139-line monolith was split into domain sub-modules under
 * `./pi-resources/`:
 *   - `shared.ts`        — helpers (agentRoot, readJson, within, safeName, …)
 *   - `skills.ts`        — skills + workspace instructions + slash commands
 *   - `mcp.ts`           — MCP server config + auth
 *   - `agents.ts`        — agents + presets + expert catalog + image
 *   - `marketplace.ts`   — plugin registry + pi.dev remote catalog + install
 *   - `memory.ts`        — memory + session search/fork/rewind (SessionManager)
 *   - `config.ts`        — app config + KB citation
 *
 * All 17 existing `import * as resources from "../pi-resources"` consumers
 * keep working unchanged. Future work (out of scope for this commit) can
 * migrate heavy-few consumers to subpath imports (`./pi-resources/marketplace`,
 * `./pi-resources/memory`) so the SessionManager NAPI binding and the
 * marketplace HTML parser drop out of the cold-start entry chunk.
 */
export * from "./pi-resources/shared";
export * from "./pi-resources/skills";
export * from "./pi-resources/mcp";
export * from "./pi-resources/agents";
export * from "./pi-resources/marketplace";
export * from "./pi-resources/memory";
export * from "./pi-resources/config";
