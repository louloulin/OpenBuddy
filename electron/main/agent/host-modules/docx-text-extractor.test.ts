import { describe, expect, it } from "vitest";
import {
  buildDocxZipForTest,
  extractDocxTextByParagraph,
} from "./docx-text-extractor";

describe("extractDocxTextByParagraph", () => {
  it("returns one entry per non-empty paragraph", async () => {
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
          <w:p><w:r><w:t>Second </w:t><w:t>paragraph</w:t></w:r></w:p>
          <w:p/>
          <w:p><w:r><w:t>Fourth</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const bytes = buildDocxZipForTest(xml);
    const pages = await extractDocxTextByParagraph(bytes);
    expect(pages).toEqual([
      { index: 0, text: "First paragraph" },
      { index: 1, text: "Second paragraph" },
      { index: 2, text: "Fourth" },
    ]);
  });

  it("decodes basic XML entities", async () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Tom &amp; Jerry &lt;3</w:t></w:r></w:p></w:body>
    </w:document>`;
    const bytes = buildDocxZipForTest(xml);
    const pages = await extractDocxTextByParagraph(bytes);
    expect(pages).toEqual([{ index: 0, text: "Tom & Jerry <3" }]);
  });

  it("throws when word/document.xml entry is missing", async () => {
    const name = Buffer.from("other.xml", "utf-8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(0, 18);
    localHeader.writeUInt32LE(0, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    await expect(extractDocxTextByParagraph(new Uint8Array(Buffer.concat([localHeader, name])))).rejects.toThrow(
      /word\/document\.xml not found/,
    );
  });

  it("throws when input is not a zip", async () => {
    await expect(extractDocxTextByParagraph(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
