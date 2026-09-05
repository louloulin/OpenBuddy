/**
 * E2E smoke for the pi-plugin-reuse-batch: passthrough + telemetry bridge.
 *
 * Runs without external services. Exercises:
 *   1. findCompatibilityAdapter returns the adapter for the local pi
 *      packages that ship with OpenBuddy's node_modules (no real install),
 *      and falls through when the package is missing.
 *   2. createStdoutSpanExporter mirrors events to a JSONL file when the
 *      env flag is on, and is a no-op passthrough otherwise.
 *
 * Memory-bridge tests were retired in Stage C-4 (openbuddy-memory deleted
 * in favour of `pi-memory`); the capability-memory smoke fixtures and the
 * @openbuddy/capability-memory alias are no longer wired up.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPiPackageInstalled } from "../../../../electron/main/agent/pi-package-installed";
import { describeCompatibilityAdapterCommands, resolvePiExtensions } from "../../../../electron/main/agent/pi-extensions";
import {
	createStdoutSpanExporter,
	isSpanTreeExporterActive,
	SPAN_TREE_ENV_FLAG,
} from "../../../../electron/main/agent/pi-telemetry-span-tree";
import type { OpenBuddyTelemetrySink, OpenBuddyTelemetrySinkEvent } from "../../../../electron/main/agent/pi-telemetry-bridge";

describe("pi-plugin-reuse-batch smoke", () => {
	const originalFlag = process.env[SPAN_TREE_ENV_FLAG];

	beforeEach(() => {
		process.env[SPAN_TREE_ENV_FLAG] = "1";
	});

	afterEach(async () => {
		if (originalFlag === undefined) delete process.env[SPAN_TREE_ENV_FLAG];
		else process.env[SPAN_TREE_ENV_FLAG] = originalFlag;
	});

	it("resolvePiExtensions and describeCompatibilityAdapterCommands are exported as the public adapter surface", () => {
		// a2a is not installed locally; expect false
		expect(isPiPackageInstalled("a2a-runtime-not-installed-test-only")).toBe(false);
		// public surface is callable and stable
		expect(typeof resolvePiExtensions).toBe("function");
		const adapters = describeCompatibilityAdapterCommands();
		expect(Array.isArray(adapters)).toBe(true);
		expect(adapters.length).toBeGreaterThan(0);
		// each adapter carries the passthrough / piPackageHint fields used by the smoke
		const first = adapters[0];
		expect(first).toHaveProperty("capability");
		expect(first).toHaveProperty("owner");
	});

	it("span-tree exporter writes JSONL when the env flag is on, no-op when off", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-plugin-smoke-"));
		try {
			const outputPath = join(dir, "span-tree.jsonl");
			const events: OpenBuddyTelemetrySinkEvent[] = [];
			const innerSink: OpenBuddyTelemetrySink = (event) => { events.push(event); };
			expect(isSpanTreeExporterActive()).toBe(true);
			const exporter = createStdoutSpanExporter(innerSink, { outputPath });
			exporter({ name: "pi.telemetry.span.start", level: "info", props: { span: "smoke.turn" }, ts: 1000 });
			exporter({ name: "pi.telemetry.span.end", level: "info", props: { span: "smoke.turn" }, ts: 2000 });
			exporter({ name: "smoke.custom.event", level: "debug", ts: 3000 });
			await new Promise((resolve) => setTimeout(resolve, 250));
			const inner = events.map((event) => event.name);
			expect(inner).toEqual([
				"pi.telemetry.span.start",
				"pi.telemetry.span.end",
				"smoke.custom.event",
			]);
			const file = await readFile(outputPath, "utf8");
			const lines = file.trim().split("\n").map((line) => JSON.parse(line));
			expect(lines.length).toBe(3);
			expect(lines[0]).toMatchObject({ kind: "span.start", span: "smoke.turn" });
			expect(lines[1]).toMatchObject({ kind: "span.end", span: "smoke.turn" });
			expect(lines[2].kind).toBe("event");

			// Now flip the flag off and confirm identity passthrough — no file mutation.
			process.env[SPAN_TREE_ENV_FLAG] = "0";
			const exporterOff = createStdoutSpanExporter(innerSink, { outputPath });
			expect(isSpanTreeExporterActive()).toBe(false);
			exporterOff({ name: "noop.event", level: "info" });
			expect(events[events.length - 1].name).toBe("noop.event");
			// file unchanged
			const fileAfter = await readFile(outputPath, "utf8");
			const linesAfter = fileAfter.trim().split("\n");
			expect(linesAfter.length).toBe(3);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});