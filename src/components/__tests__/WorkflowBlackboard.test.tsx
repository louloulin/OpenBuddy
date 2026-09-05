import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { computeWorkflowLevels, WorkflowBlackboard } from "@openbuddy/ui-workbench";
import type { CollaborationSnapshot } from "@/lib/agent/assistant-facade";

type Workflow = CollaborationSnapshot["workflows"][number];

function makeNode(overrides: Partial<Workflow["nodes"][number]>, index: number): Workflow["nodes"][number] {
  return {
    id: overrides.id ?? `node-${index}`,
    taskId: `task-${index}`,
    dependsOn: overrides.dependsOn ?? [],
    title: overrides.title ?? `Node ${index}`,
    status: overrides.status ?? "pending",
    agentRef: overrides.agentRef,
    providerId: overrides.providerId,
    capability: overrides.capability,
    projectId: overrides.projectId,
    roomId: overrides.roomId,
    dataScopes: overrides.dataScopes,
    sideEffectIntentId: overrides.sideEffectIntentId,
    sideEffectFingerprint: overrides.sideEffectFingerprint,
    execution: overrides.execution,
    reason: overrides.reason,
  };
}

function makeWorkflow(overrides: Partial<Workflow>): Workflow {
  return {
    workflowId: overrides.workflowId ?? "wf-1",
    title: overrides.title ?? "Sample workflow",
    mode: overrides.mode ?? "organization",
    projectId: overrides.projectId,
    status: overrides.status ?? "running",
    nodes: overrides.nodes ?? [makeNode({ id: "a", title: "Alpha", status: "accepted" }, 0)],
    control: overrides.control,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

const noopAsync = async () => {};

describe("computeWorkflowLevels", () => {
  it("assigns level 0 to nodes without dependencies", () => {
    const wf = makeWorkflow({ nodes: [makeNode({ id: "a" }, 0), makeNode({ id: "b" }, 1)] });
    const levels = computeWorkflowLevels(wf);
    expect(levels.find((l) => l.id === "a")?.level).toBe(0);
    expect(levels.find((l) => l.id === "b")?.level).toBe(0);
  });

  it("assigns monotonically increasing levels along dependencies", () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode({ id: "root" }, 0),
        makeNode({ id: "mid", dependsOn: ["root"] }, 1),
        makeNode({ id: "leaf", dependsOn: ["mid"] }, 2),
      ],
    });
    const levels = computeWorkflowLevels(wf);
    expect(levels.find((l) => l.id === "root")?.level).toBe(0);
    expect(levels.find((l) => l.id === "mid")?.level).toBe(1);
    expect(levels.find((l) => l.id === "leaf")?.level).toBe(2);
  });

  it("breaks cycles without infinite recursion", () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode({ id: "a", dependsOn: ["b"] }, 0),
        makeNode({ id: "b", dependsOn: ["a"] }, 1),
      ],
    });
    const levels = computeWorkflowLevels(wf);
    const unique = new Set(levels.map((l) => l.level));
    expect(unique.size).toBeGreaterThanOrEqual(1);
    expect(levels.length).toBe(2);
  });

  it("increments row counter so siblings in same level do not overlap", () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode({ id: "x" }, 0),
        makeNode({ id: "y" }, 1),
        makeNode({ id: "z" }, 2),
      ],
    });
    const levels = computeWorkflowLevels(wf);
    const rows = levels.map((l) => l.row);
    expect(new Set(rows).size).toBe(3);
  });
});

describe("WorkflowBlackboard", () => {
  it("renders empty state when there are no workflows", () => {
    render(
      <WorkflowBlackboard
        workflows={[]}
        onExecute={noopAsync}
        onControl={noopAsync}
      />,
    );
    expect(screen.getByText(/还没有工作流/)).toBeTruthy();
  });

  it("renders one node per workflow entry with correct status class", () => {
    const wf = makeWorkflow({
      workflowId: "wf-render",
      nodes: [
        makeNode({ id: "n1", title: "Plan", status: "accepted" }, 0),
        makeNode({ id: "n2", title: "Build", status: "running", dependsOn: ["n1"] }, 1),
      ],
    });
    render(<WorkflowBlackboard workflows={[wf]} onExecute={noopAsync} onControl={noopAsync} />);
    expect(screen.getByTestId("workflow-blackboard-node-n1")).toBeTruthy();
    expect(screen.getByTestId("workflow-blackboard-node-n2")).toBeTruthy();
    expect(screen.getByTestId("workflow-blackboard-node-n1").className).toMatch(/workflow-blackboard__node--accepted/);
    expect(screen.getByTestId("workflow-blackboard-node-n2").className).toMatch(/workflow-blackboard__node--running/);
  });

  it("draws an SVG path for each dependency edge", () => {
    const wf = makeWorkflow({
      workflowId: "wf-edges",
      nodes: [
        makeNode({ id: "a", status: "accepted" }, 0),
        makeNode({ id: "b", dependsOn: ["a"], status: "running" }, 1),
      ],
    });
    const { container } = render(<WorkflowBlackboard workflows={[wf]} onExecute={noopAsync} onControl={noopAsync} />);
    const edges = container.querySelectorAll(".workflow-blackboard__edge");
    expect(edges.length).toBe(1);
  });

  it("shows accepted/total ratio in the progress label", () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode({ id: "a", status: "accepted" }, 0),
        makeNode({ id: "b", status: "accepted" }, 1),
        makeNode({ id: "c", status: "running" }, 2),
      ],
    });
    render(<WorkflowBlackboard workflows={[wf]} onExecute={noopAsync} onControl={noopAsync} />);
    expect(screen.getByText(new RegExp("2/3 已验收"))).toBeTruthy();
  });

  it("selects a node and reveals its detail panel", () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode({
          id: "detail",
          title: "Detail Node",
          status: "accepted",
          providerId: "provider-A",
          capability: "code:review",
          roomId: "room-1",
          execution: {
            taskId: "t-1",
            status: "accepted",
            verifierId: "verifier-1",
            artifactIds: ["a1", "a2"],
            evidenceCount: 3,
            bundleDigest: "digest-xyz",
          },
        }, 0),
      ],
    });
    render(
      <WorkflowBlackboard
        workflows={[wf]}
        personalProviderId="provider-A"
        onExecute={noopAsync}
        onControl={noopAsync}
      />,
    );
    fireEvent.click(screen.getByTestId("workflow-blackboard-node-detail"));
    const body = screen.getByTestId("workflow-blackboard-detail-body");
    expect(within(body).getByText("Detail Node")).toBeTruthy();
    expect(within(body).getByText(/code:review/)).toBeTruthy();
    expect(within(body).getByText(/verifier-1/)).toBeTruthy();
    expect(within(body).getByText(/digest-xyz/)).toBeTruthy();
    expect(within(body).getByText(/独立验证人/)).toBeTruthy();
  });

  it("highlights independent verifiers (verifier !== provider)", () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode({
          id: "verify-mismatch",
          title: "Cross-check",
          status: "accepted",
          providerId: "provider-A",
          execution: {
            taskId: "t-2",
            status: "accepted",
            verifierId: "verifier-B",
            artifactIds: ["a1"],
            evidenceCount: 1,
          },
        }, 0),
      ],
    });
    render(
      <WorkflowBlackboard
        workflows={[wf]}
        personalProviderId="personal-1"
        onExecute={noopAsync}
        onControl={noopAsync}
      />,
    );
    const node = screen.getByTestId("workflow-blackboard-node-verify-mismatch");
    expect(node.className).toMatch(/workflow-blackboard__node--independent/);
    fireEvent.click(node);
    const body = screen.getByTestId("workflow-blackboard-detail-body");
    expect(within(body).getByText(/独立验证人 ≠ 当前 Provider/)).toBeTruthy();
  });

  it("toggles node selection off when clicking the same node twice", () => {
    const wf = makeWorkflow({ nodes: [makeNode({ id: "toggle" }, 0)] });
    render(<WorkflowBlackboard workflows={[wf]} onExecute={noopAsync} onControl={noopAsync} />);
    const node = screen.getByTestId("workflow-blackboard-node-toggle");
    fireEvent.click(node);
    expect(screen.getByTestId("workflow-blackboard-detail-body")).toBeTruthy();
    fireEvent.click(node);
    expect(screen.queryByTestId("workflow-blackboard-detail-body")).toBeNull();
  });

  it("invokes onExecute and onControl callbacks", async () => {
    const wf = makeWorkflow({
      workflowId: "wf-callbacks",
      status: "proposed",
      nodes: [makeNode({ id: "n1", status: "pending" }, 0)],
    });
    const onExecute = vi.fn(noopAsync);
    const onControl = vi.fn(noopAsync);
    render(
      <WorkflowBlackboard
        workflows={[wf]}
        onExecute={onExecute}
        onControl={onControl}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onExecute).toHaveBeenCalledWith("wf-callbacks");
    expect(onControl).toHaveBeenCalledWith("wf-callbacks", "cancel");
  });
});
