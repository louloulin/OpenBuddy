import { useEffect, useMemo, useRef, useState } from "react";
import { assistantFacade } from "./assistant-facade";
import type { CollaborationSnapshot } from "./assistant-facade";

export function computeAssistantBadges(snapshot: CollaborationSnapshot | null | undefined): Record<string, string | number> {
  const map: Record<string, string | number> = {};
  if (!snapshot) return map;
  const pendingApprovals = snapshot.organization.approvals.filter((approval) => approval.status === "pending").length;
  const unreadInbox = snapshot.inbox.filter((item) => !item.read).length;
  const failedTasks = snapshot.tasks.filter((task) => ["failed", "disputed"].includes(task.status)).length;
  const runningWorkflows = snapshot.workflows.filter((workflow) => workflow.status === "running" || workflow.status === "paused").length;
  const networkProposals = snapshot.network.proposals.filter((proposal) => proposal.status === "open").length;
  const totalCapabilities = snapshot.capabilities.local + snapshot.capabilities.room + snapshot.capabilities.organization + snapshot.capabilities.directory;
  const pendingSideEffects = (snapshot.sideEffectIntents ?? []).filter((intent) => intent.status === "pending").length;
  const expiredDelegations = snapshot.organization.delegations.filter((grant) => !grant.revokedAt && new Date(grant.expiresAt).getTime() <= Date.now()).length;
  // 协作相关计数：跳过邮件（已在收件箱 Tab）和组织审批（已在治理分组），
  // 只保留 Buddy 间的 mention、invite、handover 等需要用户响应的项。
  const collaborationUnread = snapshot.inbox.filter((item) => !item.read && item.source !== "email" && item.kind !== "approval").length;
  const activeRooms = snapshot.rooms.filter((room) => room.memberCount > 1 || room.room.kind !== "personal").length;
  map["助理·收件箱"] = unreadInbox + pendingApprovals;
  map["助理·日程"] = 0;
  map["助理·跨项目任务"] = `${failedTasks}/${snapshot.tasks.length}`;
  map["助理·Rooms"] = snapshot.rooms.length;
  map["助理·助理与 Buddy"] = snapshot.organization.members.length;
  map["助理·开放网络"] = networkProposals;
  map["助理·能力与策略"] = totalCapabilities;
  map["助理·证据与审计"] = snapshot.activity.length;
  map["助理·任务协作"] = map["助理·跨项目任务"];
  map["助理·工作流"] = runningWorkflows;
  map["治理·审批"] = pendingApprovals;
  map["治理·副作用"] = pendingSideEffects;
  map["治理·委托"] = expiredDelegations;
  map["协作·未读"] = collaborationUnread;
  map["协作·活跃"] = activeRooms;
  return map;
}

export function useAssistantBadges(): Record<string, string | number> {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const versionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const next = await assistantFacade.snapshot();
        if (!cancelled) setSnapshot(next);
      } catch (error) {
        // Electron 桥不可用时（例如纯 jsdom 单测）直接保持空 badge，不向调用方抛错。
        if (!cancelled) setSnapshot(null);
        void error;
      }
    };
    void refresh();
    try {
      const promise = assistantFacade.onUpdate(async (update) => {
        const expectedVersion = ++versionRef.current;
        try {
          const next = await assistantFacade.snapshot();
          if (cancelled || expectedVersion !== versionRef.current) return;
          setSnapshot(next);
        } catch {
          // 静默；下一次刷新或下一次事件会重新尝试。
        }
        void update;
      });
      void promise.then((disposer) => {
        if (cancelled) {
          try { disposer(); } catch { /* ignore */ }
        } else {
          unlisten = disposer;
        }
      }).catch(() => {
        // listen() 抛错（例如桥不可用）时直接放弃订阅。
      });
    } catch {
      // listen 同步抛错时静默放弃。
    }
    return () => {
      cancelled = true;
      try { unlisten?.(); } catch { /* ignore */ }
    };
  }, []);

  return useMemo(() => computeAssistantBadges(snapshot), [snapshot]);
}
