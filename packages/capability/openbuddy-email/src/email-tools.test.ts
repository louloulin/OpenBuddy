/**
 * email-tools.test.ts — Phase C.1 tests for the email tool factories.
 *
 * Verifies that extracting `createEmailToolDefinitions` from the
 * index.ts god module into email-tools.ts preserves the public API
 * and tool list (read + read-only subsets). Pre-C.1 the read-only
 * subset was a giant inline `.filter(...)` list — C.1 co-locates it
 * with the read-only tool definitions so adding a new read-only tool
 * only requires one edit.
 */

import { describe, expect, it } from "vitest";

import {
  createEmailToolDefinitions,
  createReadOnlyEmailToolDefinitions,
  EMAIL_READ_ONLY_TOOL_NAMES,
  type EmailToolHandlers,
} from "./email-tools";

function makeStubHandlers(): EmailToolHandlers {
  const stub: Record<string, (...args: unknown[]) => unknown> = {};
  // Generate a method for every name we know the factory calls. Each
  // returns a deterministic sentinel so the test can detect missing
  // wiring without exercising the full Cordis service.
  for (const name of [
    "accounts", "rules", "saveRule", "deleteRule", "runRule",
    "sync", "syncStates", "threads", "threadsPage", "replyZero",
    "triage", "thread", "drafts", "scheduledSends", "pendingSends",
    "prepareScheduleSend", "scheduleSend", "workspaceTags",
    "updateWorkspaceTags", "update", "setSenderPolicy", "shareThread",
    "createReminder", "moveToProject", "listAttachments",
    "downloadAttachment", "prepareProcessingPlan",
    "confirmProcessingPlan", "executeProcessingPlan",
    "cancelProcessingPlan", "createDraft", "prepareSend", "sendDraft",
    "saveAnalysis", "listAnalyses", "extractActionCandidates",
    "actionCenterQuery", "actionCenterCreateReminders",
    "projectContacts", "createRemindersFromAnalysis", "digest",
  ]) {
    stub[name] = () => ({ ok: true, name });
  }
  return stub as unknown as EmailToolHandlers;
}

describe("email-tools (Phase C.1)", () => {
  it("createEmailToolDefinitions returns the canonical 4-category tool set", () => {
    const tools = createEmailToolDefinitions(makeStubHandlers());
    const names = new Set(tools.map((tool) => tool.name));

    // Spot-check across the four categories — one tool per category
    // ensures buildReadOnly / buildMutation / buildCompose /
    // buildAnalysis all contribute.
    expect(names.has("email_list_accounts")).toBe(true); // READ_ONLY
    expect(names.has("email_update_thread")).toBe(true); // MUTATION
    expect(names.has("email_create_draft")).toBe(true); // COMPOSE
    expect(names.has("email_save_analysis")).toBe(true); // ANALYSIS
  });

  it("createReadOnlyEmailToolDefinitions is a strict subset of createEmailToolDefinitions", () => {
    const full = createEmailToolDefinitions(makeStubHandlers());
    const readonly = createReadOnlyEmailToolDefinitions(makeStubHandlers());

    const fullNames = new Set(full.map((tool) => tool.name));
    for (const tool of readonly) {
      expect(fullNames.has(tool.name)).toBe(true);
    }
    // Strict subset: at least one tool must be excluded.
    expect(readonly.length).toBeLessThan(full.length);
  });

  it("createReadOnlyEmailToolDefinitions matches EMAIL_READ_ONLY_TOOL_NAMES exactly", () => {
    const readonly = createReadOnlyEmailToolDefinitions(makeStubHandlers());
    const readonlyNames = readonly.map((tool) => tool.name).sort();
    const expected = [...EMAIL_READ_ONLY_TOOL_NAMES].sort();
    expect(readonlyNames).toEqual(expected);
  });

  it("EMAIL_READ_ONLY_TOOL_NAMES includes all 18 read-only tools", () => {
    // Pre-C.1 these were an inline `.includes(...)` list in
    // createEmailReadOnlyPiTools. C.1 makes the list a co-located
    // constant so adding a new read-only tool is a single edit.
    expect(EMAIL_READ_ONLY_TOOL_NAMES).toHaveLength(18);
    // Sanity-check: each name matches the email_* convention.
    for (const name of EMAIL_READ_ONLY_TOOL_NAMES) {
      expect(name).toMatch(/^email_[a-z_]+$/);
    }
  });

  it("the read-only subset excludes mutation-only tools (rules + processing plan + update)", () => {
    const readonly = createReadOnlyEmailToolDefinitions(makeStubHandlers());
    const readonlyNames = new Set(readonly.map((tool) => tool.name));

    // Mutating tools must NOT appear in the read-only subset.
    expect(readonlyNames.has("email_save_rule")).toBe(false);
    expect(readonlyNames.has("email_delete_rule")).toBe(false);
    expect(readonlyNames.has("email_update_thread")).toBe(false);
    expect(readonlyNames.has("email_set_sender_policy")).toBe(false);
    expect(readonlyNames.has("email_share_thread")).toBe(false);
    expect(readonlyNames.has("email_move_to_project")).toBe(false);
    expect(readonlyNames.has("email_download_attachment")).toBe(false);
    expect(readonlyNames.has("email_prepare_processing_plan")).toBe(false);
    expect(readonlyNames.has("email_confirm_processing_plan")).toBe(false);
    expect(readonlyNames.has("email_execute_processing_plan")).toBe(false);
    expect(readonlyNames.has("email_cancel_processing_plan")).toBe(false);
    expect(readonlyNames.has("email_create_draft")).toBe(false);
    expect(readonlyNames.has("email_prepare_schedule_send")).toBe(false);
    expect(readonlyNames.has("email_schedule_send")).toBe(false);
    expect(readonlyNames.has("email_prepare_send")).toBe(false);
    expect(readonlyNames.has("email_send_draft")).toBe(false);
  });
});