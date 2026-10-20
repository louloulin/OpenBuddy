/**
 * 两条互相咬合的一致性契约:
 *
 * 1. **`updateMetadata` 必须是事务** —— 它是「读整份快照 → 交给 mutator →
 *    整份写回」。两个并发的调用会读到**同一份**前态,后写的那个无声地吃掉
 *    前一个的改动。这不是理论问题:`updateMetadata` 正是 slash 命令的入口,
 *    而 slash 是并发扇出的。
 *
 * 2. **写必须立刻让会话列表缓存失效** —— 以前靠每个变更点自己记得调
 *    `invalidateSessionsCache()`,而 slash 重命名、`updateMetadata` 编辑这些
 *    路径根本没调。结果是「改名不生效」要等到 30s TTL 到期或切换目录。
 *    现在由 store 在写入点 bump epoch,调用方无需知情。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionMetadataStore } from "./session-metadata-store";
import { bumpCacheEpoch, cachedListSessions, currentCacheEpoch } from "./_cache";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbuddy-metadata-txn-"));
  await mkdir(root, { recursive: true });
});

afterEach(() => {
  bumpCacheEpoch();
});

function makeStore(): SessionMetadataStore {
  return new SessionMetadataStore({
    databasePath: join(root, "openbuddy.sqlite"),
    legacyJsonPath: join(root, "openbuddy-state.json"),
  });
}

describe("SessionMetadataStore.updateMetadata — 不会丢更新", () => {
  it("并发写不同字段时两次改动都保留", async () => {
    const store = makeStore();

    // 同时起跑:一个 pin,一个设 expert。它们写的是不同字段,但旧实现
    // 会让后写的那次把前一次的整份快照覆盖回去,pin 就没了。
    await Promise.all([
      store.updateMetadata((snapshot) => {
        snapshot.pinned.push("session-pinned");
      }),
      store.updateMetadata((snapshot) => {
        snapshot.experts["session-expert"] = { expertId: "e1", expertName: "Architect" };
      }),
    ]);

    const snapshot = await store.snapshot();
    expect(snapshot.pinned).toContain("session-pinned");
    expect(snapshot.experts["session-expert"]).toEqual({ expertId: "e1", expertName: "Architect" });
  });

  it("并发写同一字段时是串行累积,不是后写覆盖", async () => {
    const store = makeStore();

    await Promise.all(
      ["a", "b", "c", "d"].map((id) =>
        store.updateMetadata((snapshot) => {
          snapshot.archived.push(id);
        }),
      ),
    );

    expect((await store.snapshot()).archived).toEqual(["a", "b", "c", "d"]);
  });

  it("mutator 抛错不会把写队列焊死,后续写入照常", async () => {
    const store = makeStore();

    await expect(
      store.updateMetadata(() => {
        throw new Error("mutator blew up");
      }),
    ).rejects.toThrow("mutator blew up");

    await store.updateMetadata((snapshot) => {
      snapshot.pinned.push("after-the-failure");
    });
    expect((await store.snapshot()).pinned).toEqual(["after-the-failure"]);
  });

  it("删除语义仍然成立:mutator 移除的 expert 不会被并发写复活", async () => {
    const store = makeStore();
    await store.updateMetadata((snapshot) => {
      snapshot.experts["doomed"] = { expertId: "e1", expertName: "Doomed" };
    });

    await Promise.all([
      store.updateMetadata((snapshot) => {
        delete snapshot.experts["doomed"];
      }),
      store.updateMetadata((snapshot) => {
        snapshot.pinned.push("unrelated");
      }),
    ]);

    expect((await store.snapshot()).experts["doomed"]).toBeUndefined();
  });
});

describe("缓存 epoch — 写入立刻让会话列表失效", () => {
  it("updateMetadata 会 bump epoch", async () => {
    const store = makeStore();
    const before = currentCacheEpoch();
    await store.updateMetadata((snapshot) => {
      snapshot.pinned.push("x");
    });
    expect(currentCacheEpoch()).toBeGreaterThan(before);
  });

  it("重命名类写入不必再等 TTL —— 缓存投影立刻反映新状态", async () => {
    let title = "旧标题";
    const readTitle = () => cachedListSessions("/repo", async () => title);

    expect(await readTitle()).toBe("旧标题");
    title = "新标题";
    // 不 bump:TTL 内仍然拿到旧值 —— 这正是那个「改名不生效」的 bug。
    expect(await readTitle()).toBe("旧标题");

    // 走 store 的写入路径(= 真实的重命名入口)之后立刻变新。
    const store = makeStore();
    await store.updateMetadata(() => {
      title = "新标题";
    });
    expect(await readTitle()).toBe("新标题");
  });

  it("epoch 单调递增,bump 之后旧的 in-flight 结果不会污染新世代", async () => {
    const seen: string[] = [];
    const slow = cachedListSessions("/repo", async () => {
      seen.push("slow");
      return "generation-1";
    });
    // 在 slow 落定之前 bump —— 新世代的调用必须重新读盘。
    bumpCacheEpoch();
    const fresh = cachedListSessions("/repo", async () => {
      seen.push("fresh");
      return "generation-2";
    });

    expect(await slow).toBe("generation-1");
    expect(await fresh).toBe("generation-2");
    expect(seen).toEqual(["slow", "fresh"]);
  });
});