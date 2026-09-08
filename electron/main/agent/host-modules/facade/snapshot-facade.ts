/**
 * host-modules/facade/snapshot-facade.ts
 *
 * v6-G M2 — 提取 capturePiProfileSnapshot / restorePiProfileSnapshot
 * (PiProfileSnapshot 类型 re-export) 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import {
  capturePiProfileSnapshot as capturePiProfileSnapshotImpl,
  restorePiProfileSnapshot as restorePiProfileSnapshotImpl,
} from "../profile/snapshot";
import type { PiProfileSnapshot } from "../profile/snapshot";

export type { PiProfileSnapshot };

export function buildSnapshotFacade() {
  return {
    capturePiProfileSnapshot: (...args: Parameters<typeof capturePiProfileSnapshotImpl>) =>
      capturePiProfileSnapshotImpl(...args),
    restorePiProfileSnapshot: (...args: Parameters<typeof restorePiProfileSnapshotImpl>) =>
      restorePiProfileSnapshotImpl(...args),
  };
}
