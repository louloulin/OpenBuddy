/**
 * CanvasCatalog —— 画布文档与修订历史的 SQLite 行为。
 *
 * 关注三件容易写错的事:修订去重(编辑器防抖保存不该把历史冲成几百条相同记录)、
 * 文档删除时的级联(修订不该变孤儿行)、以及外键开启下画布必须挂在真实 session 上。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStorage, CanvasCatalog, closeStorage } from "@openbuddy/storage";

describe("CanvasCatalog", () => {
  let tempDir = "";
  let storage: Awaited<ReturnType<typeof openStorage>> | undefined;
  let catalog: CanvasCatalog;

  /** canvas_documents.session_id 有外键指向 sessions,所以先种一条真会话。 */
  function seedSession(sessionId: string): void {
    storage!.driver.runExclusiveSync((database) => {
      database.prepare(`INSERT OR IGNORE INTO workspaces(workspace_cwd, updated_at) VALUES (?, ?)`).run("/tmp/ws", "1970-01-01T00:00:00.000Z");
      database
        .prepare(`INSERT OR IGNORE INTO sessions(session_id, workspace_cwd, source_path, source_hash) VALUES (?, ?, ?, ?)`)
        .run(sessionId, "/tmp/ws", `/tmp/ws/${sessionId}.jsonl`, `hash-${sessionId}`);
    });
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ob-canvas-catalog-"));
    storage = await openStorage({ filePath: join(tempDir, "canvas.sqlite"), appVersion: "openbuddy-canvas" });
    catalog = new CanvasCatalog(storage.driver);
    seedSession("session-1");
    seedSession("session-2");
  });

  afterEach(async () => {
    if (storage) await closeStorage(storage);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("upserts a document and reads it back with absent optional fields dropped", async () => {
    catalog.upsertDocument({
      canvasId: "canvas-1",
      sessionId: "session-1",
      kind: "markdown",
      title: "设计稿",
      documentRef: "msg:abc#part:2",
    });

    const document = catalog.getDocument("canvas-1");
    expect(document).toMatchObject({
      canvasId: "canvas-1",
      sessionId: "session-1",
      kind: "markdown",
      title: "设计稿",
      documentRef: "msg:abc#part:2",
      metadata: {},
    });
    expect(document?.sourcePath).toBeUndefined();
    expect(catalog.getDocument("canvas-missing")).toBeUndefined();
  });

  it("keeps revisions monotonic and dedupes unchanged content", async () => {
    catalog.upsertDocument({ canvasId: "canvas-1", sessionId: "session-1", kind: "markdown" });

    const first = catalog.saveRevision("canvas-1", "# v1");
    const repeat = catalog.saveRevision("canvas-1", "# v1");
    const second = catalog.saveRevision("canvas-1", "# v2");

    expect(first.seq).toBe(1);
    expect(repeat.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(catalog.listRevisions("canvas-1")).toHaveLength(2);
    expect(catalog.latestRevision("canvas-1")?.content).toBe("# v2");
  });

  it("lists documents by session", async () => {
    catalog.upsertDocument({ canvasId: "a", sessionId: "session-1", kind: "markdown", title: "A" });
    catalog.upsertDocument({ canvasId: "b", sessionId: "session-2", kind: "html" });
    catalog.upsertDocument({ canvasId: "c", sessionId: "session-1", kind: "svg" });

    expect(catalog.listDocuments("session-1").map((d) => d.canvasId).sort()).toEqual(["a", "c"]);
    expect(catalog.listDocuments()).toHaveLength(3);
  });

  it("marks a document as saved-to-disk and cascades revisions on delete", async () => {
    catalog.upsertDocument({ canvasId: "canvas-1", sessionId: "session-1", kind: "markdown" });
    catalog.saveRevision("canvas-1", "draft");

    catalog.markSaved("canvas-1", "docs/spec.md");
    expect(catalog.getDocument("canvas-1")?.sourcePath).toBe("docs/spec.md");

    catalog.deleteDocument("canvas-1");
    expect(catalog.getDocument("canvas-1")).toBeUndefined();
    expect(catalog.listRevisions("canvas-1")).toEqual([]);
  });

  it("deleting the owning session removes its canvases", async () => {
    catalog.upsertDocument({ canvasId: "canvas-1", sessionId: "session-2", kind: "markdown" });
    storage?.driver.runExclusiveSync((database) => {
      database.prepare(`DELETE FROM sessions WHERE session_id = ?`).run("session-2");
    });

    expect(catalog.getDocument("canvas-1")).toBeUndefined();
    expect(catalog.listRevisions("canvas-1")).toEqual([]);
  });

  it("rejects an unknown kind at the schema level", async () => {
    expect(() =>
      storage?.driver.runExclusiveSync((database) => {
        database
          .prepare(`INSERT INTO canvas_documents(canvas_id, session_id, kind, title, metadata_json, created_at, updated_at)
                    VALUES (?, ?, 'binary', '', '{}', '', '')`)
          .run("canvas-bad", "session-1");
      }),
    ).toThrow();
  });
});