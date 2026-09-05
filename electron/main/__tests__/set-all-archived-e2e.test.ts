/**
 * R2.5 — bulk archive/unarchive for the Sidebar's 恢复全部 action.
 *
 * Mirrors the production logic in agent-host.ts::setAllArchived so we can
 * verify the JSON state file is updated correctly without standing up the
 * full agent host (which requires Electron).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

interface StateFile {
  pinned: string[];
  archived: string[];
  experts: Record<string, { expertId: string; expertName: string; avatarLocal?: string }>;
}

async function productionSetAllArchived(
  stateFile: string,
  knownIds: string[],
  archived: boolean,
): Promise<{ updated: number }> {
  let metadata: StateFile = { pinned: [], archived: [], experts: {} };
  try { metadata = JSON.parse(await readFile(stateFile, "utf8")); } catch { /* first run */ }
  const normalized: StateFile = {
    pinned: metadata.pinned ?? [],
    archived: metadata.archived ?? [],
    experts: metadata.experts ?? {},
  };
  const beforeSet = new Set(normalized.archived);
  const result = { updated: 0 };
  if (archived) {
    let count = 0;
    for (const id of knownIds) if (!beforeSet.has(id)) count += 1;
    result.updated = count;
    normalized.archived = Array.from(new Set([...beforeSet, ...knownIds]));
  } else {
    let count = 0;
    for (const id of beforeSet) if (knownIds.includes(id)) count += 1;
    result.updated = count;
    normalized.archived = [];
  }
  await writeFile(stateFile, JSON.stringify(normalized, null, 2));
  return result;
}

describe("setAllArchived (R2.5)", () => {
  let tempDir: string;
  let stateFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-bulk-archive-"));
    stateFile = join(tempDir, "openbuddy-state.json");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("unarchive clears every known archived id in a single write", async () => {
    await writeFile(stateFile, JSON.stringify({
      pinned: ["p1"],
      archived: ["a", "b", "c", "missing"],
      experts: { "a": { expertId: "x", expertName: "X" } },
    }, null, 2));

    const result = await productionSetAllArchived(stateFile, ["a", "b", "c", "d"], false);
    expect(result.updated).toBe(3); // a, b, c — "missing" is unknown

    const after = JSON.parse(await readFile(stateFile, "utf8"));
    expect(after.archived).toEqual([]);
    // Pinned + experts are preserved.
    expect(after.pinned).toEqual(["p1"]);
    expect(after.experts).toEqual({ "a": { expertId: "x", expertName: "X" } });
  });

  test("archive adds every known id that wasn't already archived", async () => {
    await writeFile(stateFile, JSON.stringify({
      pinned: [],
      archived: ["b"],
      experts: {},
    }, null, 2));

    const result = await productionSetAllArchived(stateFile, ["a", "b", "c"], true);
    expect(result.updated).toBe(2); // a, c — b was already archived

    const after = JSON.parse(await readFile(stateFile, "utf8"));
    expect(new Set(after.archived)).toEqual(new Set(["a", "b", "c"]));
  });

  test("bulk restore is idempotent (restoring twice yields the same result)", async () => {
    await writeFile(stateFile, JSON.stringify({
      pinned: [],
      archived: ["a", "b"],
      experts: {},
    }, null, 2));

    await productionSetAllArchived(stateFile, ["a", "b"], false);
    const second = await productionSetAllArchived(stateFile, ["a", "b"], false);
    expect(second.updated).toBe(0);

    const after = JSON.parse(await readFile(stateFile, "utf8"));
    expect(after.archived).toEqual([]);
  });

  test("bulk restore on empty archive list is a no-op", async () => {
    await writeFile(stateFile, JSON.stringify({ pinned: [], archived: [], experts: {} }, null, 2));
    const result = await productionSetAllArchived(stateFile, ["a", "b"], false);
    expect(result.updated).toBe(0);
    const after = JSON.parse(await readFile(stateFile, "utf8"));
    expect(after.archived).toEqual([]);
  });
});
