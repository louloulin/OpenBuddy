import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentHostState } from "./_default-state";
import { installAgentPrompt, promptContent } from "./agent-prompt";
import { buildDocxZipForTest } from "./docx-text-extractor";

function installSession() {
  const state = createDefaultAgentHostState();
  const sendUserMessage = vi.fn(async () => undefined);
  state.session = { sessionId: "docx-test-session", sendUserMessage } as any;
  state.attachmentStore = { save: vi.fn() } as any;
  installAgentPrompt({
    state,
    emitPluginEvent: vi.fn(),
    emitRendererEvent: vi.fn(),
    publicQueueItems: () => [],
  });
  return { sendUserMessage };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent prompt docx routing", () => {
  it("inlines extracted paragraphs as one document block per paragraph", async () => {
    const { sendUserMessage } = installSession();
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
          <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const data = Buffer.from(buildDocxZipForTest(xml)).toString("base64");

    await promptContent([
      { type: "text", text: "Summarize this document" },
      {
        type: "file",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data,
        name: "note.docx",
      },
    ]);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const [wireContent] = sendUserMessage.mock.calls[0] as unknown as [
      { type: "text"; text: string }[],
    ];
    expect(wireContent).toEqual([
      {
        type: "text",
        text: expect.stringContaining('<document name="note.docx"'),
      },
    ]);
    expect(wireContent[0].text).toContain("First paragraph");
    expect(wireContent[0].text).toContain("Second paragraph");
    expect(wireContent[0].text).toContain('paragraph=1');
    expect(wireContent[0].text).toContain('paragraph=2');
    expect(wireContent[0].text).not.toContain("<document-binary");
  });

  it("falls back to document-binary when docx bytes are invalid", async () => {
    const { sendUserMessage } = installSession();

    await promptContent([
      {
        type: "file",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: Buffer.from("not a docx").toString("base64"),
        name: "broken.docx",
      },
    ]);

    const [wireContent] = sendUserMessage.mock.calls[0] as unknown as [
      { type: "text"; text: string }[],
    ];
    expect(wireContent[0].text).toContain(
      '<document-binary name="broken.docx"',
    );
    expect(wireContent[0].text).toContain("docx text extraction failed");
  });
});
