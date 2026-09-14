import { describe, expect, it } from "vitest";
import { extractPdfTextByPage } from "./pdf-text-extractor";

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

describe("extractPdfTextByPage", () => {
  it("extracts text from every PDF page in order", async () => {
    await expect(extractPdfTextByPage(createPdf(["Hello PDF", "Second page"]))).resolves.toEqual([
      "Hello PDF",
      "Second page",
    ]);
  });

  it("rejects invalid PDF bytes instead of returning an opaque placeholder", async () => {
    await expect(extractPdfTextByPage(new Uint8Array(Buffer.from("not a pdf")))).rejects.toThrow();
  });
});
