/**
 * 项目「连接器 / 专家 / 技能」本地占位拾取器 + 模板选项 + 配置行。
 *
 * WorkBuddy 的 +添加 走云端注册表/市场（connector registry、expert/skill picker），
 * OpenBuddy 没有这些后端，故这里用本地预设候选列表做多选演示；模板下拉与列表页
 * 「从模版创建」共用 TEMPLATE_OPTIONS，保证两处一致。
 */
import { useEffect, useRef, useState } from "react";
import type { RefItem } from "@/features/projects/state/projects-store";
import { CheckIcon } from "@openbuddy/ui/icon/icons/index";

/** 本地占位候选（演示用，非云端数据）。 */
export const PICKER_OPTIONS: Record<"connectors" | "experts" | "skills", RefItem[]> = { connectors: [], experts: [], skills: [] };

export interface ProjectTemplate {
  id: string;
  title: string;
  desc: string;
  instructions: string;
  connectors: RefItem[];
  experts: RefItem[];
  skills: RefItem[];
}

/** 模板选项（自定义空白 + 5 业务模板，文案取自目标截图）。 */
export const TEMPLATE_OPTIONS: ProjectTemplate[] = [
  {
    id: "custom",
    title: "自定义",
    desc: "空白项目",
    instructions: "",
    connectors: [],
    experts: [],
    skills: [],
  },
  {
    id: "product-requirements",
    title: "产品需求全流程",
    desc: "从需求规划、PRD 到研发测试验收",
    instructions:
      "你是一名产品负责人助理。请覆盖需求收集、PRD 撰写、研发排期与测试验收全流程，输出结构化文档与待办清单。",
    connectors: [],
    experts: [],
    skills: [],
  },
  {
    id: "market-research",
    title: "市场调研与竞品分析",
    desc: "深度调研、竞品拆解、报告评审",
    instructions:
      "你是一名市场研究分析师。请进行深度调研与竞品拆解，并产出结构清晰、可评审的调研报告。",
    connectors: [],
    experts: [],
    skills: [],
  },
  {
    id: "team-knowledge-base",
    title: "团队知识库",
    desc: "持续沉淀 SOP、经验和 FAQ",
    instructions:
      "你是一名知识管理助理。请帮助沉淀 SOP、经验与 FAQ，维护并结构化团队知识库。",
    connectors: [],
    experts: [],
    skills: [],
  },
  {
    id: "project-delivery",
    title: "项目交付",
    desc: "管理客户需求、计划、风险和周报",
    instructions:
      "你是一名项目交付经理。请管理客户需求、计划、风险与周报，推动项目按期高质量交付。",
    connectors: [],
    experts: [],
    skills: [],
  },
  {
    id: "bug-tracking-qa",
    title: "Bug 跟踪/测试验收",
    desc: "持续跟踪Bug、统一测试用例和验收结论",
    instructions:
      "你是一名 QA 助理。请持续跟踪 Bug、统一测试用例，并给出明确的验收结论。",
    connectors: [],
    experts: [],
    skills: [],
  },
];

export function getTemplate(id?: string): ProjectTemplate | undefined {
  return TEMPLATE_OPTIONS.find((t) => t.id === id);
}

/** 配置行：label + (可选) + 右「+ 添加」+ 已选 chip（对照目标新建弹窗/配置抽屉）。 */
export function ConfigRow({
  label,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  items: RefItem[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="proj-config-row">
      <div className="proj-config-row__head">
        <span className="proj-config-row__label">
          {label} <span className="proj-config-row__opt">（项目级绑定暂未开放）</span>
        </span>
        <button type="button" className="proj-config-row__add" disabled title="请在资源页管理实际技能和 MCP 配置" onClick={onAdd}>
          + 添加
        </button>
      </div>
      {items.length > 0 && (
        <div className="proj-config-row__chips">
          {items.map((it) => (
            <span key={it.id} className="proj-chip">
              <span className="proj-chip__name">{it.name}（仅本地引用）</span>
              <button
                type="button"
                className="proj-chip__x"
                aria-label={`移除 ${it.name}`}
                onClick={() => onRemove(it.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 通用本地占位多选弹窗。 */
export function RefPickerDialog({
  title,
  options,
  selected,
  onCancel,
  onConfirm,
}: {
  title: string;
  options: RefItem[];
  selected: RefItem[];
  onCancel: () => void;
  onConfirm: (items: RefItem[]) => void;
}) {
  const [picked, setPicked] = useState<RefItem[]>(selected);
  const toggle = (o: RefItem) =>
    setPicked((prev) =>
      prev.some((p) => p.id === o.id) ? prev.filter((p) => p.id !== o.id) : [...prev, o],
    );

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="create-colleague-dialog proj-picker-dialog" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="create-colleague-header">
          <h3>添加{title}</h3>
          <button className="create-colleague-close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="create-colleague-body proj-picker-body">
          {options.map((o) => {
            const on = picked.some((p) => p.id === o.id);
            return (
              <button
                key={o.id}
                type="button"
                className={`proj-picker-item${on ? " proj-picker-item--on" : ""}`}
                onClick={() => toggle(o)}
              >
                <span className={`proj-picker-check${on ? " proj-picker-check--on" : ""}`}>
                  {on && <CheckIcon size="sm" />}
                </span>
                <span>{o.name}</span>
              </button>
            );
          })}
        </div>
        <div className="create-colleague-footer">
          <button className="btn btn--ghost" onClick={onCancel}>取消</button>
          <button className="btn btn--primary" onClick={() => onConfirm(picked)}>确定</button>
        </div>
      </div>
    </div>
  );
}

/** 点击外部关闭的简单 hook（模板下拉用）。 */
export function useOutsideClose<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose]);
  return ref;
}
