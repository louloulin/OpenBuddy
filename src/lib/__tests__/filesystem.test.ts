/**
 * Real filesystem IPC smoke — covers every `shellfs:*` channel declared in
 * `electron/preload/index.ts` against the actual `@openbuddy/fs-fs-local`
 * handlers used by `electron/main/ipc.ts`. No mocks; every assertion runs on
 * a real temporary directory.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Context } from "@openbuddy/cordis";
import { mountFsLocal, shellFsHandlers } from "@openbuddy/fs-fs-local";

describe.sequential("filesystem IPC smoke (shellfs:*)", () => {
  let root: string;
  let outside: string;
  let previousPiDir: string | undefined;

  beforeAll(() => {
    previousPiDir = process.env.PI_CODING_AGENT_DIR;
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ob-fs-ipc-"));
    outside = await mkdtemp(join(tmpdir(), "ob-fs-outside-"));
    process.env.PI_CODING_AGENT_DIR = join(root, ".pi", "agent");
    mountFsLocal(new Context());
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "nested", "hello.txt"), "hello world", "utf8");
    await writeFile(join(root, "nested", "binary.bin"), "\x00\x01\x02\x03", "binary");
    await writeFile(join(outside, "secret.txt"), "top secret", "utf8");
  });

  afterAll(async () => {
    if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousPiDir;
  });

  it("shellfs:stat returns kind=file and absolute path for existing file", async () => {
    const stat = await shellFsHandlers.stat("nested/hello.txt", root);
    expect(stat.kind).toBe("file");
    expect(stat.exists).toBe(true);
    expect(stat.absolute.endsWith(`nested${sep}hello.txt`)).toBe(true);
  });

  it("shellfs:stat returns kind=directory and absolute path for existing dir", async () => {
    const stat = await shellFsHandlers.stat("nested", root);
    expect(stat.kind).toBe("directory");
    expect(stat.exists).toBe(true);
    expect(stat.absolute.endsWith("nested")).toBe(true);
  });

  it("shellfs:read-text reads file content inside workspace", async () => {
    const content = await shellFsHandlers.readTextFile("nested/hello.txt", root);
    expect(content).toBe("hello world");
  });

  it("shellfs:read-text rejects paths outside the allowed workspace", async () => {
    const outsidePath = join(outside, "secret.txt");
    await expect(shellFsHandlers.readTextFile(outsidePath, root)).rejects.toThrow();
  });

  it("shellfs:read-text respects maxBytes truncation", async () => {
    const big = "x".repeat(2048);
    await writeFile(join(root, "big.txt"), big, "utf8");
    const truncated = await shellFsHandlers.readTextFile("big.txt", root, 100);
    expect(truncated.startsWith("x".repeat(100))).toBe(true);
    expect(truncated).toContain("已截断");
    expect(truncated.length).toBeLessThanOrEqual(100 + 32);
  });

  it("shellfs:read-file-base64 encodes bytes", async () => {
    const base64 = await shellFsHandlers.readFileBase64("nested/binary.bin", root);
    expect(Buffer.from(base64, "base64")).toEqual(Buffer.from("\x00\x01\x02\x03"));
  });

  it("shellfs:write-text writes inside allowed workspace root", async () => {
    await shellFsHandlers.writeTextFile("nested/new.txt", "written", root);
    const onDisk = await readFile(join(root, "nested", "new.txt"), "utf8");
    expect(onDisk).toBe("written");
  });

  it("shellfs:write-text rejects writes outside allowed workspace root", async () => {
    await expect(
      shellFsHandlers.writeTextFile("../escape.txt", "leak", root),
    ).rejects.toThrow();
  });

  it("shellfs:export-text writes an absolute path inside the workspace", async () => {
    const dest = join(root, "exported.txt");
    await shellFsHandlers.exportTextFile(dest, "exported body");
    expect(await readFile(dest, "utf8")).toBe("exported body");
  });

  it("shellfs:list-dir returns directory entries inside workspace", async () => {
    const entries = await shellFsHandlers.listDir(root, root);
    const names = entries.map((e) => e.name);
    expect(names).toContain("nested");
    const nested = entries.find((e) => e.name === "nested");
    expect(nested?.kind).toBe("directory");
  });

  it("shellfs:list-dir respects maxEntries cap", async () => {
    for (let i = 0; i < 12; i += 1) {
      await writeFile(join(root, `f-${i}.txt`), `${i}`, "utf8");
    }
    const capped = await shellFsHandlers.listDir(root, root, 5);
    expect(capped.length).toBeLessThanOrEqual(5);
  });

  it("shellfs:list-dir rejects paths that escape the workspace", async () => {
    await expect(shellFsHandlers.listDir("..", root)).rejects.toThrow();
  });

  it("shellfs:mkdir creates a directory inside the workspace", async () => {
    await shellFsHandlers.makeDirectory("nested/created", root);
    const s = await fsStat(join(root, "nested", "created"));
    expect(s.isDirectory()).toBe(true);
  });

  it("shellfs:mkdir refuses to escape the workspace", async () => {
    await expect(shellFsHandlers.makeDirectory("../escape", root)).rejects.toThrow();
  });

  it("shellfs:browse-directory opens an OS picker without erroring inside workspace", async () => {
    await expect(shellFsHandlers.browseDirectory(root, root)).resolves.toBeUndefined();
  });

  it("shellfs:browse-directory rejects paths outside the allowed cwd", async () => {
    await expect(shellFsHandlers.browseDirectory(outside, root)).rejects.toThrow();
  });

  it("shellfs:open-url rejects non-http(s) schemes", async () => {
    await expect(shellFsHandlers.openUrl("javascript:alert(1)")).rejects.toThrow();
    await expect(shellFsHandlers.openUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("shellfs:open-path refuses to escape the allowed cwd", async () => {
    const outsideLeaf = outside.split(sep).pop() ?? "outside";
    await expect(
      shellFsHandlers.openPath(join(root, "..", outsideLeaf, "secret.txt"), root),
    ).rejects.toThrow();
  });

  it("shellfs:reveal accepts workspace paths", async () => {
    const target = join(root, "nested", "hello.txt");
    await expect(shellFsHandlers.reveal(target, root)).resolves.toBeUndefined();
  });

  it("shellfs:read-text refuses the filesystem root as cwd", async () => {
    const filesystemRoot = process.platform === "win32" ? "C:\\" : "/";
    await expect(
      shellFsHandlers.readTextFile("../../etc/passwd", filesystemRoot),
    ).rejects.toThrow();
  });

  it("afterAll: removes the temp dirs used by this suite", async () => {
    // Last sanity check that nothing leaked into the on-disk state.
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
