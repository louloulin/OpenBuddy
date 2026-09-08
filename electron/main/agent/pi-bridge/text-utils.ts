/**
 * pi-bridge/text-utils.ts — thin IPC shim around pi's pure text utilities.
 *
 * Wraps the Node-only pi-coding-agent text helpers so the renderer can reach
 * them via IPC instead of importing the Node bundle directly (pi-coding-agent
 * pulls in photon-node WASM and shell-quote transitive deps that are
 * inappropriate for the renderer bundle).
 *
 * Phase A.1 of OPENBUDDY_PI_NATIVE_PLAN.md.
 */
import { parseFrontmatter as piParseFrontmatter, stripFrontmatter as piStripFrontmatter } from "@earendil-works/pi-coding-agent";
import { generateDiffString as piGenerateDiffString, generateUnifiedPatch as piGenerateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import {
  truncateHead as piTruncateHead,
  truncateTail as piTruncateTail,
  truncateLine as piTruncateLine,
  formatSize as piFormatSize,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";

export interface TruncateOptions {
  maxLines?: number;
  maxBytes?: number;
}

/** Parse a markdown file with YAML frontmatter into typed meta + body. */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
  content: string,
): { frontmatter: T; body: string } {
  return piParseFrontmatter<T>(content);
}

/** Strip the frontmatter block, preserving only the body markdown. */
export function stripFrontmatter(content: string): string {
  return piStripFrontmatter(content);
}

/** Truncate the head (keeps the first N lines from the top). Returns truncated string. */
export function truncateHead(content: string, opts?: TruncateOptions): string {
  const result: TruncationResult = piTruncateHead(content, opts);
  return result.content;
}

/** Truncate the tail (keeps the last N lines). Returns truncated string. */
export function truncateTail(content: string, opts?: TruncateOptions): string {
  const result: TruncationResult = piTruncateTail(content, opts);
  return result.content;
}

/** Truncate a single line to maxChars (used for grep match lines). */
export function truncateLine(line: string, maxChars?: number): string {
  const result = piTruncateLine(line, maxChars);
  return result.text;
}

/** Generate a display-oriented diff string with line numbers and context. */
export function generateDiffString(
  oldStr: string,
  newStr: string,
  contextLines?: number,
): { diff: string; firstChangedLine: number | undefined } {
  return piGenerateDiffString(oldStr, newStr, contextLines);
}

/** Generate a standard unified patch. */
export function generateUnifiedPatch(
  path: string,
  oldStr: string,
  newStr: string,
  contextLines?: number,
): string {
  return piGenerateUnifiedPatch(path, oldStr, newStr, contextLines);
}

/** Re-export the size formatter for renderer convenience. */
export function formatSize(bytes: number): string {
  return piFormatSize(bytes);
}