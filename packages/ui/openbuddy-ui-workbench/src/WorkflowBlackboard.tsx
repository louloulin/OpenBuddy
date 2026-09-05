import { useCallback, useMemo, useState } from "react";
import type { CollaborationSnapshot } from "@/lib/agent/assistant-facade";

type WorkflowStatus = CollaborationSnapshot["workflows"][number]["status"];
type NodeStatus = CollaborationSnapshot["workflows"][number]["nodes"][number]["status"];

const NODE_WIDTH = 232;
const NODE_HEIGHT = 96;
const COLUMN_GAP = 56;
const ROW_GAP = 18;
const BOARD_PADDING = 24;
const STATUS_BORDER: Record<NodeStatus, string> = {
  pending: "var(--wb-border-default, #d8dde6)",
  running: "#9bc7ff",
  accepted: "var(--wb-color-primary, #2f6fed)",
  rejected: "#c96666",
  failed: "#c96666",
  blocked: "#c96666",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "待执行",
  running: "进行中",
  accepted: "已验收",
  rejected: "被拒",
  failed: "失败",
  blocked: "被阻塞",
};

const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  proposed: "已提案",
  running: "运行中",
  paused: "已暂停",
  cancelled: "已取消",
  accepted: "已完成",
  rejected: "被拒",
  failed: "失败",
  blocked: "被阻塞",
};

export interface WorkflowBlackboardProps {
  workflows: CollaborationSnapshot["workflows"];
  personalProviderId?: string;
  onExecute: (workflowId: string) => Promise<void>;
  onControl: (
    workflowId: string,
    action: "pause" | "resume" | "cancel" | "takeover" | "revision",
  ) => Promise<void>;
}

interface WorkflowLevelEntry {
  id: string;
  level: number;
  row: number;
}

export function computeWorkflowLevels(
  workflow: CollaborationSnapshot["workflows"][number],
): WorkflowLevelEntry[] {
  const levels = new Map<string, { level: number; row: number }>();
  const order = workflow.nodes.map((node) => node.id);
  const nodeById = new Map(order.map((id, index) => [id, workflow.nodes[index]!]));
  const visiting = new Set<string>();
  const rowCounters = new Map<number, number>();
  const visit = (id: string): { level: number; row: number } => {
    const cached = levels.get(id);
    if (cached) return cached;
    if (visiting.has(id)) {
      const row = rowCounters.get(0) ?? 0;
      rowCounters.set(0, row + 1);
      const entry = { level: 0, row };
      levels.set(id, entry);
      return entry;
    }
    visiting.add(id);
    const node = nodeById.get(id);
    if (!node) {
      visiting.delete(id);
      const row = rowCounters.get(0) ?? 0;
      rowCounters.set(0, row + 1);
      const entry = { level: 0, row };
      levels.set(id, entry);
      return entry;
    }
    let level = 0;
    for (const dep of node.dependsOn) {
      const target = visit(dep);
      if (target.level + 1 > level) level = target.level + 1;
    }
    visiting.delete(id);
    const row = rowCounters.get(level) ?? 0;
    rowCounters.set(level, row + 1);
    const entry = { level, row };
    levels.set(id, entry);
    return entry;
  };
  for (const id of order) visit(id);
  return order.map((id) => {
    const fallback = { level: 0, row: 0 };
    const entry = levels.get(id) ?? fallback;
    return { id, level: entry.level, row: entry.row };
  });
}

function progressFor(workflow: CollaborationSnapshot["workflows"][number]) {
  const total = workflow.nodes.length;
  const accepted = workflow.nodes.filter((node) => node.status === "accepted").length;
  const running = workflow.nodes.filter((node) => node.status === "running").length;
  const failed = workflow.nodes.filter(
    (node) => node.status === "failed" || node.status === "rejected",
  ).length;
  return { total, accepted, running, failed };
}

function verifierMismatch(
  workflow: CollaborationSnapshot["workflows"][number],
  personalProviderId: string | undefined,
) {
  return (nodeId: string) => {
    const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !node.execution) return false;
    if (personalProviderId === undefined) return false;
    const verifier = node.execution.verifierId;
    return Boolean(verifier && verifier !== personalProviderId && verifier !== node.providerId);
  };
}

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  row: number;
}

function layoutBoard(workflow: CollaborationSnapshot["workflows"][number]) {
  const positions = new Map<string, NodePosition>();
  const levels = computeWorkflowLevels(workflow);
  const byLevel = new Map<number, WorkflowLevelEntry[]>();
  for (const entry of levels) {
    const list = byLevel.get(entry.level) ?? [];
    list.push(entry);
    byLevel.set(entry.level, list);
  }
  for (const entry of levels) {
    const x = BOARD_PADDING + entry.level * (NODE_WIDTH + COLUMN_GAP);
    const y = BOARD_PADDING + entry.row * (NODE_HEIGHT + ROW_GAP);
    positions.set(entry.id, {
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      level: entry.level,
      row: entry.row,
    });
  }
  return { positions, levels, byLevel };
}

function EdgePath({ from, to }: { from: NodePosition; to: NodePosition }) {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const midX = (startX + endX) / 2;
  return (
    <path
      d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
      fill="none"
      className="workflow-blackboard__edge"
      markerEnd="url(#workflow-blackboard-arrow)"
    />
  );
}

export function WorkflowBlackboard({
  workflows,
  personalProviderId,
  onExecute,
  onControl,
}: WorkflowBlackboardProps) {
  const [selected, setSelected] = useState<{ workflowId: string; nodeId: string } | null>(null);

  if (workflows.length === 0) {
    return <p className="assistant-workspace__projection-empty">还没有工作流；在上方表单创建一个 DAG。</p>;
  }

  return (
    <div className="workflow-blackboard-list">
      {workflows.slice(0, 8).map((workflow) => (
        <WorkflowBlackboardCard
          key={workflow.workflowId}
          workflow={workflow}
          personalProviderId={personalProviderId}
          onExecute={onExecute}
          onControl={onControl}
          selectedNodeId={selected?.workflowId === workflow.workflowId ? selected.nodeId : null}
          onSelectNode={(nodeId) =>
            setSelected(nodeId ? { workflowId: workflow.workflowId, nodeId } : null)
          }
        />
      ))}
    </div>
  );
}

interface CardProps {
  workflow: CollaborationSnapshot["workflows"][number];
  personalProviderId?: string;
  onExecute: (workflowId: string) => Promise<void>;
  onControl: (
    workflowId: string,
    action: "pause" | "resume" | "cancel" | "takeover" | "revision",
  ) => Promise<void>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

function WorkflowBlackboardCard({
  workflow,
  personalProviderId,
  onExecute,
  onControl,
  selectedNodeId,
  onSelectNode,
}: CardProps) {
  const { positions, levels, byLevel } = useMemo(() => layoutBoard(workflow), [workflow]);
  const progress = progressFor(workflow);
  const isIndependentVerifier = useMemo(
    () => verifierMismatch(workflow, personalProviderId),
    [workflow, personalProviderId],
  );

  const maxLevel = useMemo(() => {
    let max = 0;
    levels.forEach((entry) => {
      if (entry.level > max) max = entry.level;
    });
    return max;
  }, [levels]);

  const maxRow = useMemo(() => {
    let max = 0;
    levels.forEach((entry) => {
      if (entry.row > max) max = entry.row;
    });
    return max;
  }, [levels]);

  const boardWidth = BOARD_PADDING * 2 + (maxLevel + 1) * NODE_WIDTH + maxLevel * COLUMN_GAP;
  const boardHeight = BOARD_PADDING * 2 + (maxRow + 1) * NODE_HEIGHT + maxRow * ROW_GAP;

  const acceptedRatio = progress.total === 0 ? 0 : progress.accepted / progress.total;
  const runningRatio = progress.total === 0 ? 0 : progress.running / progress.total;
  const failedRatio = progress.total === 0 ? 0 : progress.failed / progress.total;

  const nodeById = useMemo(() => new Map(workflow.nodes.map((node) => [node.id, node])), [workflow]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;

  const edges = useMemo(() => {
    const list: Array<{ from: NodePosition; to: NodePosition }> = [];
    for (const node of workflow.nodes) {
      const target = positions.get(node.id);
      if (!target) continue;
      for (const dep of node.dependsOn) {
        const source = positions.get(dep);
        if (!source) continue;
        list.push({ from: source, to: target });
      }
    }
    return list;
  }, [positions, workflow]);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      onSelectNode(selectedNodeId === nodeId ? null : nodeId);
    },
    [onSelectNode, selectedNodeId],
  );

  return (
    <article
      className={`workflow-blackboard workflow-blackboard--${workflow.status}`}
      data-testid={`workflow-blackboard-${workflow.workflowId}`}
    >
      <header className="workflow-blackboard__header">
        <div className="workflow-blackboard__heading">
          <strong>{workflow.title}</strong>
          <p>
            {workflow.mode === "organization" ? "组织 Buddy" : "个人 Buddy"} · {workflow.nodes.length} 个节点 · 状态：
            {WORKFLOW_STATUS_LABEL[workflow.status] ?? workflow.status}
            {workflow.control ? `（${workflow.control.state}）` : ""}
          </p>
        </div>
        <div className="workflow-blackboard__actions">
          {(workflow.status === "proposed" ||
            workflow.status === "failed" ||
            workflow.status === "blocked" ||
            workflow.status === "rejected" ||
            workflow.status === "paused") && (
            <button type="button" onClick={() => void onExecute(workflow.workflowId)}>
              {workflow.status === "paused" ? "恢复" : "执行"}
            </button>
          )}
          {workflow.status === "running" && (
            <button type="button" onClick={() => void onControl(workflow.workflowId, "pause")}>
              暂停
            </button>
          )}
          {workflow.status !== "cancelled" && workflow.status !== "accepted" && (
            <button type="button" onClick={() => void onControl(workflow.workflowId, "cancel")}>
              取消
            </button>
          )}
        </div>
      </header>
      <div
        className="workflow-blackboard__progress"
        role="progressbar"
        aria-valuenow={progress.accepted}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-label={`已验收 ${progress.accepted} / ${progress.total}`}
      >
        <span
          className="workflow-blackboard__progress-bar workflow-blackboard__progress-bar--accepted"
          style={{ flexGrow: acceptedRatio }}
        />
        <span
          className="workflow-blackboard__progress-bar workflow-blackboard__progress-bar--running"
          style={{ flexGrow: runningRatio }}
        />
        <span
          className="workflow-blackboard__progress-bar workflow-blackboard__progress-bar--failed"
          style={{ flexGrow: failedRatio }}
        />
        <em className="workflow-blackboard__progress-label">
          {progress.accepted}/{progress.total} 已验收 · {progress.running} 进行 · {progress.failed} 失败
        </em>
      </div>
      <div className="workflow-blackboard__layout">
        <div
          className="workflow-blackboard__board"
          style={{ width: boardWidth, height: boardHeight }}
          data-testid={`workflow-blackboard-board-${workflow.workflowId}`}
        >
          <svg
            className="workflow-blackboard__svg"
            width={boardWidth}
            height={boardHeight}
            viewBox={`0 0 ${boardWidth} ${boardHeight}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="workflow-blackboard-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((edge, index) => (
              <EdgePath key={index} from={edge.from} to={edge.to} />
            ))}
          </svg>
          {levels.map((entry) => {
            const node = nodeById.get(entry.id);
            if (!node) return null;
            const position = positions.get(entry.id);
            if (!position) return null;
            const isSelected = selectedNodeId === node.id;
            const highlight = isIndependentVerifier(node.id);
            const status = node.status;
            const stateClass = `workflow-blackboard__node--${status}`;
            const selectedClass = isSelected ? " workflow-blackboard__node--selected" : "";
            const verifierClass = highlight ? " workflow-blackboard__node--independent" : "";
            return (
              <button
                key={node.id}
                type="button"
                className={`workflow-blackboard__node ${stateClass}${selectedClass}${verifierClass}`}
                style={{
                  left: position.x,
                  top: position.y,
                  width: position.width,
                  height: position.height,
                  borderColor: STATUS_BORDER[status],
                }}
                data-testid={`workflow-blackboard-node-${node.id}`}
                onClick={() => handleSelectNode(node.id)}
              >
                <strong>{node.title || node.id}</strong>
                <span className="workflow-blackboard__node-id">{node.id}</span>
                <em>{STATUS_LABEL[status] ?? status}</em>
                {node.execution && (
                  <small className="workflow-blackboard__node-meta">
                    交付 {node.execution.artifactIds.length} · 证据 {node.execution.evidenceCount}
                  </small>
                )}
              </button>
            );
          })}
        </div>
        <aside
          className={
            "workflow-blackboard__detail" +
            (selectedNode ? "" : " workflow-blackboard__detail--empty")
          }
          aria-live="polite"
          data-testid={`workflow-blackboard-detail-${workflow.workflowId}`}
        >
          {selectedNode ? (
            <NodeDetail
              node={selectedNode}
              workflowId={workflow.workflowId}
              independentVerifier={isIndependentVerifier(selectedNode.id)}
              onClose={() => onSelectNode(null)}
            />
          ) : (
            <p>点击任意节点查看交付物、验证人、依赖和拒绝原因。</p>
          )}
        </aside>
      </div>
      <div className="workflow-blackboard__legend" aria-hidden="true">
        {Array.from(byLevel.entries()).map(([level, list]) => (
          <span key={level}>第 {level + 1} 层 · {list.length} 节点</span>
        ))}
      </div>
    </article>
  );
}

function NodeDetail({
  node,
  workflowId,
  independentVerifier,
  onClose,
}: {
  node: CollaborationSnapshot["workflows"][number]["nodes"][number];
  workflowId: string;
  independentVerifier: boolean;
  onClose: () => void;
}) {
  return (
    <div className="workflow-blackboard__detail-body" data-testid="workflow-blackboard-detail-body">
      <header>
        <strong>{node.title || node.id}</strong>
        <button type="button" onClick={onClose} aria-label="关闭节点详情">
          ×
        </button>
      </header>
      <dl className="workflow-blackboard__detail-meta">
        <dt>节点 ID</dt>
        <dd>{node.id}</dd>
        <dt>任务 ID</dt>
        <dd>{node.taskId}</dd>
        <dt>状态</dt>
        <dd>{STATUS_LABEL[node.status] ?? node.status}</dd>
        <dt>所属工作流</dt>
        <dd>{workflowId}</dd>
        {node.capability && (
          <>
            <dt>能力</dt>
            <dd>{node.capability}</dd>
          </>
        )}
        {node.providerId && (
          <>
            <dt>Provider</dt>
            <dd>{node.providerId}</dd>
          </>
        )}
        {node.roomId && (
          <>
            <dt>Room</dt>
            <dd>{node.roomId}</dd>
          </>
        )}
        <dt>依赖</dt>
        <dd>{node.dependsOn.length === 0 ? "无（起始节点）" : node.dependsOn.join(", ")}</dd>
        {node.agentRef && (
          <>
            <dt>Buddy</dt>
            <dd>
              {node.agentRef.id} · {node.agentRef.type}
            </dd>
          </>
        )}
        {node.reason && (
          <>
            <dt>原因</dt>
            <dd>{node.reason}</dd>
          </>
        )}
        {node.execution && (
          <>
            <dt>执行结果</dt>
            <dd>
              <ul className="workflow-blackboard__detail-list">
                <li>状态：{node.execution.status}</li>
                <li>验证：{node.execution.verifierId ?? "未记录"}</li>
                <li>交付物：{node.execution.artifactIds.length}</li>
                <li>证据：{node.execution.evidenceCount}</li>
                {node.execution.bundleDigest && <li>bundleDigest：{node.execution.bundleDigest}</li>}
                {node.execution.executionRef && (
                  <li>executionRef：{node.execution.executionRef.taskId ?? "?"}</li>
                )}
              </ul>
            </dd>
            {independentVerifier && (
              <dd className="workflow-blackboard__detail-warning">
                ⚠ 独立验证人 ≠ 当前 Provider，避免自我验收
              </dd>
            )}
          </>
        )}
      </dl>
    </div>
  );
}
