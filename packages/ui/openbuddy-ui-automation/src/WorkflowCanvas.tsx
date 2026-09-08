/**
 * WorkflowCanvas.tsx — visual workflow step editor.
 *
 * Phase 5 (UI 差距补齐) sub-item F: 对标 WorkBuddy 的工作流可视化编辑。把自动化
 * 工作流步骤渲染为垂直节点图（触发/动作/条件/输出），支持点击选中与上移/下移
 * 重排。import 后即可可视化编辑。
 *
 * 纯展示组件：输入为 `steps`（纯数据），输出为可交互的节点画布。颜色复用
 * `--wb-*` 令牌，零新 CSS 概念。
 */
export type WorkflowStepKind = "trigger" | "action" | "condition" | "output";

export interface WorkflowStep {
  id: string;
  title: string;
  kind: WorkflowStepKind;
  description?: string;
}

export interface WorkflowCanvasProps {
  steps: WorkflowStep[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, direction: "up" | "down") => void;
  className?: string;
}

export function workflowStepLabel(kind: WorkflowStepKind): string {
  switch (kind) {
    case "trigger":
      return "触发";
    case "action":
      return "动作";
    case "condition":
      return "条件";
    case "output":
      return "输出";
    default:
      return kind;
  }
}

export function WorkflowCanvas({ steps, activeId, onSelect, onMove, className }: WorkflowCanvasProps) {
  if (steps.length === 0) return null;

  return (
    <div
      className={"workflow-canvas" + (className ? ` ${className}` : "")}
      role="list"
      aria-label="工作流步骤"
      data-testid="workflow-canvas"
    >
      {steps.map((step, index) => {
        const active = step.id === activeId;
        const first = index === 0;
        const last = index === steps.length - 1;
        return (
          <div key={step.id} className="workflow-canvas__step" role="listitem">
            {!first && <div className="workflow-canvas__connector" aria-hidden="true" />}
            <div
              className={"workflow-canvas__node" + (active ? " workflow-canvas__node--active" : "")}
              data-testid={`workflow-node-${step.id}`}
            >
              <button
                type="button"
                className="workflow-canvas__node-main"
                onClick={() => onSelect?.(step.id)}
                title={step.description ?? step.title}
              >
                <span className={`workflow-canvas__kind workflow-canvas__kind--${step.kind}`}>
                  {workflowStepLabel(step.kind)}
                </span>
                <span className="workflow-canvas__title">{step.title}</span>
              </button>
              <div className="workflow-canvas__controls">
                <button
                  type="button"
                  className="workflow-canvas__move"
                  disabled={first}
                  aria-label="上移"
                  onClick={() => onMove?.(step.id, "up")}
                  data-testid={`workflow-move-up-${step.id}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="workflow-canvas__move"
                  disabled={last}
                  aria-label="下移"
                  onClick={() => onMove?.(step.id, "down")}
                  data-testid={`workflow-move-down-${step.id}`}
                >
                  ↓
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
