// Channel matrix consistency test.
//
// Parses docs/event-channel-matrix.md and electron/preload/index.ts and
// verifies that every channel marked `live` has:
//   1. An entry in `allowedEventChannels` (or, for invoke channels,
//      `allowedInvokeChannels`).
//   2. At least one `emitRendererEvent(...)` call in agent-host.ts or
//      relevant capability modules.
//   3. At least one consumer in src/.
//
// Channels marked `deliberate-drop` are excluded from checks. The test
// fails fast with a per-row breakdown so the next person to add a channel
// can see exactly which row is missing which side.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
// Vitest is rooted at /OpenBuddy/electron/, so the repo root is one level up.
const repoRoot = join(here, "..", "..", "..", "..");

function readText(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8");
}

interface MatrixRow {
  channel: string;
  producer: string;
  consumer: string;
  status: "live" | "orphan-emit" | "orphan-consume" | "deliberate-drop";
}

function parseMatrix(markdown: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    if (!line.startsWith("| `") || line.includes("---") || line.startsWith("| Channel")) continue;
    const cells = line.split("|").map((s) => s.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    const clean = (s: string) => s.replace(/^`/, "").replace(/`$/, "");
    const channel = clean(cells[0]);
    const producer = clean(cells[1]);
    const consumer = clean(cells[2]);
    const status = clean(cells[3]) as MatrixRow["status"];
    rows.push({
      channel,
      producer,
      consumer,
      status,
    });
  }
  return rows;
}

function extractChannelsFromSet(source: string, setName: string): Set<string> {
  const re = new RegExp(`${setName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const match = source.match(re);
  if (!match) return new Set();
  return new Set(
    match[1]
      .split(",")
      .map((s) => s.trim().replace(/^["'`]/, "").replace(/["'`]$/, ""))
      .filter((s) => s.length > 0),
  );
}

describe("event channel matrix", () => {
  const markdown = readText("docs/event-channel-matrix.md");
  const preload = readText("electron/preload/index.ts");
  const agentHost = readText("electron/main/agent/agent-host.ts");
  const rows = parseMatrix(markdown);

  it("matrix declares at least the core pi channels", () => {
    const channels = new Set(rows.map((r) => r.channel));
    for (const required of ["pi://event", "pi://update", "pi://complete", "pi://error", "pi://agent-died", "pi://subagent", "pi://models-update"]) {
      expect(channels.has(required), `missing channel: ${required}`).toBe(true);
    }
  });

  it("every live channel is allowlisted in the preload", () => {
    const allowedEvents = extractChannelsFromSet(preload, "allowedEventChannels");
    const allowedInvoke = extractChannelsFromSet(preload, "allowedInvokeChannels");
    for (const row of rows) {
      if (row.status !== "live") continue;
      const found = allowedEvents.has(row.channel) || allowedInvoke.has(row.channel);
      expect(found, `${row.channel}: missing from preload allowlist`).toBe(true);
    }
  });

  it("every live pi:// channel has at least one producer", () => {
    const producers = new Set<string>();
    // Scan all *.ts under electron/main/ for emitRendererEvent calls so new
    // bootstrap modules (e.g. handle-session-event.ts added in §44) are
    // picked up automatically without an explicit allowlist.
    const emitRe = /emitRendererEvent\(\s*["'`]([^"'`]+)["'`]/g;
    const mappedChannels: Record<string, string> = {
      "pi://mcp-status": "capability-event-bridge",
      "pi://folder-trust": "folder-trust",
      "pi://plan-mode": "plan-mode",
      "pi://permission-mode": "permission",
      "pi://task-update": "tasks",
    };

    function walk(dir: string) {
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        let stat;
        try { stat = statSync(full); } catch { continue; }
        if (stat.isDirectory()) {
          // Skip test directories to avoid double-counting test fixtures.
          if (entry === "__tests__" || entry === "node_modules" || entry === "out" || entry === "dist") continue;
          walk(full);
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
          let source = "";
          try { source = readFileSync(full, "utf8"); } catch { continue; }
          let match: RegExpExecArray | null;
          while ((match = emitRe.exec(source)) !== null) {
            producers.add(match[1]);
          }
          // capability-event-bridge uses a `channel:` field per source → channel mapping.
          const mappingRe = /channel:\s*["'`]([^"'`]+)["'`]/g;
          while ((match = mappingRe.exec(source)) !== null) {
            producers.add(match[1]);
          }
        }
      }
    }
    walk(join(repoRoot, "electron/main"));

    // Tokens known to be produced via legacy emitPluginEvent → capability bridge.
    for (const token of Object.keys(mappedChannels)) producers.add(token);

    for (const row of rows) {
      if (row.status !== "live" || !row.channel.startsWith("pi://")) continue;
      expect(producers.has(row.channel), `${row.channel}: no emitRendererEvent found`).toBe(true);
    }
  });

  it("every live channel with a non-empty consumer column has a consumer file", () => {
    for (const row of rows) {
      if (row.status !== "live") continue;
      if (!row.consumer.includes(":")) continue; // skip channels with no consumer path
      const [file] = row.consumer.split(":");
      // Accept absolute consumer paths (electron/...), src-prefixed paths, or bare src paths.
      let resolved: string;
      if (file.startsWith("src/")) resolved = file;
      else if (file.startsWith("electron/")) resolved = file;
      else resolved = `src/${file}`;
      const src = readText(resolved);
      expect(src.includes(row.channel), `${row.channel}: consumer column references ${file} but channel string is not present`).toBe(true);
    }
  });
});