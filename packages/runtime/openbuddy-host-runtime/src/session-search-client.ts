/**
 * Bridge the typed `HostProcess` to a session-search client interface.
 *
 * Lives in the runtime layer so transport/adapter code stays out of the
 * UI packages entirely.
 */
import {
  callSessionSearch,
  callSessionMessage,
  type SearchResult,
  type MessageResult,
} from "./capabilities.js";
import type { HostProcess } from "./host-process.js";

/**
 * Minimal session-search client interface, defined here rather than in a
 * UI package so the runtime layer owns no cross-package dependency.
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
