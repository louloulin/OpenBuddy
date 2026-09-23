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
  type SearchHit,
  type SearchResult,
  type MessageResult,
  type SessionSearchClient,
} from "@openbuddy/host-runtime";
import type { HostProcess } from "@openbuddy/host-runtime";

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
