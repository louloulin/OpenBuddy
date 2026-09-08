/**
 * src/lib/agent/pi-bridge-client.ts — typed renderer client for the pi-bridge IPC.
 *
 * Phase A.1 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. The renderer never imports
 * the Node-only pi-coding-agent bundle directly; instead it talks to the
 * thin IPC shim implemented in electron/main/agent/pi-bridge/.
 *
 * Channel naming: `pi-bridge:<domain>:<verb>`. The preload bridge exposes
 * them under `window.pi.text / .image / .skills`.
 */

declare global {
  interface Window {
    api: {
      pi: PiBridgeClient;
    };
  }
}

/** Minimal shape of a Skill record as pi-coding-agent emits. */
export interface PiSkillRecord {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo?: { kind: string; path?: string };
  disableModelInvocation?: boolean;
  [key: string]: unknown;
}

export interface ParseFrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface LoadSkillsPayload {
  skills: PiSkillRecord[];
  diagnostics: Array<{ severity: string; message: string }>;
}

export interface ResizeImagePayload {
  /** base64-encoded output bytes. */
  data: string;
  /** Output mime type. */
  mimeType: string;
  /** Original dimensions (pre-resize). */
  originalWidth?: number;
  originalHeight?: number;
  /** Output dimensions (post-resize). */
  width?: number;
  height?: number;
  /** True when the image was actually resized. */
  wasResized?: boolean;
  /** Optional dimension note string for LLM consumption. */
  note?: string;
}

export interface PiBridgeTextApi {
  parseFrontmatter(content: string): Promise<ParseFrontmatterResult>;
  stripFrontmatter(content: string): Promise<string>;
  truncateHead(content: string, opts?: { maxLines?: number; maxBytes?: number }): Promise<string>;
  truncateTail(content: string, opts?: { maxLines?: number; maxBytes?: number }): Promise<string>;
  truncateLine(content: string, opts?: { maxLines?: number; maxBytes?: number }): Promise<string>;
  generateDiff(oldStr: string, newStr: string, opts?: { filePath?: string; context?: number }): Promise<string>;
  generatePatch(oldStr: string, newStr: string, opts?: { filePath?: string; context?: number }): Promise<string>;
}

export interface PiBridgeImageApi {
  detectMime(filePath: string): Promise<string | null>;
  resize(
    bytes: Uint8Array,
    mimeType: string,
    opts?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number },
  ): Promise<ResizeImagePayload | null>;
  resizeFile(
    filePath: string,
    opts?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number },
  ): Promise<ResizeImagePayload | null>;
  convertToPng(base64Data: string, mimeType: string): Promise<{ data: string; mimeType: string } | null>;
}

export interface PiBridgeSkillsApi {
  load(opts?: { cwd?: string; agentDir?: string; skillPaths?: string[]; includeDefaults?: boolean }): Promise<LoadSkillsPayload>;
  loadFromDir(dir: string, source: string): Promise<LoadSkillsPayload>;
  formatForPrompt(skills: PiSkillRecord[], fileReadTool?: "read" | "bash"): Promise<string>;
}

export interface PiBridgeClient {
  text: PiBridgeTextApi;
  image: PiBridgeImageApi;
  skills: PiBridgeSkillsApi;
}

/** Lazy singleton accessor — `window.api.pi` may be undefined in tests. */
export function getPiBridge(): PiBridgeClient | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { api?: { pi?: PiBridgeClient } }).api;
  return api?.pi ?? null;
}

/** Stronger accessor that throws when the bridge is missing. Use in app code. */
export function requirePiBridge(): PiBridgeClient {
  const bridge = getPiBridge();
  if (!bridge) {
    throw new Error("pi-bridge is not available — preload bridge missing window.api.pi");
  }
  return bridge;
}