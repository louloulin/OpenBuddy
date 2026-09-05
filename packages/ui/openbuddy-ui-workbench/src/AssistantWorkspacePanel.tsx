import { AssistantsPanel } from "@openbuddy/ui-settings";
import { AssistantCalendarPanel } from "./AssistantCalendarPanel";
import { CalendarDays, ChevronRight, FileCheck, GitBranch, Inbox, ListTodo, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useProjectsStore } from "@/stores/projects-store";
import { assistantFacade, type CollaborationSnapshot } from "@/lib/agent/assistant-facade";
import { collaborationAddOrganizationMember, collaborationGrantDelegation, collaborationRegisterNetworkPeer, collaborationRemoveOrganizationMember } from "@/lib/agent/pi-client";
import { RendererContributionView } from "./RendererContributionView";
import { ConfirmDialog } from "@openbuddy/ui-dialogs";
import { RecoveryList } from "./RecoveryList";
import { AssistantWorkbenchNav } from "@openbuddy/ui-shell";
import { WorkflowBlackboard } from "./WorkflowBlackboard";
import { BuddyDirectory } from "./BuddyDirectory";
import type { RendererContribution } from "@openbuddy/renderer-host";
import {
  assistantRouteForSection,
  type AssistantWorkspaceSection,
} from "@openbuddy/ui-shared";

export type { AssistantWorkspaceSection } from "@openbuddy/ui-shared";

export interface AssistantWorkspacePanelProps {
  section: AssistantWorkspaceSection;
  onToast?: (message: string) => void;
  onNavigate?: (label: string) => void;
  onGoHome?: () => void;
}

const SECTION_META: Record<AssistantWorkspaceSection, { title: string; description: string }> = {
  inbox: { title: "统一收件箱", description: "集中处理邮件待回复、Buddy 委托、审批请求、失败任务和待验收交付。" },
  calendar: { title: "日程", description: "查看 Personal Buddy 的本地日程、Room 范围和时间冲突。" },
  tasks: { title: "跨项目任务", description: "查看多个 Buddy 的任务状态、进度、交付和人工接管入口。" },
  workflows: { title: "工作流 DAG", description: "多 Buddy 工作流提案、执行、暂停、恢复、取消与审计。" },
  rooms: { title: "Rooms", description: "让人和 Buddy 在同一个长期协作空间中共享授权范围内的上下文。" },
  buddies: { title: "助理与 Buddy", description: "管理个人助理、组织 Buddy 和未来可连接的外部 Buddy 身份。" },
  network: { title: "开放网络", description: "在本地沙盒中发现已知 Peer、查看服务提案；公网 Relay、支付和外部副作用默认关闭。" },
  capabilities: { title: "能力与策略", description: "查看能力合同、数据范围、动作权限、预算和审批策略。" },
  evidence: { title: "证据与审计", description: "查看交付物、来源、测试、审批和可重放的活动记录。" },
  recovery: { title: "副作用恢复", description: "查看持久化未决副作用意图，主进程重启后必须显式确认或终止，绝不静默重跑。" },
};

const SECTION_ICON = { inbox: Inbox, calendar: CalendarDays, tasks: ListTodo, workflows: GitBranch, rooms: Users, buddies: Users, network: Users, capabilities: ShieldCheck, evidence: FileCheck, recovery: ShieldCheck } as const;

export { assistantWorkspaceSectionFromRoute } from "@openbuddy/ui-shared";

export function AssistantExtensionPanel({ contribution, onToast, onGoHome, onNavigate }: { contribution: RendererContribution; onToast?: (message: string) => void; onGoHome?: () => void; onNavigate?: (label: string) => void }) {
  const goAssistantHome = onNavigate ? () => onNavigate("助理") : onGoHome;
  const payload = contribution.payload;
  const title = payload.title ?? payload.label ?? contribution.id;
  const description = payload.description ?? "由插件提供的助理工作台扩展。";
  return (
    <div className="assistant-workspace assistant-workspace--extension">
      <header className="assistant-workspace__header">
        <div className="assistant-workspace__header-main">
          <button type="button" className="assistant-workspace__back" onClick={goAssistantHome}>助理</button>
          <ChevronRight size={15} />
          <div><h1>{title}</h1><p>{description}</p></div>
        </div>
        <div className="assistant-workspace__header-tabs">
          <AssistantWorkbenchNav activeRoute={payload.route ?? "助理"} onNavigate={onNavigate ?? (() => {})} onGoHome={goAssistantHome} />
        </div>
      </header>
      <section className="assistant-workspace__content">
        <div className="assistant-workspace__hero-card">
          <div className="assistant-workspace__hero-icon"><Users size={24} /></div>
          <div><h2>{title}</h2><p>{description}</p></div>
        </div>
        <RendererContributionView contribution={contribution} onPlaceholder={onToast} />
      </section>
    </div>
  );
}

function sectionFromRouteRoute(current: AssistantWorkspaceSection): string {
  return assistantRouteForSection(current);
}

export function AssistantWorkspacePanel({ section, onToast, onNavigate, onGoHome }: AssistantWorkspacePanelProps) {
  const meta = SECTION_META[section];
  const Icon = SECTION_ICON[section];
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await assistantFacade.snapshot());
    } catch (error) {
      onToast?.(`协作数据读取失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void assistantFacade.onUpdate(() => {
      if (!disposed) void refresh();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const activeRoute = sectionFromRouteRoute(section);
  const goAssistantHome = onNavigate ? () => onNavigate("助理") : onGoHome;
  const handleSelect = (route: string) => {
    try { window.localStorage?.setItem("openbuddy.assistant.activeTab", route); } catch { /* 忽略存储错误 */ }
    onNavigate?.(route);
  };
  const badgeByRoute = useMemo<Record<string, string | number>>(() => {
    const map: Record<string, string | number> = {};
    if (!snapshot) return map;
    const pendingApprovals = snapshot.organization.approvals.filter((approval) => approval.status === "pending").length;
    const unreadInbox = snapshot.inbox.filter((item) => !item.read).length;
    const failedTasks = snapshot.tasks.filter((task) => ["failed", "disputed"].includes(task.status)).length;
    const runningWorkflows = snapshot.workflows.filter((workflow) => workflow.status === "running" || workflow.status === "paused").length;
    const networkProposals = snapshot.network.proposals.filter((proposal) => proposal.status === "open").length;
    const totalCapabilities = snapshot.capabilities.local + snapshot.capabilities.room + snapshot.capabilities.organization + snapshot.capabilities.directory;
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
    return map;
  }, [snapshot]);
  const topTabsNode = (
    <AssistantWorkbenchNav
      activeRoute={activeRoute}
      onNavigate={handleSelect}
      onGoHome={goAssistantHome}
      {...(Object.keys(badgeByRoute).length > 0 ? { badgeByRoute } : {})}
    />
  );

  if (section === "buddies") {
    return (
      <div className="assistant-workspace assistant-workspace--buddies">
        <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
        <section className="assistant-workspace__content assistant-workspace__content--buddies">
          <div className="assistant-workspace__hero-card">
            <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
            <div><h2>个人、组织与 Peer</h2><p>现有个人助理保持不变；组织成员和最小权限委托作为同一工作台的协作投影。</p></div>
          </div>
          <IdentityEditor snapshot={snapshot} onToast={onToast} />
          <OrganizationList
            snapshot={snapshot}
            loading={loading}
            onAddMember={async (input) => { await assistantFacade.addOrganizationMember(input); await refresh(); }}
            onGrant={async (input) => { await assistantFacade.grantDelegation(input); await refresh(); }}
            onRevoke={async (delegationId) => { await assistantFacade.revokeDelegation(delegationId); await refresh(); }}
            onToast={onToast}
          />
          <AssistantsPanel onToast={onToast} />
          <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
        </section>
      </div>
    );
  }

  if (section === "calendar") {
    return <div className="assistant-workspace"><AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} /><section className="assistant-workspace__content"><AssistantCalendarPanel onToast={onToast} /><ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} /></section></div>;
  }

  if (section === "network") {
    return (
      <div className="assistant-workspace">
        <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
        <section className="assistant-workspace__content">
          <div className="assistant-workspace__hero-card">
            <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
            <div><h2>{meta.title}</h2><p>{meta.description}</p></div>
          </div>
          <BuddyDirectory snapshot={snapshot} loading={loading} />
          <NetworkList snapshot={snapshot} loading={loading} onTrust={async (peerId, trust) => { await assistantFacade.setNetworkPeerTrust(peerId, trust); await refresh(); }} onRegister={async (input) => { await assistantFacade.registerNetworkPeer(input); await refresh(); }} onAddTrustRoot={async (publicKeyPem) => { await assistantFacade.addNetworkTrustRoot(publicKeyPem); await refresh(); }} onRevokeTrustRoot={async (keyRef) => { await assistantFacade.revokeNetworkTrustRoot(keyRef); await refresh(); }} onBid={async (offerId, proposalId, providerId, acceptedDataScopes) => { await assistantFacade.submitNetworkBid({ offerId, proposalId, providerId, message: "本地沙盒 Buddy 竞标", acceptedDataScopes, validUntil: new Date(Date.now() + 60 * 60_000).toISOString() }); await refresh(); }} onAward={async (bidId) => { await assistantFacade.awardNetworkBid(bidId); await refresh(); }} onRetry={async () => { await assistantFacade.retryNetworkDeliveries(); await refresh(); }} onPropose={async (input) => { await assistantFacade.proposeNetworkService(input); await refresh(); }} onPublish={async (input) => { await assistantFacade.publishNetworkOffer(input); await refresh(); }} onNegotiate={async (input) => { await assistantFacade.negotiateNetworkCapability(input); await refresh(); }} onRevokeAgreement={async (agreementId) => { await assistantFacade.revokeNetworkCapabilityAgreement(agreementId, "用户在助理工作台撤销能力合同"); await refresh(); }} onToast={onToast} />
          <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
        </section>
      </div>
    );
  }

  if (section === "inbox") {
    return (
      <div className="assistant-workspace">
          <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
        <section className="assistant-workspace__content">
          <div className="assistant-workspace__hero-card">
            <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
            <div><h2>{meta.title}</h2><p>{meta.description}</p></div>
          </div>
          <ProjectionList title="待处理事项" empty="当前没有待处理的 Buddy 或邮件事项。" items={snapshot?.inbox.filter((item) => !item.read) ?? []} loading={loading} onAck={async (eventId) => { await assistantFacade.ackInbox(eventId); await refresh(); }} onAckEmail={async (accountId, threadId, messageDate) => { await assistantFacade.ackEmailInbox(accountId, threadId, messageDate); await refresh(); }} onOpenEmail={(item) => { if (!item.emailAccountId || !item.emailThreadId) return; localStorage.setItem("openbuddy.email.inbox-target", JSON.stringify({ accountId: item.emailAccountId, threadId: item.emailThreadId })); onNavigate?.("邮件"); }} />
          <ApprovalList approvals={snapshot?.organization.approvals.filter((approval) => approval.status === "pending") ?? []} onDecision={async (approvalId, approved) => { await assistantFacade.decideApproval({ approvalId, approved, reason: approved ? "人工批准" : "人工拒绝" }); await refresh(); }} />
          <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
        </section>
      </div>
    );
  }

  if (section === "tasks") {
    return (
      <div className="assistant-workspace">
        <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
        <section className="assistant-workspace__content">
          <div className="assistant-workspace__hero-card">
            <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
            <div><h2>{meta.title}</h2><p>{meta.description}</p></div>
          </div>
          <TaskProposalForm onCreated={() => void refresh()} onToast={onToast} />
          <WorkflowProposalForm personalBuddyId={snapshot?.identity.id ?? "buddy-local"} organizationMembers={snapshot?.organization.members ?? []} onCreated={() => void refresh()} onToast={onToast} />
          <TaskList tasks={snapshot?.tasks ?? []} controls={snapshot?.organization.taskControls ?? []} loading={loading} onRequestApproval={async (taskId) => { await assistantFacade.requestApproval({ taskId, actions: ["external:send"], reason: "任务需要执行外部副作用" }); await refresh(); }} onExecute={async (taskId) => { const task = snapshot?.tasks.find((entry) => entry.taskId === taskId); const result = await assistantFacade.execute(taskId); const label = task?.mode === "organization" ? "组织 Buddy" : "个人 Buddy"; onToast?.(`${label} ${result.status === "accepted" ? "已完成并验证" : "执行" + result.status}：${result.evidenceCount} 条证据`); await refresh(); }} onControl={async (taskId, action) => { await assistantFacade.controlTask({ taskId, action, reason: action === "takeover" ? "人工接管超时任务" : "人工控制任务" }); await refresh(); }} onToast={onToast} />
          <WorkflowList workflows={snapshot?.workflows ?? []} onExecute={async (workflowId) => { const result = await assistantFacade.executeWorkflow(workflowId); onToast?.(`工作流${result.status === "accepted" ? "已完成并验证" : "执行" + result.status}`); await refresh(); }} />
          <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
        </section>
      </div>
    );
  }

  if (section === "workflows") {
    return (
      <div className="assistant-workspace">
        <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
        <section className="assistant-workspace__content">
          <div className="assistant-workspace__hero-card">
            <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
            <div><h2>{meta.title}</h2><p>{meta.description}</p></div>
          </div>
          <WorkflowProposalForm personalBuddyId={snapshot?.identity.id ?? "buddy-local"} organizationMembers={snapshot?.organization.members ?? []} onCreated={() => void refresh()} onToast={onToast} />
          <WorkflowBlackboard workflows={snapshot?.workflows ?? []} personalProviderId={snapshot?.identity.id} onExecute={async (workflowId) => { const result = await assistantFacade.executeWorkflow(workflowId); onToast?.(`工作流${result.status === "accepted" ? "已完成并验证" : "执行" + result.status}`); await refresh(); }} onControl={async (workflowId, action) => { await assistantFacade.controlWorkflow({ workflowId, action, reason: action === "takeover" ? "人工接管" : "人工控制" }); await refresh(); }} />
          <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
        </section>
      </div>
    );
  }

  if (section === "rooms" || section === "capabilities" || section === "evidence" || section === "recovery" ) {
    return (
      <div className="assistant-workspace">
        <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
        <section className="assistant-workspace__content">
          <div className="assistant-workspace__hero-card">
            <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
            <div><h2>{meta.title}</h2><p>{meta.description}</p></div>
          </div>
          {section === "rooms" && <><RoomList rooms={snapshot?.rooms ?? []} organizationMembers={snapshot?.organization.members ?? []} loading={loading} onAddMember={async (input) => { await assistantFacade.addRoomMember(input); await refresh(); }} onRemoveMember={async (input) => { await assistantFacade.removeRoomMember(input); await refresh(); }} onToast={onToast} /><FederatedGrantList grants={snapshot?.federatedRoomGrants ?? []} rooms={snapshot?.rooms ?? []} organizationMembers={snapshot?.organization.members ?? []} networkPeers={snapshot?.network.peers ?? []} loading={loading} onIssue={async (input) => { await assistantFacade.issueFederatedRoomGrant(input); await refresh(); }} onRevoke={async (grantId) => { await assistantFacade.revokeFederatedRoomGrant(grantId); await refresh(); }} onToast={onToast} /></>}
          {section === "capabilities" && <CapabilityList snapshot={snapshot} loading={loading} />}
          {section === "evidence" && <ActivityList activity={snapshot?.activity ?? []} loading={loading} />}
          {section === "recovery" && <><SideEffectIntentList intents={snapshot?.sideEffectIntents ?? []} onCancel={async (intentId) => { await assistantFacade.cancelSideEffect(intentId, "用户在助理工作台取消副作用"); await refresh(); }} onToast={onToast} /><RecoveryList onToast={onToast} /></>}
          <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
        </section>
      </div>
    );
  }

  return (
    <div className="assistant-workspace">
        <AssistantWorkspaceHeader section={section} onGoHome={goAssistantHome} tabs={topTabsNode} />
      <section className="assistant-workspace__content">
        <div className="assistant-workspace__hero-card">
          <div className="assistant-workspace__hero-icon"><Icon size={24} /></div>
          <div>
            <h2>{meta.title}</h2>
            <p>{meta.description}</p>
          </div>
        </div>
        <div className="assistant-workspace__grid">
          <WorkspaceCard title={cardTitle(section, 0)} description={cardDescription(section, 0)} value={cardValue(section, 0, snapshot)} loading={loading} />
          <WorkspaceCard title={cardTitle(section, 1)} description={cardDescription(section, 1)} value={cardValue(section, 1, snapshot)} loading={loading} />
          <WorkspaceCard title={cardTitle(section, 2)} description={cardDescription(section, 2)} value={cardValue(section, 2, snapshot)} loading={loading} />
        </div>
        <ProjectionNotice snapshot={snapshot} loading={loading} onRefresh={refresh} onNavigate={onNavigate} section={section} />
      </section>
    </div>
  );
}

function SideEffectIntentList({ intents, onCancel, onToast }: { intents: NonNullable<CollaborationSnapshot["sideEffectIntents"]>; onCancel: (intentId: string) => Promise<void>; onToast?: (message: string) => void }) {
  const statusLabel: Record<string, string> = { pending: "待审批", approved: "已批准", consumed: "执行中", completed: "已完成", failed: "失败", rejected: "已拒绝", cancelled: "已取消", expired: "已过期" };
  const active = intents.filter((intent) => ["pending", "approved", "consumed"].includes(intent.status));
  const runCancel = async (intentId: string) => {
    try { await onCancel(intentId); onToast?.("副作用授权已取消"); } catch (error) { onToast?.(`取消副作用失败：${String(error).replace(/^Error:\s*/u, "")}`); }
  };
  return <section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><div><h3>协作副作用授权</h3><p>邮件发送、自动化运行和跨 Buddy 外部动作统一经过一次性授权；旧记录缺少授权意图时保持拒绝。</p></div><span>{active.length} 项未关闭</span></div>{intents.length === 0 ? <p className="assistant-workspace__projection-empty">暂无协作副作用授权。</p> : <div className="assistant-workspace__projection-list">{intents.slice(0, 20).map((intent) => <article key={intent.intentId} className="assistant-workspace__projection-item"><div><strong>{intent.summary}</strong><p>{intent.capability} · {intent.action} · {statusLabel[intent.status] ?? intent.status} · 任务 {intent.taskId} · 到期 {new Date(intent.expiresAt).toLocaleString()}</p>{intent.error && <p>{intent.error}</p>}</div><span className="assistant-workspace__projection-actions">{["pending", "approved"].includes(intent.status) && <button type="button" onClick={() => void runCancel(intent.intentId)}>取消</button>}</span></article>)}</div>}</section>;
}

function ProjectionNotice({ snapshot, loading, onRefresh, onNavigate, section }: { snapshot: CollaborationSnapshot | null; loading: boolean; onRefresh: () => Promise<void>; onNavigate?: (label: string) => void; section: AssistantWorkspaceSection }) {
  return <div className="assistant-workspace__notice">
    <div>
      <strong>{snapshot ? `已连接 ${snapshot.mode} 协作投影` : "正在连接协作投影"}</strong>
      <span>{snapshot ? `Buddy「${snapshot.identity.displayName}」在线状态：${snapshot.identity.status}；数据更新时间 ${new Date(snapshot.updatedAt).toLocaleTimeString()}。` : "通过主进程受限 IPC 读取 Room、Inbox、任务和审计摘要。"}</span>
    </div>
    <button type="button" onClick={() => void onRefresh()}>{loading ? "读取中…" : "刷新"}</button>
    {section === "capabilities" && <button type="button" onClick={() => onNavigate?.("专家·技能·连接器")}>管理技能与连接器 <ChevronRight size={15} /></button>}
  </div>;
}

function ProjectionList({ title, empty, items, loading, onAck, onAckEmail, onOpenEmail }: { title: string; empty: string; items: CollaborationSnapshot["inbox"]; loading: boolean; onAck?: (eventId: string) => Promise<void>; onAckEmail?: (accountId: string, threadId: string, messageDate?: string) => Promise<void>; onOpenEmail?: (item: CollaborationSnapshot["inbox"][number]) => void }) {
  return <section className="assistant-workspace__projection">
    <div className="assistant-workspace__projection-header"><h3>{title}</h3><span>{loading ? "读取中…" : `${items.length} 项`}</span></div>
    {items.length === 0 && !loading ? <p className="assistant-workspace__projection-empty">{empty}</p> : <div className="assistant-workspace__projection-list">{items.slice(0, 8).map((item) => <article key={item.id} className="assistant-workspace__projection-item"><div><strong>{item.title}</strong><p>{item.summary}</p></div><span>{item.source === "email" ? <><button type="button" className="assistant-workspace__projection-ack" onClick={() => onOpenEmail?.(item)}>打开邮件</button>{item.emailAccountId && item.emailThreadId && onAckEmail ? <button type="button" className="assistant-workspace__projection-ack" onClick={() => void onAckEmail(item.emailAccountId!, item.emailThreadId!, item.createdAt)}>标记已处理</button> : null}</> : onAck && <button type="button" className="assistant-workspace__projection-ack" onClick={() => void onAck(item.eventId)}>确认</button>}</span></article>)}</div>}
  </section>;
}

function ApprovalList({ approvals, onDecision }: { approvals: CollaborationSnapshot["organization"]["approvals"]; onDecision: (approvalId: string, approved: boolean) => Promise<void> }) {
  return <section className="assistant-workspace__projection">
    <div className="assistant-workspace__projection-header"><h3>组织审批门</h3><span>{approvals.length} 项待决策</span></div>
    {approvals.length === 0 ? <p className="assistant-workspace__projection-empty">没有待人工决策的外部动作。</p> : <div className="assistant-workspace__projection-list">{approvals.map((approval) => <article key={approval.id} className="assistant-workspace__projection-item"><div><strong>{approval.reason}</strong><p>{approval.taskId} · {approval.actions.join("、")}</p></div><span className="assistant-workspace__projection-actions"><button type="button" onClick={() => void onDecision(approval.id, true)}>批准</button><button type="button" onClick={() => void onDecision(approval.id, false)}>拒绝</button></span></article>)}</div>}
  </section>;
}

function OrganizationList({ snapshot, loading, onAddMember, onRemoveMember, onGrant, onRevoke, onToast }: { snapshot: CollaborationSnapshot | null; loading: boolean; onAddMember: (input: Parameters<typeof collaborationAddOrganizationMember>[0]) => Promise<void>; onRemoveMember?: (input: Parameters<typeof collaborationRemoveOrganizationMember>[0]) => Promise<void>; onGrant: (input: Parameters<typeof collaborationGrantDelegation>[0]) => Promise<void>; onRevoke: (delegationId: string) => Promise<void>; onToast?: (message: string) => void }) {
  const organization = snapshot?.organization;
  const [memberId, setMemberId] = useState("");
  const [memberHandle, setMemberHandle] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberOwner, setMemberOwner] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "admin" | "auditor">("member");
  const [granteeId, setGranteeId] = useState(organization?.members[0]?.identity.id ?? "");
  const [allowedCapabilities, setAllowedCapabilities] = useState("research");
  const [allowedDataScopes, setAllowedDataScopes] = useState("room:personal-room");
  const [taskId, setTaskId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!granteeId && organization?.members[0]?.identity.id) setGranteeId(organization.members[0].identity.id);
  }, [granteeId, organization?.members]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const capabilities = allowedCapabilities.split(",").map((value) => value.trim()).filter(Boolean);
    const scopes = allowedDataScopes.split(",").map((value) => value.trim()).filter(Boolean);
    if (!granteeId.trim() || capabilities.length === 0 || scopes.length === 0 || !expiresAt || busy) return;
    setBusy(true);
    try {
      await onGrant({ granteeId: granteeId.trim(), ...(taskId.trim() ? { taskId: taskId.trim() } : {}), ...(roomId.trim() ? { roomId: roomId.trim() } : {}), allowedCapabilities: capabilities, allowedDataScopes: scopes, expiresAt: new Date(expiresAt).toISOString() });
      setTaskId("");
      setRoomId("");
    } catch (error) {
      onToast?.(`创建委托失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setBusy(false);
    }
  };
  const submitMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberId.trim() || !memberHandle.trim() || !memberName.trim() || !memberOwner.trim() || busy) return;
    setBusy(true);
    try {
      await onAddMember({ id: memberId.trim(), handle: memberHandle.trim(), displayName: memberName.trim(), ownerUserId: memberOwner.trim(), role: memberRole });
      setMemberId("");
      setMemberHandle("");
      setMemberName("");
      setMemberOwner("");
    } catch (error) {
      onToast?.(`添加组织 Buddy 失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (delegationId: string) => {
    if (busy) return;
    setBusy(true);
    try { await onRevoke(delegationId); } catch (error) { onToast?.(`撤销委托失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setBusy(false); }
  };
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);
  const removeMember = async (memberId: string) => {
    if (busy || !onRemoveMember) return;
    setBusy(true);
    try { await onRemoveMember({ memberId }); setPendingRemove(null); } catch (error) { onToast?.(`移除组织 Buddy 失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setBusy(false); }
  };
  return <section className="assistant-workspace__organization-grid">
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><div><h3>组织 Buddy</h3><p>成员是组织范围内可被委托的 Buddy 身份；加入后仍需单独配置能力和数据范围。</p></div><span>{loading ? "读取中…" : `${organization?.members.length ?? 0} 位成员`}</span></div>
      <form className="assistant-workspace__member-form" onSubmit={(event) => void submitMember(event)}>
        <input aria-label="成员 ID" placeholder="Buddy ID" value={memberId} onChange={(event) => setMemberId(event.target.value)} disabled={busy} />
        <input aria-label="成员句柄" placeholder="句柄，如 researcher" value={memberHandle} onChange={(event) => setMemberHandle(event.target.value)} disabled={busy} />
        <input aria-label="成员显示名称" placeholder="显示名称" value={memberName} onChange={(event) => setMemberName(event.target.value)} disabled={busy} />
        <input aria-label="成员所属用户" placeholder="所属用户 ID" value={memberOwner} onChange={(event) => setMemberOwner(event.target.value)} disabled={busy} />
        <select aria-label="成员角色" value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)} disabled={busy}>
          <option value="member">成员</option><option value="admin">管理员</option><option value="auditor">审计员</option>
        </select>
        <button type="submit" disabled={busy || !memberId.trim() || !memberHandle.trim() || !memberName.trim() || !memberOwner.trim()}>{busy ? "提交中…" : "添加组织 Buddy"}</button>
      </form>
      {(organization?.members ?? []).map((member) => (
        <article key={member.identity.id} className="assistant-workspace__projection-item">
          <div><strong>{member.identity.displayName}</strong><p>@{member.identity.handle} · {member.identity.id}</p></div>
          <span className="assistant-workspace__projection-actions">
            <span className="assistant-workspace__projection-tag">{member.role}</span>
            {onRemoveMember && member.identity.id !== snapshot?.identity.id && (
              <button type="button" onClick={() => setPendingRemove({ id: member.identity.id, name: member.identity.displayName })} disabled={busy}>移除</button>
            )}
          </span>
        </article>
      ))}
      {pendingRemove && onRemoveMember && (
        <ConfirmDialog
          open
          title={`移除 ${pendingRemove.name}？`}
          description="移除后该 Buddy 的现有委托立即失效（fail-closed），新授权也会被拒绝；事件账本保留审计记录。" 
          confirmLabel="确认移除"
          cancelLabel="取消"
          tone="danger"
          busy={busy}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => void removeMember(pendingRemove.id)}
        />
      )}
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><div><h3>最小权限委托</h3><p>委托只绑定成员、能力、数据范围和过期时间；撤销后由 Main Runtime 拒绝后续执行。</p></div><span>{loading ? "读取中…" : `${organization?.delegations.length ?? 0} 项`}</span></div>
      <form className="assistant-workspace__delegation-form" onSubmit={(event) => void submit(event)}>
        <select aria-label="委托成员" value={granteeId} onChange={(event) => setGranteeId(event.target.value)} disabled={busy || (organization?.members.length ?? 0) === 0}>
          <option value="">选择组织 Buddy</option>
          {(organization?.members ?? []).filter((member) => member.active).map((member) => <option key={member.identity.id} value={member.identity.id}>{member.identity.displayName} · {member.identity.id}</option>)}
        </select>
        <input aria-label="委托能力" placeholder="能力，逗号分隔，如 research,calendar" value={allowedCapabilities} onChange={(event) => setAllowedCapabilities(event.target.value)} disabled={busy} />
        <input aria-label="委托数据范围" placeholder="数据范围，逗号分隔，如 room:personal-room" value={allowedDataScopes} onChange={(event) => setAllowedDataScopes(event.target.value)} disabled={busy} />
        <input aria-label="委托任务范围" placeholder="可选 taskId" value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={busy} />
        <input aria-label="委托 Room 范围" placeholder="可选 roomId" value={roomId} onChange={(event) => setRoomId(event.target.value)} disabled={busy} />
        <input aria-label="委托过期时间" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy || !granteeId || (organization?.members.length ?? 0) === 0}>{busy ? "提交中…" : "创建委托"}</button>
      </form>
      {(organization?.delegations ?? []).length === 0 ? <p className="assistant-workspace__projection-empty">尚未创建组织委托；执行前必须绑定能力、数据范围和过期时间。</p> : (organization?.delegations ?? []).map((grant) => <article key={grant.id} className="assistant-workspace__projection-item"><div><strong>{grant.granteeId}</strong><p>{grant.allowedCapabilities.join("、")} · {grant.allowedDataScopes.join("、")}{grant.taskId ? ` · 任务 ${grant.taskId}` : ""}{grant.roomId ? ` · Room ${grant.roomId}` : ""}</p></div><span className="assistant-workspace__projection-actions">{grant.revokedAt ? "已撤销" : <><span>至 {new Date(grant.expiresAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={() => void revoke(grant.id)}>撤销</button></>}</span></article>)}
    </section>
  </section>;
}

function NetworkList({ snapshot, loading, onTrust, onRegister, onAddTrustRoot, onRevokeTrustRoot, onBid, onAward, onRetry, onPropose, onPublish, onNegotiate, onRevokeAgreement, onToast }: { snapshot: CollaborationSnapshot | null; loading: boolean; onTrust: (peerId: string, trust: "known" | "trusted" | "blocked") => Promise<void>; onRegister: (input: Parameters<typeof collaborationRegisterNetworkPeer>[0]) => Promise<void>; onAddTrustRoot: (publicKeyPem: string) => Promise<void>; onRevokeTrustRoot: (keyRef: string) => Promise<void>; onBid: (offerId: string, proposalId: string, providerId: string, acceptedDataScopes: string[]) => Promise<void>; onAward: (bidId: string) => Promise<void>; onRetry: () => Promise<void>; onPropose: (input: { capabilityId: string; objective: string; dataScopes: string[]; artifactTypes: string[]; expiresAt: string }) => Promise<void>; onPublish: (input: { providerId: string; capabilityId: string; title: string; description: string; acceptedDataScopes: string[]; acceptedArtifactTypes: string[]; approval: "never" | "before_external_commit" | "always"; validUntil: string; visibility: "known_peers" | "directory" }) => Promise<void>; onNegotiate: (input: { offerId: string; proposalId: string; providerId: string }) => Promise<void>; onRevokeAgreement: (agreementId: string) => Promise<void>; onToast?: (message: string) => void }) {
  const network = snapshot?.network;
  const [proposalCapability, setProposalCapability] = useState("research");
  const [proposalObjective, setProposalObjective] = useState("");
  const [offerTitle, setOfferTitle] = useState("");
  const [offerCapability, setOfferCapability] = useState("research");
  const [offerDescription, setOfferDescription] = useState("");
  const [peerId, setPeerId] = useState("");
  const [peerHandle, setPeerHandle] = useState("");
  const [peerName, setPeerName] = useState("");
  const [peerOwner, setPeerOwner] = useState("");
  const [peerOrganization, setPeerOrganization] = useState("");
  const [peerCapabilityId, setPeerCapabilityId] = useState("");
  const [peerCapabilityDescription, setPeerCapabilityDescription] = useState("");
  const [trustRootPem, setTrustRootPem] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const submitProposal = async (event: React.FormEvent) => { event.preventDefault(); if (!proposalObjective.trim() || actionBusy) return; setActionBusy(true); try { await onPropose({ capabilityId: proposalCapability, objective: proposalObjective.trim(), dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }); setProposalObjective(""); } catch (error) { onToast?.(`网络提案失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setActionBusy(false); } };
  const submitOffer = async (event: React.FormEvent) => { event.preventDefault(); if (!offerTitle.trim() || !offerDescription.trim() || actionBusy) return; setActionBusy(true); try { await onPublish({ providerId: snapshot?.identity.id ?? "local-buddy", capabilityId: offerCapability, title: offerTitle.trim(), description: offerDescription.trim(), acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "before_external_commit", validUntil: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), visibility: "known_peers" }); setOfferTitle(""); setOfferDescription(""); } catch (error) { onToast?.(`能力发布失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setActionBusy(false); } };
  const submitPeer = async (event: React.FormEvent) => { event.preventDefault(); if (!peerId.trim() || !peerHandle.trim() || !peerName.trim() || !peerOwner.trim() || !peerCapabilityId.trim() || !peerCapabilityDescription.trim() || actionBusy) return; setActionBusy(true); try { await onRegister({ identity: { id: peerId.trim(), handle: peerHandle.trim(), displayName: peerName.trim(), ownerUserId: peerOwner.trim(), ...(peerOrganization.trim() ? { organizationId: peerOrganization.trim() } : {}), trustLevel: "known_peer", status: "idle" }, capabilities: [{ id: peerCapabilityId.trim(), providerId: peerId.trim(), description: peerCapabilityDescription.trim(), inputSchema: {}, outputSchema: {}, procedure: [], allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["private:*"], allowedActions: ["artifact:produce"], forbiddenActions: ["external:commit"], acceptanceTests: [], requiredApproval: "before_external_commit", allowDelegation: false, maxDelegationDepth: 0, visibility: "directory" }] }); setPeerId(""); setPeerHandle(""); setPeerName(""); setPeerOwner(""); setPeerOrganization(""); setPeerCapabilityId(""); setPeerCapabilityDescription(""); } catch (error) { onToast?.(`添加 Peer 失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setActionBusy(false); } };
  const submitTrustRoot = async (event: React.FormEvent) => { event.preventDefault(); if (!trustRootPem.trim() || actionBusy) return; setActionBusy(true); try { await onAddTrustRoot(trustRootPem.trim()); setTrustRootPem(""); } catch (error) { onToast?.(`添加信任根失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setActionBusy(false); } };
  return <>
      <section className="assistant-workspace__network-banner"><strong>local-sandbox</strong><span>Relay：{snapshot?.relay.status ?? "unknown"}{snapshot?.relay.sync ? ` · 同步：${snapshot.relay.sync.status}${snapshot.relay.sync.lastError ? `（${snapshot.relay.sync.lastError}）` : ""}` : ""} · 只交换身份、能力卡、摘要和 context refs；settlement：not configured。</span></section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><div><h3>本地 Agent Card 信任根</h3><p>只保存公钥；这是本机 trust root，不是公网目录。只有验签通过的 Agent Card 才能进入网络服务流转。</p></div><span>{network?.trustRoots.length ?? 0} 个</span></div>
      <form className="assistant-workspace__peer-form" onSubmit={(event) => void submitTrustRoot(event)}>
        <textarea aria-label="Agent Card 公钥" placeholder="粘贴 Ed25519 公钥 PEM（-----BEGIN PUBLIC KEY-----）" value={trustRootPem} onChange={(event) => setTrustRootPem(event.target.value)} rows={3} />
        <button type="submit" disabled={actionBusy || !trustRootPem.trim()}>添加公钥信任根</button>
      </form>
      {network?.trustRoots.length ? <div className="assistant-workspace__projection-list">{network.trustRoots.map((root) => <article key={root.keyRef} className="assistant-workspace__projection-item"><div><strong>{root.keyRef}</strong><p>添加于 {new Date(root.addedAt).toLocaleString()} · {root.revokedAt ? `已撤销于 ${new Date(root.revokedAt).toLocaleString()}` : "当前有效"}</p></div><span className="assistant-workspace__projection-actions">{!root.revokedAt && <button type="button" onClick={() => void onRevokeTrustRoot(root.keyRef)}>撤销</button>}</span></article>)}</div> : <p className="assistant-workspace__projection-empty">尚未配置本地公钥信任根；带签名的外部 Agent Card 将保持 unverified。</p>}
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><h3>添加 Peer / Agent</h3><span>默认 pending，需人工建立信任</span></div>
      <form className="assistant-workspace__peer-form" onSubmit={(event) => void submitPeer(event)}>
        <input aria-label="Peer id" placeholder="Buddy id" value={peerId} onChange={(event) => setPeerId(event.target.value)} />
        <input aria-label="Peer handle" placeholder="handle" value={peerHandle} onChange={(event) => setPeerHandle(event.target.value)} />
        <input aria-label="Peer display name" placeholder="显示名称" value={peerName} onChange={(event) => setPeerName(event.target.value)} />
        <input aria-label="Peer owner user id" placeholder="owner user id" value={peerOwner} onChange={(event) => setPeerOwner(event.target.value)} />
        <input aria-label="Peer organization id" placeholder="organization id（可选）" value={peerOrganization} onChange={(event) => setPeerOrganization(event.target.value)} />
        <input aria-label="Peer capability id" placeholder="能力 id" value={peerCapabilityId} onChange={(event) => setPeerCapabilityId(event.target.value)} />
        <input aria-label="Peer capability description" placeholder="能力说明" value={peerCapabilityDescription} onChange={(event) => setPeerCapabilityDescription(event.target.value)} />
        <button type="submit" disabled={actionBusy || !peerId.trim() || !peerHandle.trim() || !peerName.trim() || !peerOwner.trim() || !peerCapabilityId.trim() || !peerCapabilityDescription.trim()}>添加 Peer</button>
      </form>
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><div><h3>网络协作入口</h3><p>发现 → 谈判 → 委托；如果当前存在项目上下文，提案会绑定 Project Room，授标前必须签发 Grant。</p></div><span>发现 → 谈判 → 委托</span></div>
      <div className="assistant-workspace__task-form-fields"><form onSubmit={(event) => void submitProposal(event)}><input aria-label="网络提案目标" placeholder="向 Peer 提出公开研究需求" value={proposalObjective} onChange={(event) => setProposalObjective(event.target.value)} /><select aria-label="网络提案能力" value={proposalCapability} onChange={(event) => setProposalCapability(event.target.value)}><option value="research">研究</option><option value="document">文档</option><option value="general">通用规划</option></select><button type="submit" disabled={actionBusy || !proposalObjective.trim()}>发布提案</button></form><form onSubmit={(event) => void submitOffer(event)}><input aria-label="网络服务标题" placeholder="发布我的 Buddy 服务" value={offerTitle} onChange={(event) => setOfferTitle(event.target.value)} /><input aria-label="网络服务说明" placeholder="服务说明" value={offerDescription} onChange={(event) => setOfferDescription(event.target.value)} /><select aria-label="网络服务能力" value={offerCapability} onChange={(event) => setOfferCapability(event.target.value)}><option value="research">研究</option><option value="document">文档</option><option value="general">通用规划</option></select><button type="submit" disabled={actionBusy || !offerTitle.trim() || !offerDescription.trim()}>发布能力卡</button></form></div>
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><h3>Relay 投递队列</h3><span>{snapshot?.relay.pending.length ?? 0} 项待恢复</span>{(snapshot?.relay.pending.length ?? 0) > 0 && <button type="button" onClick={() => void onRetry()}>重试待投递</button>}</div>
      {snapshot?.relay.pending.length ? <div className="assistant-workspace__projection-list">{snapshot.relay.pending.map((entry) => <article key={entry.messageId} className="assistant-workspace__projection-item"><div><strong>{entry.taskId}</strong><p>{entry.messageId} · 第 {entry.attempts} 次尝试{entry.lastError ? ` · ${entry.lastError}` : ""}</p></div><span>pending</span></article>)}</div> : <p className="assistant-workspace__projection-empty">没有需要恢复的 Relay 投递。</p>}
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><h3>已发现 Peer</h3><span>{loading ? "读取中…" : `${network?.peers.length ?? 0} 个`}</span></div>
      {!network?.peers.length && !loading ? <p className="assistant-workspace__projection-empty">还没有 Peer。注册和发现入口保留在主进程，建立信任后才能发布能力或竞标。</p> : <div className="assistant-workspace__projection-list">{network?.peers.map((peer) => { const presenceActive = peer.presence ? Date.parse(peer.presence.expiresAt) > Date.now() : false; return <article key={peer.identity.id} className="assistant-workspace__projection-item"><div><strong>{peer.identity.displayName}</strong><p>{peer.identity.handle} · {peer.capabilities.map((capability) => capability.id).join("、") || "未声明能力"}</p><small>Agent Card：{peer.agentCardStatus} · Presence：{presenceActive ? "online" : "offline"} · 最近发现：{new Date(peer.lastSeenAt).toLocaleString()}</small></div><span className="assistant-workspace__projection-actions"><em className={`assistant-workspace__trust assistant-workspace__trust--${peer.trust}`}>{peer.trust}</em>{peer.trust === "pending" && <button type="button" onClick={() => void onTrust(peer.identity.id, "known")}>标记已知</button>}{["known", "trusted"].includes(peer.trust) && <button type="button" onClick={() => void onTrust(peer.identity.id, peer.trust === "known" ? "trusted" : "blocked")}>{peer.trust === "known" ? "提升信任" : "阻断"}</button>}</span></article>; })}</div>}
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><h3>Capability Directory</h3><span>{network?.capabilityDirectory.length ?? 0} 项能力</span></div>
      {network?.capabilityDirectory.length ? <div className="assistant-workspace__projection-list">{network.capabilityDirectory.map((entry) => <article key={`${entry.peerId}:${entry.capability.id}`} className="assistant-workspace__projection-item"><div><strong>{entry.capability.id}</strong><p>{entry.identity.displayName} · {entry.capability.description}</p><p>数据：{entry.capability.allowedDataScopes.join("、")} · 动作：{entry.capability.allowedActions.join("、")}</p></div><span className="assistant-workspace__projection-actions"><em className={`assistant-calendar__status assistant-calendar__status--${entry.agentCardStatus === "verified" ? "confirmed" : entry.agentCardStatus === "unverified" ? "tentative" : "cancelled"}`}>Agent Card {entry.agentCardStatus}</em><em className={`assistant-workspace__trust assistant-workspace__trust--${entry.trust}`}>{entry.trust}</em></span></article>)}</div> : <p className="assistant-workspace__projection-empty">暂无可发现能力；Peer 必须先通过显式信任和 Agent Card 验证。</p>}
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><h3>服务市场投影</h3><span>{(network?.offers.length ?? 0) + (network?.proposals.length ?? 0) + (network?.bids.length ?? 0) + (network?.capabilityAgreements.length ?? 0)} 项</span></div>
      <div className="assistant-workspace__projection-list">{network?.offers.map((offer) => { const proposal = network.proposals.find((candidate) => candidate.capabilityId === offer.capabilityId && candidate.status === "open"); const agreement = proposal && network.capabilityAgreements.find((candidate) => candidate.providerId === offer.providerId && candidate.capabilityId === offer.capabilityId && candidate.requesterId === snapshot?.identity.id && candidate.status === "accepted" && candidate.expiresAt > new Date().toISOString()); return <article key={offer.id} className="assistant-workspace__projection-item"><div><strong>{offer.title}</strong><p>{offer.capabilityId} · {offer.acceptedArtifactTypes.join("、")}</p></div><span className="assistant-workspace__projection-actions"><em>{offer.visibility}</em>{proposal && <button type="button" onClick={() => void (agreement ? onBid(offer.id, proposal.id, offer.providerId, agreement.dataScopes) : onNegotiate({ offerId: offer.id, proposalId: proposal.id, providerId: offer.providerId }))}>{agreement ? "竞标" : "先谈判"}</button>}</span></article>; })}{network?.proposals.map((proposal) => <article key={proposal.id} className="assistant-workspace__projection-item"><div><strong>提案 {proposal.id}</strong><p>{proposal.capabilityId} · objective digest {proposal.objectiveDigest.slice(0, 10)}…</p></div><span>{proposal.status}</span></article>)}{network?.capabilityAgreements.map((agreement) => <article key={agreement.id} className="assistant-workspace__projection-item"><div><strong>能力合同 {agreement.id}</strong><p>{agreement.capabilityId} · 数据：{agreement.dataScopes.join("、")} · 动作：{agreement.allowedActions.join("、")}{agreement.revokedReason ? ` · 原因：${agreement.revokedReason}` : ""}</p></div><span className="assistant-workspace__projection-actions"><em>{agreement.approval}</em> · {agreement.status}{agreement.status === "accepted" && <button type="button" onClick={() => void onRevokeAgreement(agreement.id)}>撤销合同</button>}</span></article>)}{network?.bids.map((bid) => { const delivery = network.deliveries.find((candidate) => candidate.bidId === bid.id); return <article key={bid.id} className="assistant-workspace__projection-item"><div><strong>竞标 {bid.id}</strong><p>{bid.message} · 合同 {bid.agreementId ?? "未绑定"}</p>{delivery?.reason && <small>{delivery.reason}</small>}</div><span className="assistant-workspace__projection-actions"><em>{delivery?.status ?? bid.status}</em>{bid.status === "submitted" && <button type="button" onClick={() => void onAward(bid.id)}>授标</button>}{delivery?.status !== "delivered" && bid.status === "awarded" && <button type="button" onClick={() => void onAward(bid.id)}>重试投递</button>}</span></article>; })}</div>
      {!network?.offers.length && !network?.proposals.length && !network?.capabilityAgreements.length && !network?.bids.length && <p className="assistant-workspace__projection-empty">暂无服务提案、能力合同、竞标或报价。</p>}
    </section>
    <section className="assistant-workspace__projection">
      <div className="assistant-workspace__projection-header"><h3>Authority 撤销审计</h3><span>{network?.authorityRevocations.length ?? 0} 条</span></div>
      {network?.authorityRevocations.length ? <div className="assistant-workspace__projection-list">{network.authorityRevocations.slice().reverse().map((record) => <article key={`${record.authorityId}:${record.sequence}`} className="assistant-workspace__projection-item"><div><strong>{record.kind} · {record.identifier}</strong><p>{record.authorityId} · sequence {record.sequence} · {new Date(record.revokedAt).toLocaleString()}</p></div><span>已回放</span></article>)}</div> : <p className="assistant-workspace__projection-empty">当前没有 Authority 撤销记录。</p>}
    </section>
  </>;
}

function TaskProposalForm({ onCreated, onToast }: { onCreated: () => void; onToast?: (message: string) => void }) {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const activeProject = useProjectsStore((state) => state.projects.find((project) => project.id === state.activeProjectId));
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [capability, setCapability] = useState("general");
  const [mode, setMode] = useState<"personal" | "organization" | "network">("personal");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !objective.trim() || submitting) return;
    setSubmitting(true);
    try {
      await assistantFacade.propose({
        mode,
        title,
        objective,
        capability,
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        dataScopes: mode === "network" ? ["public:brief"] : ["room:personal-room"],
        artifactTypes: ["other"],
        ...(mode === "network" ? { expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() } : {}),
      });
      setTitle("");
      setObjective("");
      onCreated();
    } catch (error) {
      onToast?.(`创建协作任务失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setSubmitting(false);
    }
  };
  return <form className="assistant-workspace__task-form" onSubmit={submit}>
    <div className="assistant-workspace__task-form-header"><div><h3>发起 Buddy 协作</h3><p>个人、组织和开放网络共用同一任务契约；执行、委托与外部副作用仍需后续策略批准。</p>{activeProject && <small>项目上下文：{activeProject.name}{mode === "network" ? " · 需要 Project Room Grant 才能投递" : ""}</small>}</div><span>{mode === "network" ? "local-sandbox" : mode}</span></div>
    <div className="assistant-workspace__task-form-fields"><input aria-label="任务标题" placeholder="任务标题，例如：整理本周会议" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /><select aria-label="协作范围" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="personal">个人 Buddy</option><option value="organization">组织 Buddy</option><option value="network">开放网络</option></select><select aria-label="任务能力" value={capability} onChange={(event) => setCapability(event.target.value)}><option value="general">通用规划</option><option value="calendar">日程</option><option value="research">研究</option><option value="document">文档</option></select><button type="submit" disabled={submitting || !title.trim() || !objective.trim()}>{submitting ? "提交中…" : "提出任务"}</button></div>
    <textarea aria-label="任务目标" placeholder="描述目标、约束和期望交付（只会以摘要/digest 出现在协作投影中）" value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={20000} rows={3} />
  </form>;
}

function TaskList({ tasks, controls, loading, onRequestApproval, onExecute, onControl, onToast }: { tasks: CollaborationSnapshot["tasks"]; controls: CollaborationSnapshot["organization"]["taskControls"]; loading: boolean; onRequestApproval: (taskId: string) => Promise<void>; onExecute: (taskId: string) => Promise<void>; onControl: (taskId: string, action: "pause" | "resume" | "revoke" | "takeover" | "revision") => Promise<void>; onToast?: (message: string) => void }) {
  const controlFor = (taskId: string) => controls.find((control) => control.taskId === taskId);
  const run = async (operation: () => Promise<void>) => { try { await operation(); } catch (error) { onToast?.(`协作操作失败：${String(error).replace(/^Error:\s*/u, "")}`); } };
  return <section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><h3>任务时间线</h3><span>{loading ? "读取中…" : `${tasks.length} 个任务`}</span></div>{tasks.length === 0 && !loading ? <p className="assistant-workspace__projection-empty">还没有本地协作任务，先提出一个任务。</p> : <div className="assistant-workspace__projection-list">{tasks.slice(0, 12).map((task) => { const control = controlFor(task.taskId); const executable = (task.mode === "personal" || task.mode === "organization") && (task.status === "proposed" || task.status === "authorized"); return <article key={task.taskId} className="assistant-workspace__projection-item"><div><strong>{task.title}</strong><p>{task.taskId} · {task.mode === "organization" ? "组织 Buddy" : "个人 Buddy"}{task.projectId ? ` · 项目 ${task.projectId}` : " · 独立任务"} · {new Date(task.updatedAt).toLocaleString()}{control ? ` · ${control.state}` : ""}</p></div><span className="assistant-workspace__projection-actions">{executable && <button type="button" onClick={() => void run(() => onExecute(task.taskId))}>执行并验证</button>}<button type="button" onClick={() => void run(() => onRequestApproval(task.taskId))}>申请审批</button><button type="button" onClick={() => void run(() => onControl(task.taskId, "takeover"))}>接管</button><button type="button" onClick={() => void run(() => onControl(task.taskId, control?.state === "paused" ? "resume" : "pause"))}>{control?.state === "paused" ? "恢复" : "暂停"}</button></span></article>; })}</div>}</section>;
}

function WorkflowProposalForm({ personalBuddyId, organizationMembers, onCreated, onToast }: { personalBuddyId: string; organizationMembers: CollaborationSnapshot["organization"]["members"]; onCreated: () => void; onToast?: (message: string) => void }) {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const [title, setTitle] = useState("");
  const [firstObjective, setFirstObjective] = useState("");
  const [secondObjective, setSecondObjective] = useState("");
  const [mode, setMode] = useState<"personal" | "organization">("personal");
  const [firstAgentId, setFirstAgentId] = useState(personalBuddyId);
  const [secondAgentId, setSecondAgentId] = useState(personalBuddyId);
  const [submitting, setSubmitting] = useState(false);
  const activeOrganizationMembers = organizationMembers.filter((member) => member.active);
  const agentOptions = mode === "organization"
    ? activeOrganizationMembers.map((member) => ({ id: member.identity.id, label: member.identity.displayName }))
    : [{ id: personalBuddyId, label: "当前 Personal Buddy" }];
  useEffect(() => {
    if (mode === "personal") {
      setFirstAgentId(personalBuddyId);
      setSecondAgentId(personalBuddyId);
      return;
    }
    const fallback = agentOptions[0]?.id ?? "";
    if (!agentOptions.some((agent) => agent.id === firstAgentId)) setFirstAgentId(fallback);
    if (!agentOptions.some((agent) => agent.id === secondAgentId)) setSecondAgentId(fallback);
  }, [agentOptions, firstAgentId, mode, personalBuddyId, secondAgentId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !firstObjective.trim() || !secondObjective.trim() || submitting) return;
    setSubmitting(true);
    try {
      await assistantFacade.proposeWorkflow({
        title,
        mode,
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        nodes: [
          { id: "prepare", title: `${title} · 准备`, objective: firstObjective, capability: "general", agentRef: { type: mode === "organization" ? "organization-buddy" : "personal-buddy", id: firstAgentId } },
          { id: "deliver", title: `${title} · 交付`, objective: secondObjective, capability: "general", dependsOn: ["prepare"], agentRef: { type: mode === "organization" ? "organization-buddy" : "personal-buddy", id: secondAgentId } },
        ],
      });
      setTitle("");
      setFirstObjective("");
      setSecondObjective("");
      onCreated();
    } catch (error) {
      onToast?.(`创建工作流失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setSubmitting(false);
    }
  };
  return <form className="assistant-workspace__task-form" onSubmit={submit}>
    <div className="assistant-workspace__task-form-header"><div><h3>编排多 Buddy 工作流</h3><p>节点复用同一任务契约，依赖节点等待前置验收；失败会阻断后续节点。</p></div><span>{mode === "organization" ? "组织 DAG" : "个人 DAG"}</span></div>
    <div className="assistant-workspace__task-form-fields"><input aria-label="工作流标题" placeholder="工作流标题" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /><select aria-label="工作流范围" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="personal">个人 Buddy</option><option value="organization">组织 Buddy</option></select><input aria-label="准备节点目标" placeholder="准备节点目标" value={firstObjective} onChange={(event) => setFirstObjective(event.target.value)} /><select aria-label="准备节点 Buddy" value={firstAgentId} onChange={(event) => setFirstAgentId(event.target.value)} disabled={agentOptions.length === 0}><option value="">选择准备节点 Buddy</option>{agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select><input aria-label="交付节点目标" placeholder="交付节点目标" value={secondObjective} onChange={(event) => setSecondObjective(event.target.value)} /><select aria-label="交付节点 Buddy" value={secondAgentId} onChange={(event) => setSecondAgentId(event.target.value)} disabled={agentOptions.length === 0}><option value="">选择交付节点 Buddy</option>{agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select><button type="submit" disabled={submitting || !title.trim() || !firstObjective.trim() || !secondObjective.trim() || !firstAgentId || !secondAgentId}>{submitting ? "提交中…" : "提出工作流"}</button></div>
  </form>;
}

function WorkflowList({ workflows, onExecute }: { workflows: CollaborationSnapshot["workflows"]; onExecute: (workflowId: string) => Promise<void> }) {
  return <section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><h3>工作流 DAG</h3><span>{workflows.length} 个</span></div>{workflows.length === 0 ? <p className="assistant-workspace__projection-empty">暂无多节点工作流。</p> : <div className="assistant-workspace__projection-list">{workflows.slice(0, 12).map((workflow) => <article key={workflow.workflowId} className="assistant-workspace__projection-item"><div><strong>{workflow.title}</strong><p>{workflow.mode === "organization" ? "组织 Buddy" : "个人 Buddy"} · {workflow.nodes.map((node) => `${node.id}:${node.status}`).join(" → ")}</p></div><span className="assistant-workspace__projection-actions"><em>{workflow.status}</em>{(workflow.status === "proposed" || workflow.status === "failed" || workflow.status === "blocked" || workflow.status === "rejected") && <button type="button" onClick={() => void onExecute(workflow.workflowId)}>执行</button>}</span></article>)}</div>}</section>;
}

function IdentityEditor({ snapshot, onToast }: { snapshot: CollaborationSnapshot | null; onToast?: (message: string) => void }) {
  const identity = snapshot?.identity;
  const [handle, setHandle] = useState(identity?.handle ?? "");
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setHandle(identity?.handle ?? ""); setDisplayName(identity?.displayName ?? ""); }, [identity?.handle, identity?.displayName]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await assistantFacade.updateIdentity({
        ...(handle.trim() && handle.trim() !== identity?.handle ? { handle: handle.trim() } : {}),
        ...(displayName.trim() && displayName.trim() !== identity?.displayName ? { displayName: displayName.trim() } : {}),
      });
      onToast?.("个人身份已更新");
    } catch (error) {
      onToast?.(`更新身份失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally { setBusy(false); }
  };
  if (!identity) return null;
  return (
    <section className="assistant-workspace__projection assistant-workspace__identity-editor">
      <div className="assistant-workspace__projection-header">
        <div>
          <h3>我的个人 Buddy</h3>
          <p>ID 和 owner 不可改；handle 与显示名可改，改后跨重启保留（持久化到 userData 下的 openbuddy/buddy-identity.json）。</p>
        </div>
        <span className="assistant-workspace__projection-tag">@{identity.handle}</span>
      </div>
      <form className="assistant-workspace__member-form" onSubmit={(event) => void submit(event)}>
        <input aria-label="Buddy ID" value={identity.id} readOnly disabled />
        <input aria-label="句柄" placeholder="handle" value={handle} onChange={(event) => setHandle(event.target.value)} disabled={busy} />
        <input aria-label="显示名" placeholder="显示名" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy || (handle.trim() === identity.handle && displayName.trim() === identity.displayName)}>{busy ? "保存中…" : "保存"}</button>
      </form>
    </section>
  );
}

function RoomList({ rooms, organizationMembers, loading, onAddMember, onRemoveMember, onToast }: { rooms: CollaborationSnapshot["rooms"]; organizationMembers: CollaborationSnapshot["organization"]["members"]; loading: boolean; onAddMember: (input: { roomId: string; principalId: string; role?: "member" | "observer" | "agent" }) => Promise<void>; onRemoveMember: (input: { roomId: string; principalId: string }) => Promise<void>; onToast?: (message: string) => void }) {
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedPrincipalId, setSelectedPrincipalId] = useState("");
  const [role, setRole] = useState<"member" | "observer" | "agent">("member");
  const [busy, setBusy] = useState(false);
  const selectedRoom = rooms.find((entry) => entry.room.id === (selectedRoomId || rooms.find((candidate) => candidate.room.kind === "team")?.room.id));
  const teamRooms = rooms.filter((entry) => entry.room.kind === "team");
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const roomId = selectedRoom?.room.id;
    if (!roomId || !selectedPrincipalId || busy) return;
    setBusy(true);
    try { await onAddMember({ roomId, principalId: selectedPrincipalId, role }); } catch (error) { onToast?.(`加入 Room 失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setBusy(false); }
  };
  const remove = async (roomId: string, principalId: string) => {
    if (busy) return;
    setBusy(true);
    try { await onRemoveMember({ roomId, principalId }); } catch (error) { onToast?.(`移出 Room 失败：${String(error).replace(/^Error:\s*/u, "")}`); } finally { setBusy(false); }
  };
  return <><section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><div><h3>可访问 Rooms</h3><p>个人 Room 保持私有；只有组织 Project Room 可管理成员，避免泄露个人上下文。</p></div><span>{loading ? "读取中…" : `${rooms.length} 个`}</span></div>{rooms.map((entry) => <article key={entry.room.id} className="assistant-workspace__projection-item"><div><strong>{entry.room.handle}</strong><p>{entry.room.kind} · {entry.memberCount} 位成员 · {entry.channelCount} 个频道 · {entry.room.id}</p></div><span>{entry.room.visibility}</span></article>)}</section><section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><h3>组织 Project Room 成员</h3><span>{teamRooms.length} 个可管理</span></div>{teamRooms.length === 0 ? <p className="assistant-workspace__projection-empty">暂无组织 Project Room；从组织模式项目发起协作后才能管理成员。</p> : <><form className="assistant-workspace__room-member-form" onSubmit={(event) => void add(event)}><select aria-label="组织 Room" value={selectedRoom?.room.id ?? ""} onChange={(event) => setSelectedRoomId(event.target.value)}><option value="">选择 Room</option>{teamRooms.map((entry) => <option key={entry.room.id} value={entry.room.id}>{entry.room.handle}</option>)}</select><select aria-label="Room 成员" value={selectedPrincipalId} onChange={(event) => setSelectedPrincipalId(event.target.value)}><option value="">选择组织成员</option>{organizationMembers.filter((member) => member.active && !(selectedRoom?.members ?? []).some((roomMember) => roomMember.principalId === member.identity.id)).map((member) => <option key={member.identity.id} value={member.identity.id}>{member.identity.displayName}</option>)}</select><select aria-label="Room 角色" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="member">成员</option><option value="observer">观察者</option><option value="agent">Agent</option></select><button type="submit" disabled={busy || !selectedRoom?.room.id || !selectedPrincipalId}>加入 Room</button></form>{teamRooms.map((entry) => <div key={entry.room.id} className="assistant-workspace__room-members"><strong>{entry.room.handle}</strong>{entry.members.map((member) => <span key={member.principalId}>{member.principalId} · {member.role}{member.role !== "owner" && <button type="button" disabled={busy} onClick={() => void remove(entry.room.id, member.principalId)}>移出</button>}</span>)}</div>)}</>}</section></>;
}

function FederatedGrantList({ grants, rooms, organizationMembers, networkPeers, loading, onIssue, onRevoke, onToast }: { grants: NonNullable<CollaborationSnapshot["federatedRoomGrants"]>; rooms: CollaborationSnapshot["rooms"]; organizationMembers: CollaborationSnapshot["organization"]["members"]; networkPeers: CollaborationSnapshot["network"]["peers"]; loading: boolean; onIssue: (input: { projectId: string; roomId: string; principalId: string; providerOrganizationId?: string; taskId?: string; allowedCapabilities: string[]; allowedDataScopes: string[]; allowedActions: string[]; allowedOperations: Array<"endpoint.register" | "task.send" | "events.query">; expiresAt: string }) => Promise<void>; onRevoke: (grantId: string) => Promise<void>; onToast?: (message: string) => void }) {
  const [projectId, setProjectId] = useState("");
  const [roomId, setRoomId] = useState(rooms.find((entry) => entry.room.kind === "team")?.room.id ?? "");
  const [principalId, setPrincipalId] = useState(organizationMembers.find((member) => member.active)?.identity.id ?? networkPeers[0]?.identity.id ?? "");
  const [taskId, setTaskId] = useState("");
  const [capabilities, setCapabilities] = useState("research");
  const [dataScopes, setDataScopes] = useState("public:brief");
  const [actions, setActions] = useState("read:room,write:artifact");
  const [operations, setOperations] = useState<Array<"endpoint.register" | "task.send" | "events.query">>(["events.query"]);
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const principalOptions = [...organizationMembers.filter((member) => member.active).map((member) => ({ id: member.identity.id, label: `${member.identity.displayName} · 组织`, organizationId: member.identity.organizationId })), ...networkPeers.filter((peer) => !organizationMembers.some((member) => member.identity.id === peer.identity.id)).map((peer) => ({ id: peer.identity.id, label: `${peer.identity.displayName} · Peer`, organizationId: peer.identity.organizationId }))];
  const teamRooms = rooms.filter((entry) => entry.room.kind === "team");
  const toggleOperation = (operation: "endpoint.register" | "task.send" | "events.query") => setOperations((current) => current.includes(operation) ? current.filter((value) => value !== operation) : [...current, operation]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId.trim() || !roomId || !principalId || operations.length === 0) return;
    setBusy(true);
    try {
      const principal = principalOptions.find((option) => option.id === principalId);
      await onIssue({ projectId: projectId.trim(), roomId, principalId, ...(principal?.organizationId ? { providerOrganizationId: principal.organizationId } : {}), ...(taskId.trim() ? { taskId: taskId.trim() } : {}), allowedCapabilities: capabilities.split(",").map((value) => value.trim()).filter(Boolean), allowedDataScopes: dataScopes.split(",").map((value) => value.trim()).filter(Boolean), allowedActions: actions.split(",").map((value) => value.trim()).filter(Boolean), allowedOperations: operations, expiresAt: new Date(expiresAt).toISOString() });
      onToast?.("跨 Buddy Room Grant 已签发");
    } catch (error) { onToast?.(`Grant 签发失败：${String(error).replace(/^Error:\s*/u, "")}`); }
    finally { setBusy(false); }
  };
  return <section className="assistant-workspace__projection assistant-workspace__grant-panel">
    <div className="assistant-workspace__projection-header"><div><h3>跨 Buddy Room Grant</h3><p>仅授权精确的项目、Room、主体、能力、数据范围和操作；签名密钥留在主进程。</p></div><span>{loading ? "读取中…" : `${grants.length} 个`}</span></div>
    <form className="assistant-workspace__grant-form" onSubmit={(event) => void submit(event)}>
      <label>项目 ID<input aria-label="Grant 项目 ID" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="project-123" /></label>
      <label>Room<select aria-label="Grant Room" value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">选择项目 Room</option>{teamRooms.map((entry) => <option key={entry.room.id} value={entry.room.id}>{entry.room.handle} · {entry.room.id}</option>)}</select></label>
      <label>主体<select aria-label="Grant 主体" value={principalId} onChange={(event) => setPrincipalId(event.target.value)}><option value="">选择组织成员或 Peer</option>{principalOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.id}</option>)}</select></label>
      <label>任务 ID（task.send 必填）<input aria-label="Grant 任务 ID" value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="task-…" /></label>
      <label>能力（逗号分隔）<input aria-label="Grant 能力" value={capabilities} onChange={(event) => setCapabilities(event.target.value)} /></label>
      <label>数据范围（逗号分隔）<input aria-label="Grant 数据范围" value={dataScopes} onChange={(event) => setDataScopes(event.target.value)} /></label>
      <label>动作（逗号分隔）<input aria-label="Grant 动作" value={actions} onChange={(event) => setActions(event.target.value)} /></label>
      <label>过期时间<input aria-label="Grant 过期时间" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <div className="assistant-workspace__grant-operations"><span>操作</span>{(["endpoint.register", "task.send", "events.query"] as const).map((operation) => <label key={operation}><input type="checkbox" checked={operations.includes(operation)} onChange={() => toggleOperation(operation)} />{operation}</label>)}</div>
      <button type="submit" disabled={busy || !projectId.trim() || !roomId || !principalId || operations.length === 0}>{busy ? "签发中…" : "签发 Grant"}</button>
    </form>
    {grants.length === 0 ? <p className="assistant-workspace__projection-empty">暂无跨组织授权。默认不开放公网或外部副作用。</p> : <div className="assistant-workspace__projection-list">{grants.map((grant) => {
  const isCrossOrg = Boolean(grant.providerOrganizationId && grant.providerOrganizationId !== grant.organizationId);
  return <article key={grant.grantId} className={"assistant-workspace__projection-item assistant-workspace__grant-item" + (isCrossOrg ? " assistant-workspace__grant-item--cross-org" : "")} data-testid={"federated-grant-" + grant.grantId}>
    <div>
      <div className="assistant-workspace__grant-title-row">
        <strong>{grant.projectId} · {grant.roomId}</strong>
        <span className={"assistant-workspace__grant-org-badge" + (isCrossOrg ? " assistant-workspace__grant-org-badge--cross" : "")}>{isCrossOrg ? "跨组织" : "同组织"}</span>
      </div>
      <p>主体：{grant.allowedPrincipals.join("、")} · 能力：{grant.allowedCapabilities.join("、") || "未指定"}</p>
      <p>操作：{grant.allowedOperations.join("、")} · 到期：{new Date(grant.expiresAt).toLocaleString()}</p>
      <p>签发者：{grant.issuerId}</p>
      <p>颁发方组织：{grant.organizationId ?? "未指定"} · 主体组织：{grant.providerOrganizationId ?? "(同颁发方)"}</p>
      <p>数据范围：{grant.allowedDataScopes.join("、") || "未指定"}</p>
      <p>动作：{grant.allowedActions.join("、") || "未指定"}</p>
    </div>
    <div className="assistant-workspace__projection-actions">
      <span className={"assistant-workspace__grant-status assistant-workspace__grant-status--" + grant.status}>{grant.status}</span>
      {grant.status === "active" && <button type="button" onClick={() => void onRevoke(grant.grantId)}>撤销</button>}
    </div>
  </article>;
})}</div>}
  </section>;
}

function CapabilityList({ snapshot, loading }: { snapshot: CollaborationSnapshot | null; loading: boolean }) {
  const manifest = snapshot?.collaborationManifest;
  return <><section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><div><h3>统一协作协议</h3><p>Personal、Organization、Network 共用同一个 Main-owned Runtime 和插件契约。</p></div><span>{manifest?.protocol ?? (loading ? "读取中…" : "未声明")}</span></div>{manifest && <div className="assistant-workspace__manifest"><div><strong>{manifest.pluginId}</strong><span>{manifest.capabilities.length} 项控制面能力</span></div><p>{manifest.capabilities.map((capability) => `${capability.id} · ${capability.transport}`).join("　")}</p><small>{manifest.invariants.join(" · ")}</small></div>}</section><section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><h3>能力合同</h3><span>{loading ? "读取中…" : `${snapshot?.capabilityCards.length ?? 0} 项`}</span></div>{(snapshot?.capabilityCards ?? []).slice(0, 20).map((card) => <article key={card.id} className="assistant-workspace__projection-item"><div><strong>{card.name}</strong><p>{card.source} · 输入：{card.contract.input} · 输出：{card.contract.output}</p></div><span>{card.status}</span></article>)}</section><section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><h3>MCP 工具治理</h3><span>{snapshot?.mcpCapabilities?.length ?? 0} 项</span></div>{(snapshot?.mcpCapabilities ?? []).slice(0, 20).map((capability) => <article key={`${capability.serverName}:${capability.toolName}`} className="assistant-workspace__projection-item"><div><strong>{capability.serverName} · {capability.toolName}</strong><p>{capability.providerId} · 房间：{capability.roomId} · 数据：{capability.dataScopes.join("、")}</p><p>动作：{capability.allowedActions.join("、")}</p></div><span>{capability.status} · 需审批</span></article>)}</section><section className="assistant-workspace__policy"><h3>当前策略交集</h3><p>数据范围：{snapshot?.policy.dataScopes.join("、") ?? "读取中…"}</p><p>允许动作：{snapshot?.policy.allowedActions.join("、") ?? "读取中…"}</p><p>禁止动作：{snapshot?.policy.forbiddenActions.join("、") ?? "读取中…"}</p><strong>外部副作用：需审批 · 过期：{snapshot ? new Date(snapshot.policy.expiresAt).toLocaleTimeString() : "读取中…"}</strong></section></>;
}

function ActivityList({ activity, loading }: { activity: CollaborationSnapshot["activity"]; loading: boolean }) {
  return <section className="assistant-workspace__projection"><div className="assistant-workspace__projection-header"><h3>脱敏事件审计</h3><span>{loading ? "读取中…" : `${activity.length} 条`}</span></div>{activity.length === 0 && !loading ? <p className="assistant-workspace__projection-empty">暂无协作事件。</p> : <div className="assistant-workspace__projection-list">{activity.map((event) => <article key={event.id} className="assistant-workspace__projection-item"><div><strong>{event.kind}</strong><p>{event.subject ?? "无标题"} · {new Date(event.createdAt).toLocaleString()}</p></div><span>{event.roomId ?? "scope"}</span></article>)}</div>}</section>;
}

function AssistantWorkspaceHeader({ section, onGoHome, tabs }: { section: AssistantWorkspaceSection; onGoHome?: () => void; tabs: ReactNode }) {
  const meta = SECTION_META[section];
  return (
    <header className="assistant-workspace__header">
      <div className="assistant-workspace__header-main">
        <button type="button" className="assistant-workspace__back" onClick={onGoHome}>
          助理
        </button>
        <ChevronRight size={15} />
        <div>
          <h1>{meta.title}</h1>
          <p>{meta.description}</p>
        </div>
      </div>
      <div className="assistant-workspace__header-tabs">
        {tabs}
      </div>
    </header>
  );
}

function WorkspaceCard({ title, description, value, loading }: { title: string; description: string; value: string; loading: boolean }) {
  return (
    <article className="assistant-workspace__card">
      <h3>{title}</h3>
      <p>{description}</p>
      <span className="assistant-workspace__card-status">{loading ? "读取中…" : value}</span>
    </article>
  );
}

function cardValue(section: AssistantWorkspaceSection, index: number, snapshot: CollaborationSnapshot | null): string {
  if (!snapshot) return "暂不可用";
  if (section === "inbox") return [`${snapshot.inbox.filter((item) => !item.read && item.kind === "approval").length} 项`, `${snapshot.inbox.filter((item) => !item.read && item.kind === "verification").length} 项`, `${snapshot.inbox.filter((item) => item.kind === "failed").length} 项`][index];
  if (section === "tasks") return [`${snapshot.tasks.filter((task) => ["progress", "running"].includes(task.status)).length} 个`, `${snapshot.tasks.filter((task) => task.status === "proposed").length} 个`, `${snapshot.tasks.filter((task) => ["failed", "disputed"].includes(task.status)).length} 个`][index];
  if (section === "workflows") return [`${snapshot.workflows.filter((workflow) => workflow.status === "running" || workflow.status === "paused").length} 个`, `${snapshot.workflows.filter((workflow) => workflow.status === "proposed").length} 个`, `${snapshot.workflows.filter((workflow) => ["blocked", "failed"].includes(workflow.status)).length} 个`][index];
  if (section === "rooms") return [`${snapshot.rooms.filter((entry) => entry.room.kind === "personal").length} 个`, `${snapshot.rooms.filter((entry) => entry.room.kind === "team").length} 个`, `${snapshot.rooms.filter((entry) => entry.room.kind === "open").length} 个`][index];
  if (section === "capabilities") return [`${snapshot.capabilities.local + snapshot.capabilities.room} 项`, `${snapshot.capabilities.local + snapshot.capabilities.room} 个 scope`, `${snapshot.capabilities.organization} 项`][index];
  if (section === "evidence") return [`${snapshot.activity.filter((event) => event.kind === "artifact.created").length} 项`, `${snapshot.activity.filter((event) => event.kind.includes("verify")).length} 项`, `${snapshot.activity.length} 条`][index];
  if (section === "network") return [`${snapshot.network.peers.length} 个`, `${snapshot.network.proposals.length} 个`, `${snapshot.network.bids.filter((bid) => bid.status === "submitted").length} 个`][index];
  return ["1 个", "0 个", "0 个"][index];
}

function cardTitle(section: AssistantWorkspaceSection, index: number): string {
  const titles: Record<AssistantWorkspaceSection, string[]> = {
    inbox: ["待我审批", "待我验收", "失败与阻塞"],
    tasks: ["运行中", "待委托", "需要接管"],
    workflows: ["运行中", "待执行", "需要接管"],
    calendar: ["本周事件", "冲突检查", "同步状态"],
    rooms: ["个人 Room", "组织 Room", "开放网络"],
    buddies: ["我的助理", "组织 Buddy", "外部 Buddy"],
    network: ["已知 Peer", "服务提案", "待处理竞标"],
    capabilities: ["可用能力", "数据范围", "审批策略"],
    evidence: ["交付物", "验证结果", "活动审计"],
    recovery: ["待确认", "待终止", "已关闭"],
  };
  return titles[section][index];
}

function cardDescription(section: AssistantWorkspaceSection, index: number): string {
  const descriptions: Record<AssistantWorkspaceSection, string[]> = {
    inbox: ["外部发布和高风险动作进入人工审批。", "查看未被独立 verifier 验收的产物。", "重试、撤销或请求人工接管。"],
    tasks: ["按状态查看多 Buddy 协作进度。", "发现能力并生成最小权限委托。", "接管暂停、失联或超时任务。"],
    workflows: ["按 DAG 节点查看工作流进度。", "查看待执行的多步流程。", "接管暂停、失联或超时流程。"],
    calendar: ["读取当前周的本地事件。", "在工作台中提示时间重叠。", "外部日历连接需单独授权。"],
    rooms: ["个人上下文和本地工具默认留在本机。", "按组织角色、Room 和知识域隔离。", "通过 Relay 连接已知 Buddy。"],
    buddies: ["管理本地 Personal Buddy。", "管理组织内可协作成员。", "管理未来已建立信任的 Peer。"],
    network: ["只显示显式信任边界内的 Peer。", "使用 digest，不共享完整 prompt。", "仅在本地沙盒中流转，不触发付款。"],
    capabilities: ["查看 schema、SOP 和验收条件。", "只暴露授权的 context refs。", "user ∩ org ∩ task ∩ capability。"],
    evidence: ["来源、执行结果和可交付 Artifact。", "独立 verifier 或人工验收状态。", "从 append-only event log 重建。"],
    recovery: ["由 host 抢占签名后显式确认完成。", "由 host 抢占签名后显式标记终止。", "已持久化 receipt，host 视为关闭。"],
  };
  return descriptions[section][index];
}
