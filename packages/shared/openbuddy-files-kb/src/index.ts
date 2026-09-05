/**
 * @openbuddy/files-kb — Knowledge-base file utilities (pure logic).
 *
 * Aggregates pure-logic file utilities previously split between
 * `src/lib/files/` and consumed by both renderer (`src/components/panels/`)
 * and main process (`electron/main/agent/`).
 *
 * Domain map:
 *   - knowledge-base.ts      → KbEntry/KbProvider interface + registry
 *   - local-kb-provider.ts   → Local folder scanner (MD/TXT + OOXML)
 *   - zip-reader.ts          → Self-contained ZIP reader (STORE/DEFLATE)
 *   - doc-preview.ts         → OOXML text extraction (docx/pptx/xlsx)
 *
 * Platform-agnostic: no Electron, no Node-specific imports.
 */
export * from "./knowledge-base";
export * from "./local-kb-provider";
export * from "./zip-reader";
export * from "./doc-preview";
