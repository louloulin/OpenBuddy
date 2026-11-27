// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  afterRollback,
  installKey,
  isGitSource,
  pinSource,
  recordInstall,
  recordUpdate,
  rollbackSource,
  type AppInstallRecord,
} from "./install-state.js";

const at = "2026-11-27T00:00:00.000Z";
const git = "https://gitcode.com/lumosaigroup/upup.git";
const record = (source: string, version: string, commit?: string): AppInstallRecord => ({ source, version, commit, at });

describe("安装来源记录 (U6)", () => {
  it("installKey 去掉 #ref / @ref，同仓库的不同 ref 视为同一个应用", () => {
    expect(installKey(git)).toBe(git);
    expect(installKey(`${git}#abc`)).toBe(git);
    expect(installKey(`${git}@abc`)).toBe(git);
    // scp 形式的 git@host 不能被误删。
    expect(installKey("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
    expect(installKey("git@github.com:a/b.git@abc")).toBe("git@github.com:a/b.git");
  });

  it("识别 Git 源（git:/ssh/https .git/gitcode）", () => {
    expect(isGitSource(git)).toBe(true);
    expect(isGitSource("git@github.com:a/b.git")).toBe(true);
    expect(isGitSource("git:https://example.com/a")).toBe(true);
    expect(isGitSource("/Users/me/upup")).toBe(false);
    expect(isGitSource("npm:upup")).toBe(false);
  });

  it("pinSource 去掉已有 ref 后追加 @commit", () => {
    expect(pinSource(git, "abc")).toBe(`${git}@abc`);
    expect(pinSource(`${git}#old`, "new")).toBe(`${git}@new`);
    expect(pinSource(`${git}@old`, "new")).toBe(`${git}@new`);
  });

  it("回滚源：Git 源固定到上一份 commit，npm/本地按原源", () => {
    expect(rollbackSource({ current: record(git, "2"), previous: record(git, "1", "aaa") })).toBe(`${git}@aaa`);
    expect(rollbackSource({ current: record("/tmp/upup", "2"), previous: record("/tmp/upup", "1") })).toBe("/tmp/upup");
    // Git 源没有 commit 就无法回到旧版本。
    expect(rollbackSource({ current: record(git, "2"), previous: record(git, "1") })).toBeNull();
    expect(rollbackSource(undefined)).toBeNull();
    expect(rollbackSource({ current: record(git, "1") })).toBeNull();
  });

  it("recordInstall 内容没变时保留原 previous，避免检查更新覆盖回滚目标", () => {
    const first = recordInstall(undefined, record(git, "1", "aaa"));
    expect(first).toEqual({ current: record(git, "1", "aaa") });

    const second = recordInstall(first, record(git, "2", "bbb"));
    expect(second.current.version).toBe("2");
    expect(second.previous?.version).toBe("1");

    const same = recordInstall(second, record(git, "2", "bbb"));
    expect(same).toBe(second);
  });

  it("recordUpdate 用升级前快照作为回滚目标（第一次更新后即可回滚）", () => {
    const updated = recordUpdate(record(git, "1", "aaa"), record(git, "2", "bbb"));
    expect(updated?.current.version).toBe("2");
    expect(updated?.previous?.version).toBe("1");

    // 版本没变：保留原记录（包括 previous）。
    const existing = recordUpdate(record(git, "1", "aaa"), record(git, "2", "bbb"));
    expect(recordUpdate(record(git, "2", "bbb"), record(git, "2", "bbb"), existing)).toBe(existing);
    // 拿不到升级后快照时沿用原记录。
    expect(recordUpdate(record(git, "1", "aaa"), undefined)).toBeUndefined();
  });

  it("afterRollback 只留当前，不再有 previous", () => {
    const history = afterRollback(record(git, "1", "aaa"));
    expect(history.previous).toBeUndefined();
    expect(history.current.commit).toBe("aaa");
  });
});
