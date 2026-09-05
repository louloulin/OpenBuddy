import type { CollaborationSnapshot } from "../agent/assistant-facade";

export interface ProjectCollaborationProjection {
  tasks: CollaborationSnapshot["tasks"];
  workflows: CollaborationSnapshot["workflows"];
  grants: NonNullable<CollaborationSnapshot["federatedRoomGrants"]>;
  activity: CollaborationSnapshot["activity"];
  evidenceByTask: ReadonlyMap<string, string>;
}

export function selectProjectCollaboration(
  snapshot: CollaborationSnapshot | null | undefined,
  projectId: string,
): ProjectCollaborationProjection {
  if (!snapshot || !projectId) {
    return { tasks: [], workflows: [], grants: [], activity: [], evidenceByTask: new Map() };
  }

  const tasks = snapshot.tasks.filter((task) => task.projectId === projectId);
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const activity = snapshot.activity.filter((event) => event.taskId !== undefined && taskIds.has(event.taskId));
  const evidenceByTask = new Map<string, string>();

  for (const event of activity) {
    if (!event.taskId || !event.kind.includes("evidence")) continue;
    evidenceByTask.set(event.taskId, event.kind === "task.evidence_verified" ? "已独立验收" : "有验收记录");
  }

  return {
    tasks,
    workflows: (snapshot.workflows ?? []).filter((workflow) => workflow.projectId === projectId),
    grants: (snapshot.federatedRoomGrants ?? []).filter((grant) => grant.projectId === projectId),
    activity,
    evidenceByTask,
  };
}
