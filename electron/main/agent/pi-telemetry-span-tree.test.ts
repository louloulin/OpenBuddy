import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SPAN_TREE_ENV_FLAG,
  SPAN_TREE_KIND,
  createStdoutSpanExporter,
  isSpanTreeExporterActive,
} from "./pi-telemetry-span-tree";
import type { OpenBuddyTelemetrySink, OpenBuddyTelemetrySinkEvent } from "./pi-telemetry-bridge";

const ORIGINAL_FLAG = process.env[SPAN_TREE_ENV_FLAG];

beforeEach(() => {
  process.env[SPAN_TREE_ENV_FLAG] = "1";
});

afterEach(async () => {
  if (ORIGINAL_FLAG === undefined) delete process.env[SPAN_TREE_ENV_FLAG];
  else process.env[SPAN_TREE_ENV_FLAG] = ORIGINAL_FLAG;
});

function makeRecordingSink() {
  const events: OpenBuddyTelemetrySinkEvent[] = [];
  const sink: OpenBuddyTelemetrySink = (event) => {
    events.push(event);
  };
  return { events, sink };
}

describe("isSpanTreeExporterActive", () => {
  it("reflects the env flag", () => {
    expect(isSpanTreeExporterActive()).toBe(true);
    process.env[SPAN_TREE_ENV_FLAG] = "0";
    expect(isSpanTreeExporterActive()).toBe(false);
  });
});

describe("createStdoutSpanExporter", () => {
  it("passes events through the inner sink and mirrors them to the JSONL file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "span-tree-"));
    try {
      const outputPath = join(dir, "nested", "span-tree.jsonl");
      const { events, sink } = makeRecordingSink();
      const exporter = createStdoutSpanExporter(sink, { outputPath });
      exporter({
        name: "pi.telemetry.span.start",
        level: "debug",
        props: { span: "harness.turn" },
        ts: 1_000,
      });
      exporter({
        name: "pi.telemetry.span.end",
        level: "info",
        props: { span: "harness.turn", status: "ok" },
        ts: 1_500,
      });
      exporter({
        name: "pi.telemetry.turn.end",
        level: "info",
        props: { sessionId: "abc" },
        ts: 1_600,
      });
      // Allow async writes to flush.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const inner = events.map((event) => event.name);
      expect(inner).toEqual([
        "pi.telemetry.span.start",
        "pi.telemetry.span.end",
        "pi.telemetry.turn.end",
      ]);
      const file = await readFile(outputPath, "utf8");
      const lines = file.trim().split("\n").map((line) => JSON.parse(line));
      // Debug surface for future regressions.
      if (lines.length !== 3) {
        throw new Error(`expected 3 lines, got ${lines.length}: ${file}`);
      }
      expect(lines[0]).toMatchObject({ kind: "span.start", span: "harness.turn" });
      expect(lines[1]).toMatchObject({ kind: "span.end", span: "harness.turn" });
      expect(lines[2].kind).toBe("event");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op identity passthrough when the env flag is off", async () => {
    process.env[SPAN_TREE_ENV_FLAG] = "0";
    const { events, sink } = makeRecordingSink();
    const exporter = createStdoutSpanExporter(sink);
    expect(exporter).toBe(sink);
    exporter({ name: "x", level: "info" });
    expect(events).toEqual([{ name: "x", level: "info" }]);
  });

  it("exposes a stable kind for audit", () => {
    expect(SPAN_TREE_KIND).toBe("openbuddy.span-tree-exporter");
  });
});
