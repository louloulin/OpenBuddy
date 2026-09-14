import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentHostState } from "./_default-state";
import { installAgentPrompt, promptContent } from "./agent-prompt";

function createPdf(pages: string[]): Uint8Array {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...pages.flatMap((text, index) => {
      const page = 3 + index * 3;
      const font = page + 1;
      const content = page + 2;
      const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
        `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ];
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "binary"));
}

function installSession() {
  const state = createDefaultAgentHostState();
  const sendUserMessage = vi.fn(async () => undefined);
  state.session = { sessionId: "pdf-test-session", sendUserMessage } as any;
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

describe("agent prompt PDF routing", () => {
  it("inlines extracted text as one document block per PDF page", async () => {
    const { sendUserMessage } = installSession();
    const data = Buffer.from(createPdf(["First page", "Second page"])).toString("base64");

    await promptContent([
      { type: "text", text: "Summarize this PDF" },
      { type: "file", mediaType: "application/pdf", data, name: "report.pdf" },
    ]);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const [wireContent] = sendUserMessage.mock.calls[0] as unknown as [
      { type: "text"; text: string }[],
    ];
    expect(wireContent).toEqual([
      {
        type: "text",
        text: expect.stringContaining(
          '<document name="report.pdf" mediaType="application/pdf" page=1>',
        ),
      },
    ]);
    expect(wireContent[0].text).toContain("First page");
    expect(wireContent[0].text).toContain(
      '<document name="report.pdf" mediaType="application/pdf" page=2>',
    );
    expect(wireContent[0].text).toContain("Second page");
    expect(wireContent[0].text).not.toContain("<document-binary");
  });

  it("keeps a binary fallback when PDF extraction fails", async () => {
    const { sendUserMessage } = installSession();

    await promptContent([
      {
        type: "file",
        mediaType: "application/pdf",
        data: Buffer.from("not a PDF").toString("base64"),
        name: "broken.pdf",
      },
    ]);

    const [wireContent] = sendUserMessage.mock.calls[0] as unknown as [
      { type: "text"; text: string }[],
    ];
    expect(wireContent[0].text).toContain(
      '<document-binary name="broken.pdf" mediaType="application/pdf">',
    );
    expect(wireContent[0].text).toContain("PDF text extraction failed");
  });
});
