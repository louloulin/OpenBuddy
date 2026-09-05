import { useCallback, useEffect, useMemo, useState } from "react";
import { assistantFacade, type CollaborationSnapshot } from "@/lib/agent/assistant-facade";
import { selectProjectCollaboration } from "@/lib/collaboration/collaboration-projection";
import { useProjectsStore } from "@/stores/projects-store";

type CollaborationMode = "personal" | "organization" | "network";

export function ProjectCollaborationTab({ projectId, projectName, onToast }: { projectId: string; projectName: string; onToast?: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [capability, setCapability] = useState("general");
  const [mode, setMode] = useState<CollaborationMode>("personal");
  const [workflowMode, setWorkflowMode] = useState<"personal" | "organization">("personal");
  const [agentId, setAgentId] = useState("");
  const [workflowTitle, setWorkflowTitle] = useState("");
  const [workflowPrepare, setWorkflowPrepare] = useState("");
  const [workflowDeliver, setWorkflowDeliver] = useState("");
  const [workflowPrepareAgentId, setWorkflowPrepareAgentId] = useState("");
  const [workflowDeliverAgentId, setWorkflowDeliverAgentId] = useState("");
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const addProjectTask = useProjectsStore((state) => state.addTask);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await assistantFacade.snapshot());
    } catch (error) {
      onToast?.(`项目协作读取失败：${String(error).replace(/^Error:\s*/u, "")}`);
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
  }, [projectId, refresh]);

  const projectProjection = useMemo(() => selectProjectCollaboration(snapshot, projectId), [projectId, snapshot]);
  const { tasks, workflows, grants, evidenceByTask } = projectProjection;
  const agentOptions = useMemo(() => {
    if (mode === "network") return [];
    if (mode === "personal") return snapshot?.identity ? [{ id: snapshot.identity.id, label: snapshot.identity.displayName }] : [];
    return (snapshot?.organization.members ?? [])
      .filter((member) => member.active)
      .map((member) => ({ id: member.identity.id, label: member.identity.displayName }));
  }, [mode, snapshot]);
  const workflowAgentOptions = useMemo(() => {
    if (workflowMode === "personal") return snapshot?.identity ? [{ id: snapshot.identity.id, label: snapshot.identity.displayName }] : [];
    return (snapshot?.organization.members ?? [])
      .filter((member) => member.active)
      .map((member) => ({ id: member.identity.id, label: member.identity.displayName }));
  }, [snapshot, workflowMode]);
  useEffect(() => {
    if (!agentOptions.some((agent) => agent.id === agentId)) setAgentId(agentOptions[0]?.id ?? "");
  }, [agentId, agentOptions]);
  useEffect(() => {
    if (!workflowAgentOptions.some((agent) => agent.id === workflowPrepareAgentId)) setWorkflowPrepareAgentId(workflowAgentOptions[0]?.id ?? "");
    if (!workflowAgentOptions.some((agent) => agent.id === workflowDeliverAgentId)) setWorkflowDeliverAgentId(workflowAgentOptions[0]?.id ?? "");
  }, [workflowAgentOptions, workflowPrepareAgentId, workflowDeliverAgentId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const taskTitle = title.trim();
    const taskObjective = objective.trim();
    if (!taskTitle || !taskObjective || submitting) return;
    setSubmitting(true);
    try {
    const proposed = await assistantFacade.propose({
        mode,
        title: taskTitle,
        objective: taskObjective,
        capability: capability.trim() || "general",
        projectId,
        contextRefs: [`project:${projectId}:instructions`, `project:${projectId}:selected-resources`],
        artifactTypes: ["brief"],
        ...(agentId && mode !== "network" ? { agentRef: { type: mode === "organization" ? "organization-buddy" : "personal-buddy", id: agentId } } : {}),
        ...(mode === "network" ? { dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() } : {}),
      });
      addProjectTask(projectId, taskTitle, {
        scope: mode === "organization" ? "shared" : "personal",
        source: "buddy",
        collaborationTaskId: proposed.taskId,
        executionRef: proposed.executionRef,
      });
      setTitle("");
      setObjective("");
      onToast?.(`${mode === "organization" ? "组织" : "个人"} Buddy 任务已提出`);
      await refresh();
    } catch (error) {
      onToast?.(`项目协作提交失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    const titleValue = workflowTitle.trim();
    const prepareValue = workflowPrepare.trim();
    const deliverValue = workflowDeliver.trim();
    if (!titleValue || !prepareValue || !deliverValue || workflowSubmitting) return;
    setWorkflowSubmitting(true);
    try {
      await assistantFacade.proposeWorkflow({
        title: titleValue,
        mode: workflowMode,
        projectId,
        nodes: [
          { id: "prepare", title: `${titleValue} · 准备`, objective: prepareValue, capability, projectId, ...(workflowPrepareAgentId ? { agentRef: { type: workflowMode === "organization" ? "organization-buddy" : "personal-buddy", id: workflowPrepareAgentId } } : {}) },
          { id: "deliver", title: `${titleValue} · 交付`, objective: deliverValue, capability, projectId, dependsOn: ["prepare"], ...(workflowDeliverAgentId ? { agentRef: { type: workflowMode === "organization" ? "organization-buddy" : "personal-buddy", id: workflowDeliverAgentId } } : {}) },
        ],
      });
      setWorkflowTitle("");
      setWorkflowPrepare("");
      setWorkflowDeliver("");
      onToast?.(`${workflowMode === "organization" ? "组织" : "个人"} Buddy 工作流已提出`);
      await refresh();
    } catch (error) {
      onToast?.(`项目工作流提交失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setWorkflowSubmitting(false);
    }
  };

  const execute = async (taskId: string, taskMode: CollaborationMode) => {
    try {
      const result = await assistantFacade.execute(taskId);
      onToast?.(`${taskMode === "organization" ? "组织" : "个人"} Buddy ${result.status === "accepted" ? "已完成并验证" : `执行${result.status}`}：${result.evidenceCount} 条证据`);
      await refresh();
    } catch (error) {
      onToast?.(`项目任务执行失败：${String(error).replace(/^Error:\s*/u, "")}`);
    }
  };

  return (
    <div className="pd-collaboration">
      <div className="pd-collaboration__intro">
        <div>
          <h3>项目 Buddy 协作</h3>
          <p>只显示「{projectName}」的协作任务；执行、权限、证据和验证统一由助理协作内核处理。</p>
        </div>
        <span className="pd-collaboration__scope">project:{projectId}</span>
      </div>

      <form className="pd-collaboration__form" onSubmit={(event) => void submit(event)}>
        <input aria-label="Buddy 任务标题" placeholder="委托标题，例如：整理项目周报" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
        <textarea aria-label="Buddy 任务目标" placeholder="描述项目目标、约束和验收要求" value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} maxLength={20_000} />
        <div className="pd-collaboration__form-row">
          <select aria-label="Buddy 类型" value={mode} onChange={(event) => setMode(event.target.value as CollaborationMode)}>
            <option value="personal">个人 Buddy</option>
            <option value="organization">组织 Buddy</option>
            <option value="network">开放网络</option>
          </select>
          <select aria-label="目标 Buddy" value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={agentOptions.length === 0 || mode === "network"}>
            <option value="">{mode === "network" ? "由网络竞标选择" : "自动路由"}</option>
            {agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          </select>
          <select aria-label="Buddy 能力" value={capability} onChange={(event) => setCapability(event.target.value)}>
            <option value="general">通用规划</option>
            <option value="research">研究</option>
            <option value="document">文档</option>
            <option value="calendar">日程</option>
          </select>
          <button type="submit" disabled={submitting || !title.trim() || !objective.trim()}>{submitting ? "提交中…" : mode === "network" ? "发布网络任务" : "提出协作任务"}</button>
        </div>
      </form>

      <form className="pd-collaboration__form pd-collaboration__workflow-form" onSubmit={(event) => void submitWorkflow(event)}>
        <div className="pd-collaboration__form-heading">
          <div><strong>项目多 Buddy 工作流</strong><p>项目页只绑定当前 `projectId`；依赖、执行、证据和验收仍由统一 Runtime 管理。</p></div>
          <span>{workflowMode === "organization" ? "组织 DAG" : "个人 DAG"}</span>
        </div>
        <input aria-label="项目工作流标题" placeholder="工作流标题，例如：完成项目周报" value={workflowTitle} onChange={(event) => setWorkflowTitle(event.target.value)} maxLength={160} />
        <div className="pd-collaboration__workflow-grid">
          <div><input aria-label="项目准备节点目标" placeholder="准备节点目标" value={workflowPrepare} onChange={(event) => setWorkflowPrepare(event.target.value)} /><select aria-label="项目准备节点 Buddy" value={workflowPrepareAgentId} onChange={(event) => setWorkflowPrepareAgentId(event.target.value)} disabled={workflowAgentOptions.length === 0}><option value="">准备节点自动路由</option>{workflowAgentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></div>
          <div><input aria-label="项目交付节点目标" placeholder="交付节点目标" value={workflowDeliver} onChange={(event) => setWorkflowDeliver(event.target.value)} /><select aria-label="项目交付节点 Buddy" value={workflowDeliverAgentId} onChange={(event) => setWorkflowDeliverAgentId(event.target.value)} disabled={workflowAgentOptions.length === 0}><option value="">交付节点自动路由</option>{workflowAgentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></div>
        </div>
        <div className="pd-collaboration__form-row">
          <select aria-label="工作流 Buddy 类型" value={workflowMode} onChange={(event) => setWorkflowMode(event.target.value as typeof workflowMode)}>
            <option value="personal">个人 Buddy</option>
            <option value="organization">组织 Buddy</option>
          </select>
          <button type="submit" disabled={workflowSubmitting || !workflowTitle.trim() || !workflowPrepare.trim() || !workflowDeliver.trim()}>{workflowSubmitting ? "提交中…" : "提出项目工作流"}</button>
        </div>
      </form>

      <section className="pd-collaboration__list">
        <div className="pd-collaboration__list-head"><h3>项目协作任务</h3><span>{loading ? "读取中…" : `${tasks.length} 个`}</span></div>
        {tasks.length === 0 && !loading ? <div className="pd-empty">当前项目还没有 Buddy 协作任务。</div> : tasks.map((task) => {
          const executable = (task.mode === "personal" || task.mode === "organization") && ["proposed", "authorized"].includes(task.status);
          return (
            <article className="pd-collaboration__item" key={task.taskId}>
              <div>
                <strong>{task.title}</strong>
                <p>{task.mode === "network" ? "开放网络 Buddy" : task.mode === "organization" ? "组织 Buddy" : "个人 Buddy"}{task.agentRef ? ` · ${task.agentRef.id}` : ""} · {task.status}{task.mode === "network" ? " · 需要 Project Room Grant" : ""} · {new Date(task.updatedAt).toLocaleString()}</p>
                {task.executionRef && <div className="pd-collaboration__trace" title="统一执行追踪"><span>执行 {task.executionRef.executionId}</span>{task.executionRef.sessionId && <span>Pi {task.executionRef.sessionId}</span>}{task.executionRef.workflowId && <span>工作流 {task.executionRef.workflowId}</span>}{evidenceByTask.get(task.taskId) && <span className="pd-collaboration__trace--verified">{evidenceByTask.get(task.taskId)}</span>}</div>}
              </div>
              {executable && <button type="button" onClick={() => void execute(task.taskId, task.mode ?? "personal")}>执行并验证</button>}
            </article>
          );
        })}
      </section>

      <section className="pd-collaboration__list pd-collaboration__grants">
        <div className="pd-collaboration__list-head"><div><h3>项目 Room Grant</h3><p className="pd-collaboration__list-note">只显示当前项目的跨 Buddy 授权；精确绑定 Room、主体、能力、数据范围和操作。</p></div><span>{loading ? "读取中…" : `${grants.length} 个`}</span></div>
        {grants.length === 0 && !loading ? <div className="pd-empty">当前项目没有跨 Buddy 授权。</div> : grants.map((grant) => <article className="pd-collaboration__item" key={grant.grantId}><div><strong>{grant.roomId}{grant.taskId ? ` · ${grant.taskId}` : ""}</strong><p>主体：{grant.allowedPrincipals.join("、")} · 能力：{grant.allowedCapabilities.join("、") || "未指定"}</p><div className="pd-collaboration__trace"><span>{grant.status}</span><span>{grant.allowedOperations.join("、")}</span><span>到期 {new Date(grant.expiresAt).toLocaleString()}</span></div></div>{grant.status === "active" && <button type="button" onClick={() => void assistantFacade.revokeFederatedRoomGrant(grant.grantId).then(() => refresh()).catch((error) => onToast?.(`撤销 Grant 失败：${String(error).replace(/^Error:\s*/u, "")}`))}>撤销 Grant</button>}</article>)}
      </section>

      <section className="pd-collaboration__list">
        <div className="pd-collaboration__list-head"><h3>项目工作流</h3><span>{loading ? "读取中…" : `${workflows.length} 个`}</span></div>
        {workflows.length === 0 && !loading ? <div className="pd-empty">当前项目还没有多 Buddy 工作流。</div> : workflows.map((workflow) => (
          <article className="pd-collaboration__item" key={workflow.workflowId}>
            <div>
              <strong>{workflow.title}</strong>
              <p>{workflow.mode === "organization" ? "组织 Buddy" : "个人 Buddy"} · {workflow.status} · {workflow.nodes.length} 个节点</p>
              <div className="pd-collaboration__trace">{workflow.nodes.map((node) => <span key={node.id}>{node.id} · {node.agentRef?.id ?? "自动路由"} · {node.status}{node.execution ? ` · 证据 ${node.execution.evidenceCount}` : ""}</span>)}</div>
            </div>
            {(workflow.status === "proposed" || workflow.status === "failed" || workflow.status === "blocked" || workflow.status === "rejected" || workflow.status === "paused") && <button type="button" onClick={() => void assistantFacade.executeWorkflow(workflow.workflowId).then(() => refresh()).catch((error) => onToast?.(`项目工作流执行失败：${String(error).replace(/^Error:\s*/u, "")}`))}>{workflow.status === "paused" ? "恢复执行" : "执行并验证"}</button>}
          </article>
        ))}
      </section>
    </div>
  );
}
