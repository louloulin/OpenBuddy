/**
 * 技能安全审查 (G2-4)：读已安装技能的 SKILL.md，按危险模式给出风险等级。
 *
 * 这是**本地静态审查**：只读文本、按规则匹配，不执行技能里的任何命令。
 * 高危 = 技能正文里出现会破坏机器或提权的命令；中危 = 会外发数据或读敏感文件。
 */

export type RiskLevel = "high" | "medium" | "low";

export interface SkillFinding {
  /** 规则 id（用于 i18n 与测试断言）。 */
  rule: string;
  level: Exclude<RiskLevel, "low">;
  /** 命中所在行号（1 起）。 */
  line: number;
  /** 命中行的原文（截断）。 */
  text: string;
}

export interface SkillScan {
  level: RiskLevel;
  findings: SkillFinding[];
}

interface Rule {
  id: string;
  level: Exclude<RiskLevel, "low">;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { id: "destructive.rm", level: "high", pattern: /\brm\s+-[a-z]*[rR][a-z]*\s+/ },
  { id: "destructive.disk", level: "high", pattern: /\bmkfs\b|\bdd\s+if=|\bdiskutil\b/ },
  { id: "privilege.sudo", level: "high", pattern: /\bsudo\b|\bdoas\b/ },
  { id: "exec.pipe", level: "high", pattern: /(curl|wget)[^|\n]*\|\s*(sudo\s+)?(ba|z|d)?sh\b/ },
  { id: "exec.eval", level: "high", pattern: /\beval\s*[\("'`$]/ },
  { id: "exec.base64", level: "high", pattern: /base64\s+(-d|--decode)[^|\n]*\|\s*(ba|z)?sh\b/ },
  { id: "exec.forkbomb", level: "high", pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
  { id: "perm.chmod777", level: "high", pattern: /\bchmod\s+(-R\s+)?777\b/ },
  { id: "net.external", level: "medium", pattern: /https?:\/\/[^\s)"'`]+/ },
  { id: "git.push", level: "medium", pattern: /\bgit\s+push\b/ },
  { id: "publish.npm", level: "medium", pattern: /\bnpm\s+publish\b|\btwine\s+upload\b/ },
  { id: "secret.env", level: "medium", pattern: /\.env(\.local|\.production)?\b|\.aws\/credentials\b|credentials\.json\b/ },
  { id: "secret.ssh", level: "medium", pattern: /~\/\.ssh\b|\/\.ssh\/id_[a-z0-9]+/ },
  { id: "secret.export", level: "medium", pattern: /\bexport\s+[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/ },
];

/** 扫描技能正文，返回风险等级与命中项。 */
export function scanSkillContent(content: string): SkillScan {
  const findings: SkillFinding[] = [];
  content.split(/\r?\n/).forEach((raw, index) => {
    const text = raw.trim();
    if (!text || text.startsWith("#")) return;
    for (const rule of RULES) {
      if (!rule.pattern.test(text)) continue;
      findings.push({
        rule: rule.id,
        level: rule.level,
        line: index + 1,
        text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      });
      break; // 一行只报最严重的一条，避免同一行刷屏
    }
  });
  const level: RiskLevel = findings.some((item) => item.level === "high")
    ? "high"
    : findings.length
      ? "medium"
      : "low";
  return { level, findings };
}

/** 技能的审查目标文件：优先 SKILL.md，其次 README.md。 */
export function skillManifestPath(skillPath: string): string {
  return `${skillPath.replace(/[\\/]+$/, "")}/SKILL.md`;
}
