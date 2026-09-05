import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultHarnessTokenPath, resolveHarnessAuthToken } from "./harness-token";

describe("Harness identity token", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("prefers an explicitly configured token", async () => {
		await expect(resolveHarnessAuthToken({ envToken: "configured-token-1234567890" })).resolves.toBe("configured-token-1234567890");
	});

	it("persists and reuses a local identity across server restarts", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-token-"));
		roots.push(root);
		const path = join(root, "identity", "token");
		const first = await resolveHarnessAuthToken({ path });
		const second = await resolveHarnessAuthToken({ path });
		expect(first).toBe(second);
		expect(await readFile(path, "utf8")).toBe(`${first}\n`);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it("replaces malformed persisted identities", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-harness-token-"));
		roots.push(root);
		const path = join(root, "token");
		writeFile(path, "not valid\n", "utf8");
		const token = await resolveHarnessAuthToken({ path });
		expect(token).toMatch(/^[A-Za-z0-9_-]{20,256}$/u);
		expect(await readFile(path, "utf8")).toBe(`${token}\n`);
	});

	it("derives the default identity path from Pi home", () => {
		expect(defaultHarnessTokenPath()).toMatch(/openbuddy-harness-token$/u);
	});
});
