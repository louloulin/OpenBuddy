// @vitest-environment node
// pii W5.5: knowledge sources persist in library.json (id = canonical folder path).
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryService } from "../src/library/library";
import { createSettings } from "../src/settings/settings";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-library-"));
  dirs.push(root);
  const settings = createSettings(root, { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
  const folder = join(root, "notes");
  mkdirSync(folder);
  return { root, settings, folder, library: new LibraryService(settings) };
}

describe("资料库知识源 (pii W5.5)", () => {
  it("adds a folder once, lists it and removes it", () => {
    const { folder, library, root, settings } = setup();
    const added = library.addFolder(folder);
    const real = realpathSync(folder);
    expect(added).toMatchObject({ kind: "folder", path: real });
    expect(added.id).toBe(real);
    // Adding the same folder again is idempotent.
    expect(library.addFolder(folder).id).toBe(real);
    expect(library.list()).toHaveLength(1);
    expect(library.path).toBe(join(settings.dir, "library.json"));

    // It survives a new service instance (a restart).
    const reopened = new LibraryService(createSettings(root, { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }));
    expect(reopened.list().map((source) => source.path)).toEqual([real]);

    reopened.remove(real);
    expect(reopened.list()).toEqual([]);
    expect(() => reopened.remove(real)).toThrow("library_source_not_found");
  });

  it("rejects a file and prunes a folder that disappeared", () => {
    const { root, folder, library } = setup();
    const file = join(root, "a.txt");
    writeFileSync(file, "x");
    expect(() => library.addFolder(file)).toThrow("library_not_a_folder");
    library.addFolder(folder);
    rmSync(folder, { recursive: true, force: true });
    expect(library.prune()).toEqual([]);
    expect(library.list()).toEqual([]);
  });
});
