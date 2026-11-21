/**
 * 工具渲染器分类 —— 对齐 WorkBuddy `agent-ui/components/tools/renderers`
 * (execute-command / defer-execute / send-message / image-gen / visualizer /
 * team-create / team-delete / agent-mail)。
 *
 * 把任意工具 kind 映射到「渲染器类型」(renderer):决定用哪种紧凑视图展示。
 * 纯函数,便于单测。渲染组件按 renderer 选择不同布局。
 */
import type { ToolCallView } from "./transcript";

export type ToolRenderer =
  | "default" // 通用紧凑行(既有 ToolCallCard)
  | "command" // run_terminal_command / bash
  | "edit" // edit / write
  | "read" // read_file / list_dir / grep
  | "search" // web_search / web_fetch
  | "task" // task / 子代理派发（agent 原生子代理工具 kind=task）
  | "defer-execute" // 延迟/批量执行(defer)
  | "send-message" // 发消息/通知(IM/邮件)
  | "image-gen" // 图像生成
  | "visualizer" // 内嵌可视化组件(widget)
  | "team-create" // 创建团队/多 agent
  | "team-delete"
  | "team-status" // 查询团队状态
  | "agent-mail"
  | "specialist" // 专家列表卡
  | "unknown";

const RENDERER_MAP: Array<{ test: RegExp; renderer: ToolRenderer }> = [
  { test: /^(run_terminal_command|bash|execute_command|shell|terminal)$/i, renderer: "command" },
  { test: /^(edit|write|write_file|edit_file|multi_edit)$/i, renderer: "edit" },
  { test: /^(read_file|read|list_dir|ls|grep|glob)$/i, renderer: "read" },
  { test: /^(web_search|web_fetch|search)$/i, renderer: "search" },
  // 的 /task/ 子串匹配，放在 defer 之前。
  { test: /^task$/i, renderer: "task" },
  { test: /defer/i, renderer: "defer-execute" },
  { test: /^(send_message|notify|post_message)$/i, renderer: "send-message" },
  { test: /^(image_gen|image_generation|generate_image|dall|text_to_image|draw)$/i, renderer: "image-gen" },
  { test: /^(visualizer|widget|render_widget|inline_view)$/i, renderer: "visualizer" },
  // （openbuddy__create_team，现行的内嵌 MCP server 路径）都识别。
  { test: /^(openbuddy__)?(team_create|create_team)$/i, renderer: "team-create" },
  { test: /^(openbuddy__)?(team_delete|delete_team)$/i, renderer: "team-delete" },
  { test: /^(openbuddy__)?(team_status|status)$/i, renderer: "team-status" },
  { test: /^(agent_mail|send_mail|email)$/i, renderer: "agent-mail" },
  { test: /^(specialist|expert_list)$/i, renderer: "specialist" },
];

/** 按 kind 判定渲染器类型。 */
export function detectToolRenderer(kind: string): ToolRenderer {
  const k = (kind || "").trim();
  if (!k) return "unknown";
  for (const { test, renderer } of RENDERER_MAP) {
    if (test.test(k)) return renderer;
  }
  return "default";
}

/** 渲染器的人类可读标签。 */
export function rendererLabel(renderer: ToolRenderer): string {
  switch (renderer) {
    case "command":
      return "终端命令";
    case "edit":
      return "文件编辑";
    case "read":
      return "文件读取";
    case "search":
      return "网络搜索";
    case "task":
      return "子代理";
    case "defer-execute":
      return "延迟执行";
    case "send-message":
      return "发送消息";
    case "image-gen":
      return "图像生成";
    case "visualizer":
      return "可视化";
    case "team-create":
      return "创建团队";
    case "team-delete":
      return "解散团队";
    case "team-status":
      return "团队状态";
    case "agent-mail":
      return "邮件";
    case "specialist":
      return "专家";
    case "default":
      return "工具";
    default:
      return "未知工具";
  }
}

/** 渲染器图标(emoji,简化)。 */
export function rendererIcon(renderer: ToolRenderer): string {
  switch (renderer) {
    case "command":
      return "⌨️";
    case "edit":
      return "✏️";
    case "read":
      return "📖";
    case "search":
      return "🔍";
    case "task":
      return "🤖";
    case "defer-execute":
      return "⏳";
    case "send-message":
      return "💬";
    case "image-gen":
      return "🎨";
    case "visualizer":
      return "📊";
    case "team-create":
      return "👥";
    case "team-delete":
      return "🗑️";
    case "team-status":
      return "📋";
    case "agent-mail":
      return "📧";
    case "specialist":
      return "🧑‍🔬";
    default:
      return "🔧";
  }
}

/**
 * 从工具调用的 title + rawInput 提取「摘要」(用于专用渲染器的紧凑展示)。
 *  - send-message:提取消息内容
 *  - image-gen:提取 prompt
 *  - team-create:提取成员数
 *  - defer-execute:提取待执行命令数
 *  其余返回 title。
 */
export function summarizeTool(tc: ToolCallView, renderer: ToolRenderer): string {
  const raw = tc.rawInput as Record<string, unknown> | undefined;
  switch (renderer) {
    case "send-message": {
      const msg = raw?.message ?? raw?.text ?? raw?.content;
      return typeof msg === "string" ? msg.slice(0, 80) : tc.title;
    }
    case "image-gen": {
      const prompt = raw?.prompt ?? raw?.description;
      return typeof prompt === "string" ? `生成图像:${prompt.slice(0, 60)}` : tc.title;
    }
    case "task": {
      const type = raw?.subagent_type ?? raw?.subagentType ?? raw?.type;
      const desc = raw?.description ?? raw?.prompt;
      const typeStr = typeof type === "string" ? type : "";
      const descStr =
        typeof desc === "string" ? (desc.length > 50 ? desc.slice(0, 50) + "…" : desc) : tc.title;
      return typeStr ? `派发子代理 (${typeStr}): ${descStr}` : descStr;
    }
    case "team-create": {
      const members = raw?.members;
      const n = Array.isArray(members) ? members.length : raw?.memberCount;
      return typeof n === "number" ? `创建团队(${n} 名成员)` : tc.title;
    }
    case "defer-execute": {
      const cmds = raw?.commands ?? raw?.items;
      const n = Array.isArray(cmds) ? cmds.length : undefined;
      return typeof n === "number" ? `延迟执行 ${n} 条命令` : tc.title;
    }
    default:
      return tc.title;
  }
}
