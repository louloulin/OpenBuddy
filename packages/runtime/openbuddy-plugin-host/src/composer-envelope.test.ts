import { describe, expect, it } from "vitest";
import { createComposerEnvelope } from "./composer-envelope";

describe("composer envelope", () => {
  it("creates an immutable normalized prompt envelope", () => {
    const envelope = createComposerEnvelope({
      text: "  summarize this  ", workspaceId: "workspace-1", permissionMode: "approve",
      attachments: [{ id: "a1", name: "brief.md" }], references: [{ id: "r1", kind: "file", value: "brief.md" }],
    }, { envelopeId: "env-1", now: () => "2026-01-01T00:00:00.000Z" });
    expect(envelope).toMatchObject({ schemaVersion: 1, envelopeId: "env-1", text: "  summarize this  ", immutable: true, permissionMode: "approve" });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.attachments)).toBe(true);
    expect(envelope.references).toEqual([{ id: "r1", kind: "file", value: "brief.md" }]);
  });

  it("rejects empty text, invalid timestamps, and malformed references", () => {
    expect(() => createComposerEnvelope({ text: " " })).toThrow("text is required");
    expect(() => createComposerEnvelope({ text: "x", createdAt: "not-a-date" })).toThrow("createdAt");
    expect(() => createComposerEnvelope({ text: "x", references: [{ id: "", kind: "file", value: "x" }] })).toThrow("reference");
  });
});
