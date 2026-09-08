/**
 * host-modules/_surface/profile-remote-contributions.ts
 *
 * v7-A — Read-only projection of state.profileRemoteContributions.
 *
 * 背景:
 *   agent-host.ts:429-436 的 listProfileRemoteContributions() 把
 *   state.profileRemoteContributions Map 投影成 Array, 每个 contribution
 *   做浅克隆以避免 renderer 端 mutate 共享对象. 这是 IPC facade 入口,
 *   每次 renderer 拉取都会调用.
 *
 * 设计:
 *   - 接受 state 参数 (DI), 零 module-level singleton
 *   - 纯函数, 易测试
 *   - 浅克隆 descriptors Array (保持原 contributor 列表共享, 单 descriptor 克隆)
 *
 * v7-A 收益: agent-host.ts -8 行, projection logic 独立可测试.
 */

import type { RemoteContribution } from "../_state-shape";

export function listProfileRemoteContributions(
  state: { profileRemoteContributions: Map<string, RemoteContribution> },
): RemoteContribution[] {
  return [...state.profileRemoteContributions.values()].map((contribution) => ({
    ...contribution,
    descriptors: contribution.descriptors.map((descriptor: RemoteContribution["descriptors"][number]) => ({ ...descriptor })),
  }));
}
