/**
 * pdfjs-dist 懒加载器 —— office1 §9 PDF 专项(v2)。
 *
 * 最佳实践(2026,见 office1.md §9.3):
 * - 绝不使用 CDN worker(离线/CSP 风险),用 Vite `?url` 把
 *   `pdf.worker.min.mjs` 打成带 hash 的本地资产,electron-vite 的
 *   file:// 生产构建下也能稳定解析。
 * - 懒加载:只有真正遇到 PDF 附件时才 dynamic import,主包零增量。
 * - workerSrc 必须在同一个模块里设置,避免模块执行顺序覆盖。
 * - pdfjs-dist v6 为纯 ESM,要求 Node >= 22.13(本仓库 Node 24 满足)。
 */
import type * as PdfjsNS from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let cached: Promise<typeof PdfjsNS> | null = null;

/** 懒加载 pdfjs-dist 并配置本地 worker。多次调用返回同一 Promise。 */
export function loadPdfJs(): Promise<typeof PdfjsNS> {
  if (!cached) {
    cached = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
  }
  return cached;
}
