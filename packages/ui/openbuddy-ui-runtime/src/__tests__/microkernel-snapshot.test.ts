/**
 * microkernel-snapshot.test.ts — `microkernelSnapshot()` 的一致性契约。
 *
 * 「设置 → 系统信息」面板把两个数字并排显示给用户:标题说"已登记槽位 N 个",
 * 列表渲染 M 行。它们来自内核的**两个不同**入口(`size()` 与 `snapshot()`),
 * 而这两者历史上相差 1 —— `size()` 写的是 `records.size - 1`(刻意减掉隐式
 * `root`),`snapshot()` 则把它留着。于是面板标题 57、展开 58 行,自己跟自己
 * 对不上。
 *
 * 修法不是把某个数字改掉(两个数各有含义,都对),而是让它们的含义在 API 上
 * 显式分开:`slotCount`(= size(),不含 root)、`snapshotRows`(= 行数,含 root),
 * 并给每行打 `implicitRoot` 标记,使"等插件替换的根槽"不会被误报成
 * "有个槽位没人实现"。
 */
import { describe, it, expect } from "vitest";

import { microkernelSnapshot } from "../client";
/**
 * R82 —— `microkernelSnapshot()` 的一致性契约。
 *
 * 「设置 → 系统信息」面板把这两个数字并排显示给用户:标题说"已登记槽位 N 个",
 * 列表渲染 M 行。它们来自内核的**两个不同**入口(`size()` 与 `snapshot()`),
 * 而这两者历史上就差了 1 —— `size()` 写的是 `records.size - 1`(刻意减掉隐式
 * `root`),`snapshot()` 则把它留着。结果就是面板标题 57、展开 58 行,自己
 * 跟自己对不上。
 *
 * 修法不是把某个数字改掉(两个数各有含义,都对),而是让它们的含义在 API 上
 * 显式分开:`slotCount`(= size(),不含 root)、`snapshotRows`(= 行数,含 root),
 * 并给每行打 `implicitRoot` 标记,使"等插件替换的根槽"不会被误报成
 * "有个槽位没人实现"。
 */

describe("microkernelSnapshot — 与 SlotCore 的一致性", () => {
  it("snapshotRows 等于 slots.length,且 slotCount 等于 size()(不含隐式 root)", () => {
    const snap = microkernelSnapshot();
    expect(snap.snapshotRows).toBe(snap.slots.length);
    // root 是隐式的,所以显式登记数恰好比行数少 1(或相等,若 root 未登记)。
    const rootRows = snap.slots.filter((s) => s.implicitRoot).length;
    expect(snap.slotCount).toBe(snap.snapshotRows - rootRows);
  });

  it("隐式 root 被标记出来,且不出现在 emptySlots 告警里", () => {
    const snap = microkernelSnapshot();
    const root = snap.slots.find((s) => s.name === "root");
    if (root) {
      expect(root.implicitRoot).toBe(true);
      // root 天然没有 entry(它等插件整体替换 AppFrame),不该报警。
      expect(snap.emptySlots).not.toContain("root");
    }
    for (const name of snap.emptySlots) {
      const row = snap.slots.find((s) => s.name === name);
      expect(row?.entries).toBe(0);
      expect(row?.implicitRoot).toBe(false);
    }
  });

  it("槽位按名字排序,且每个槽位都带 kind / scope / entries", () => {
    const snap = microkernelSnapshot();
    const names = snap.slots.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    for (const slot of snap.slots) {
      expect(typeof slot.kind).toBe("string");
      expect(typeof slot.scope).toBe("string");
      expect(Number.isInteger(slot.entries)).toBe(true);
      expect(Array.isArray(slot.registrants)).toBe(true);
    }
  });

  it("failedPackages 与 packages 里 ok=false 的条数一致", () => {
    const snap = microkernelSnapshot();
    expect(snap.failedPackages).toBe(snap.packages.filter((p) => !p.ok).length);
  });
});
