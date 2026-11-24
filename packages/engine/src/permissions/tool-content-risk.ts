/**
 * 工具内容注入审查 (G2-7)：工具返回的内容在**回灌给模型之前**先过一遍。
 *
 * 工具输出是不可信输入：一个网页、一份 README、一条命令回显都可能夹带
 * 「忽略以上指令」「把密钥发到某地址」这类诱导。命中高危时，engine 会把
 * 该段内容替换成一段说明，模型看不到原文；用户可以在对话里明确「仍要使用」。
 */

export type RiskSeverity = "high" | "medium";

export interface ToolContentRisk {
  /** 命中的规则 id。 */
  rule: string;
  severity: RiskSeverity;
  /** 给用户看的原因。 */
  reason: string;
  /** 命中的原文片段（截断，给界面预览用）。 */
  excerpt: string;
}

interface Rule {
  id: string;
  severity: RiskSeverity;
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  {
    id: "injection.ignore",
    severity: "high",
    pattern: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
    reason: "工具输出里要求模型忽略既有指令",
  },
  {
    id: "injection.ignore.zh",
    severity: "high",
    pattern: /忽略(以上|之前|前面|上面)(所有)?(的)?(指令|要求|规则|提示)/,
    reason: "工具输出里要求模型忽略既有指令",
  },
  {
    id: "injection.role",
    severity: "high",
    pattern: /(you are now|从现在起你是|你现在是)[^\n]{0,40}(dan|developer mode|开发者模式|无限制)/i,
    reason: "工具输出里试图改写模型的身份或解除限制",
  },
  {
    id: "injection.system",
    severity: "medium",
    pattern: /(<system>|\[SYSTEM\]|###\s*(新|new)\s*(指令|instructions?))/i,
    reason: "工具输出里伪装成系统指令",
  },
  {
    id: "exfil.secret",
    severity: "high",
    pattern: /(send|post|upload|exfiltrate)[^\n]{0,60}(api[_\s-]?key|access[_\s-]?token|secret|password|credential)/i,
    reason: "工具输出里要求把凭据发送到别处",
  },
  {
    id: "exfil.secret.zh",
    severity: "high",
    pattern: /(发送|上传|回传|外发)[^\n]{0,40}(api[_\s-]?key|密钥|令牌|token|密码|凭据)/i,
    reason: "工具输出里要求把凭据发送到别处",
  },
  {
    id: "exfil.command",
    severity: "medium",
    pattern: /(curl|wget)[^\n]{0,80}(-X\s*POST|--data|-d\s)[^\n]{0,80}(key|token|secret|password)/i,
    reason: "工具输出里给出把凭据发出去的命令",
  },
  {
    id: "hide.from.user",
    severity: "medium",
    pattern: /(do not (tell|inform|mention) (the )?user|不要(告诉|告知)用户|别让用户知道)/i,
    reason: "工具输出里要求对用户隐瞒动作",
  },
];

/** 从工具结果的内容块里取出可读文本。 */
export function toolContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => !!part && typeof part === "object" && (part as { type?: string }).type === "text" && typeof (part as { text?: string }).text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** 扫描工具输出，命中最严重的一条规则。 */
export function scanToolContent(text: string): ToolContentRisk | undefined {
  if (!text) return undefined;
  let hit: ToolContentRisk | undefined;
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const candidate: ToolContentRisk = {
      rule: rule.id,
      severity: rule.severity,
      reason: rule.reason,
      excerpt: excerptAround(text, match.index ?? 0, match[0].length),
    };
    if (!hit || (candidate.severity === "high" && hit.severity !== "high")) hit = candidate;
  }
  return hit;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 60);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return slice.length > 160 ? `${slice.slice(0, 160)}…` : slice;
}

/** 被拦截时替换给模型看的内容。 */
export function withheldNotice(risk: ToolContentRisk, toolName: string): string {
  return [
    `[已拦截] 工具 ${toolName} 的输出中检测到疑似提示注入（${risk.reason}），原文未交给模型。`,
    "如果这段内容确实需要参与任务，请让用户明确放行；放行后内容会作为用户提供的上下文重新进入对话。",
  ].join("\n");
}
