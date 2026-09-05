/**
 * pi-telemetry-span-tree.ts — append-only span-tree exporter.
 *
 * Stand-in for `@braintrust/pi-extension` / `@raindrop-ai/pi-agent` that
 * doesn't require any external SaaS account. Each span start/end event
 * coming through `OpenBuddyTelemetrySink` is mirrored as a structured
 * JSON line in `~/.pi/openbuddy/span-tree.jsonl` (or whatever path the
 * caller wires). Downstream tooling (Braintrust ingest CLI, Raindrop
 * collector, or a future pi-bridged SaaS adapter) can read the same
 * file offline.
 *
 * Defaults: OFF. Open only when `OPENBUDDY_SPAN_TREE_EXPORTER=1` is set,
 * mirroring the policy used by `pi-telemetry-bridge.ts`. This matches
 * the decision table note: "Braintrust tracing — let users opt-in;
 * default only console."
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import os from "node:os";
import type { OpenBuddyTelemetrySink, OpenBuddyTelemetrySinkEvent } from "./pi-telemetry-bridge";

export const SPAN_TREE_ENV_FLAG = "OPENBUDDY_SPAN_TREE_EXPORTER";

export interface CreateSpanTreeExporterOptions {
  /**
   * Path to the JSONL output file. Defaults to
   * `~/.pi/openbuddy/span-tree.jsonl`. The directory is created on
   * first write if it does not exist.
   */
  outputPath?: string;
}

function defaultSpanTreePath(): string {
  const home = process.env.PI_HOME ?? os.homedir();
  return join(home, ".pi", "openbuddy", "span-tree.jsonl");
}

/** Returns true when the user has opted into the span-tree exporter. */
export function isSpanTreeExporterActive(): boolean {
  return process.env[SPAN_TREE_ENV_FLAG] === "1";
}

interface SpanRecord {
  kind: "span.start" | "span.end" | "event";
  span?: string;
  level: "debug" | "info" | "warn" | "error";
  ts: number;
  props?: Record<string, unknown>;
}

/**
 * Build a sink that mirrors every event into a JSONL file in append
 * mode. Returns the underlying sink unchanged when the env flag is
 * unset so callers can wire this unconditionally without runtime
 * cost in the default configuration.
 */
export function createStdoutSpanExporter(
  inner: OpenBuddyTelemetrySink,
  options: CreateSpanTreeExporterOptions = {},
): OpenBuddyTelemetrySink {
  if (!isSpanTreeExporterActive()) return inner;
  const outputPath = options.outputPath ?? defaultSpanTreePath();
  let dirEnsured = false;
  // Serialize writes so the JSONL file preserves call order on disk;
  // concurrent appendFile races otherwise allow later events to land
  // before earlier ones on a busy sink.
  let writeChain: Promise<void> = Promise.resolve();
  const writeJsonLine = async (event: OpenBuddyTelemetrySinkEvent) => {
    const record: SpanRecord = event.name.endsWith(".span.start")
      ? { kind: "span.start", span: deriveSpanName(event), level: event.level, ts: event.ts ?? Date.now(), props: event.props }
      : event.name.endsWith(".span.end")
        ? { kind: "span.end", span: deriveSpanName(event), level: event.level, ts: event.ts ?? Date.now(), props: event.props }
        : { kind: "event", ts: event.ts ?? Date.now(), props: event.props, ...event };
    try {
      if (!dirEnsured) {
        await mkdir(dirname(outputPath), { recursive: true });
        dirEnsured = true;
      }
      await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // Telemetry export must never break the agent. Swallow.
    }
  };
  return (event) => {
    inner(event);
    writeChain = writeChain.then(() => writeJsonLine(event));
  };
}

function deriveSpanName(event: OpenBuddyTelemetrySinkEvent): string | undefined {
  const props = event.props as { span?: unknown } | undefined;
  return typeof props?.span === "string" ? props.span : undefined;
}

export const SPAN_TREE_KIND = "openbuddy.span-tree-exporter";
