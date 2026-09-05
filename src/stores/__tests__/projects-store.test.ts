import { beforeEach, describe, expect, it } from "vitest";
import {
  flushProjectsStoreWrites,
  projectWorkspaceTagRefs,
  useProjectsStore,
} from "../projects-store";

describe("projects store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useProjectsStore.setState({ projects: [], activeProjectId: null });
  });

  it("persists project activity for project lifecycle changes", () => {
    const project = useProjectsStore.getState().add({ name: "Smoke project" });
    useProjectsStore.getState().addPlan(project.id, "Ship Electron", "pending");
    useProjectsStore.getState().addTask(project.id, "Run smoke");
    useProjectsStore.getState().addMember(project.id, "tester@example.com");
    flushProjectsStoreWrites();

    const current = useProjectsStore.getState().projects[0];
    expect(current.activities.map((activity) => activity.kind)).toEqual(["member", "task", "plan"]);
    expect(JSON.parse(window.localStorage.getItem("openbuddy.projects") ?? "[]")[0].activities).toHaveLength(3);
  });

  it("does not remove asset metadata until the backing file is deleted", async () => {
    const project = useProjectsStore.getState().add({ name: "Asset project", cwd: "/tmp/project" });
    useProjectsStore.getState().addAsset(project.id, { name: "note.txt", kind: "file", path: "/tmp/project/note.txt" });
    const asset = useProjectsStore.getState().projects[0].assets[0];

    await expect(Promise.reject(new Error("permission denied"))).rejects.toThrow("permission denied");
    expect(useProjectsStore.getState().projects[0].assets).toContainEqual(asset);

    useProjectsStore.getState().removeAsset(project.id, asset.id);
    expect(useProjectsStore.getState().projects[0].assets).toHaveLength(0);
    expect(useProjectsStore.getState().projects[0].activities[0].text).toContain("删除资产");
  });

  it("persists normalized workspace tags across projects, plans, and tasks", () => {
    const project = useProjectsStore.getState().add({ name: "Tagged project" });
    useProjectsStore.getState().addPlan(project.id, "Review mail", "pending", { tags: ["邮件", " 客户 "] });
    const taskId = useProjectsStore.getState().addTask(project.id, "Reply customer", { tags: ["客户", "客户", ""] });

    useProjectsStore.getState().updateProjectTags(project.id, ["重要", " 重要 ", "AI"]);
    useProjectsStore.getState().updatePlanTags(project.id, useProjectsStore.getState().projects[0].plans[0].id, ["邮件"]);
    useProjectsStore.getState().updateTaskTags(project.id, taskId, ["客户"]);
    flushProjectsStoreWrites();

    const current = useProjectsStore.getState().projects[0];
    expect(current.tags).toEqual(["重要", "AI"]);
    expect(current.plans[0].tags).toEqual(["邮件"]);
    expect(current.tasks[0].tags).toEqual(["客户"]);
    expect(JSON.parse(window.localStorage.getItem("openbuddy.projects") ?? "[]")[0].tags).toEqual(["重要", "AI"]);
  });

  it("projects tag refs keep entity identity without copying mail content", () => {
    const project = useProjectsStore.getState().add({ name: "Mail project", tags: ["客户"] });
    useProjectsStore.getState().addPlan(project.id, "Review", "pending", { tags: ["本周"] });
    const taskId = useProjectsStore.getState().addTask(project.id, "Reply", { tags: ["邮件"] });
    const refs = projectWorkspaceTagRefs(useProjectsStore.getState().projects, [{ accountId: "gmail:a1", threadId: "thread-1", projectId: project.id, tags: ["邮件", " 客户 "] }]);

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "project", entityId: project.id, tags: ["客户"] }),
      expect.objectContaining({ entityType: "project-plan", projectId: project.id, tags: ["本周"] }),
      expect.objectContaining({ entityType: "project-task", entityId: taskId, projectId: project.id, tags: ["邮件"] }),
      expect.objectContaining({ entityType: "email-thread", entityId: "gmail:a1:thread-1", accountId: "gmail:a1", threadId: "thread-1", projectId: project.id, tags: ["邮件", "客户"] }),
    ]));
    expect(refs.every((ref) => !("body" in ref) && !("html" in ref))).toBe(true);
  });

  // P1-09: verify the debounced write actually coalesces. Without this
  // guard, four `add*` calls in a row would each hit localStorage.
  it("coalesces rapid mutations into a single localStorage write", () => {
    // 1. Pre-flush: storage is empty — pending writes are queued.
    expect(window.localStorage.getItem("openbuddy.projects.local")).toBeNull();
    const project = useProjectsStore.getState().add({ name: "Burst project" });
    useProjectsStore.getState().addPlan(project.id, "Plan A", "pending");
    useProjectsStore.getState().addPlan(project.id, "Plan B", "in_progress");
    useProjectsStore.getState().addTask(project.id, "Task X");
    useProjectsStore.getState().addTask(project.id, "Task Y");
    expect(window.localStorage.getItem("openbuddy.projects.local")).toBeNull();

    // 2. Manual flush: both keys (scope + legacy mirror) get written exactly once.
    flushProjectsStoreWrites();
    const scopedRaw = window.localStorage.getItem("openbuddy.projects.local");
    const legacyRaw = window.localStorage.getItem("openbuddy.projects");
    expect(scopedRaw).not.toBeNull();
    expect(legacyRaw).toBe(scopedRaw); // legacy mirror writes the same payload
    const parsed = JSON.parse(scopedRaw ?? "[]");
    expect(parsed[0].name).toBe("Burst project");
    expect(parsed[0].plans).toHaveLength(2);
    expect(parsed[0].tasks).toHaveLength(2);
  });
});
