/**
 * Bridge the typed `HostProcess` to the `@openbuddy/ui-session-search`
 * client interface.
 *
 * Lives in a runtime-specific file (not the UI package) so the UI package
 * stays host-runtime-agnostic and easy to use in tests/storybook.
 */
import {
  callSessionSearch,
  callSessionMessage,
  type SearchResult,
  type MessageResult,
} from "./capabilities.js";
import type { HostProcess } from "./host-process.js";

/**
 * Minimal session-search client interface — mirrors the one defined in
 * `@openbuddy/ui-session-search/src/client.ts`. Inlined here so we don't
 * create a hard dependency on the UI package's subpath (which has no
 * `index.ts` and tsc + vite-tsconfig-paths can't always resolve).
 *
 * Keep this in sync with the canonical definition; if you change one,
 * change both. (We accept the duplication in exchange for not having a
 * cross-package import in the runtime layer.)
 */
export interface SessionSearchClient {
  search(query: string, maxResults?: number): Promise<SearchResult>;
  message(sessionId: string, lineNo: number): Promise<MessageResult>;
}

/** Adapter from a HostProcess to the SessionSearchClient interface. */
export class HostRuntimeSearchClient implements SessionSearchClient {
  constructor(private readonly host: HostProcess) {}

  async search(query: string, maxResults?: number): Promise<SearchResult> {
    return callSessionSearch(this.host, maxResults !== undefined ? { query, maxResults } : { query });
  }

  async message(sessionId: string, lineNo: number): Promise<MessageResult> {
    return callSessionMessage(this.host, { sessionId, lineNo });
  }
}
