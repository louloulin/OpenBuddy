import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extract text from a PDF without starting a worker. The Electron main bundle
 * owns this Node-only reader; renderer code never imports pdfjs-dist.
 */
export async function extractPdfTextByPage(data: Uint8Array): Promise<string[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
  });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      pages.push(text);
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
