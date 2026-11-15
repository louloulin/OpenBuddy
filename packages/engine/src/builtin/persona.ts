import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { readBranchState, type BranchReader } from "./session-state.js";
import type { ThinkingLevel } from "../types.js";

/**
 * 专家人设 built-in (20261116-pii W2.2). The expert bound to a session lives in a custom session
 * entry (`openbuddy.expert`), so forks inherit it, reopening restores it and a branch switched to
 * from before the binding does not see it. On every run it:
 *
 * - narrows the run's tool loadout to the expert's allowlist (intersected with whatever the mode
 *   left active), and
 * - appends the persona to the system prompt (`before_agent_start` → `{ systemPrompt }`), never
 *   replacing what Pi, the project context or other built-ins wrote.
 *
 * Model and thinking level are applied at binding time (they are session state Pi persists
 * itself), and again when the leaf moves to a branch with a different binding; see
 * `features/expert.ts` (`followExpert`) and `features/branch-state.ts`.
 */
export const EXPERT_ENTRY = "openbuddy.expert";

/** What a binding entry stores: a snapshot of the expert, so editing or deleting the file later never breaks the session. */
export interface ExpertBinding {
  id: string;
  name: string;
  avatar?: string;
  scope: string;
  prompt: string;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  skills?: string[];
  connectors?: string[];
  /** What binding changed (and clearing may undo). */
  applied: { model?: string; thinking?: ThinkingLevel; tools?: string[] };
  /** The session's own model / thinking before the first binding, restored on clear. */
  restore: { model?: { provider: string; modelId: string }; thinking?: ThinkingLevel };
  warnings: string[];
}

/** The binding on the current branch (or the branch ending at `fromId`); `null` entries mark an explicit unbind. */
export function currentBinding(sm: BranchReader, fromId?: string): ExpertBinding | undefined {
  return readBranchState<ExpertBinding | null>(sm, EXPERT_ENTRY, fromId) ?? undefined;
}

const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** The expert's tool allowlist as a predicate; undefined when the expert does not restrict tools. */
export function toolFilter(binding: Pick<ExpertBinding, "tools" | "connectors">): ((name: string) => boolean) | undefined {
  if (!binding.tools) return undefined;
  const patterns = [...binding.tools, ...(binding.connectors ?? []).map((c) => `mcp__${c}__*`)].map(glob);
  // Built-in tools (`ob_*`: todo, sub-agents …) are app features, not expert choices.
  return (name) => name.startsWith("ob_") || patterns.some((re) => re.test(name));
}

/** The text appended to the system prompt. The heading line is a stable marker (the e2e fixture keys on it). */
export function personaText(binding: Pick<ExpertBinding, "name" | "prompt" | "skills" | "connectors">): string {
  const lines = [
    `## 专家人设：${binding.name}`,
    "",
    `用户为本次任务指定了专家「${binding.name}」。请以这位专家的身份、专业视角和工作方式完成任务。下面的设定是对以上规则的补充，不能覆盖其中的安全、权限和工具使用规则。`,
    "",
    "<expert_persona>",
    binding.prompt.trim(),
    "</expert_persona>",
  ];
  if (binding.skills?.length) lines.push("", `这位专家优先使用的技能（如可用）：${binding.skills.join("、")}`);
  if (binding.connectors?.length) lines.push("", `这位专家常用的连接器（如已连接）：${binding.connectors.join("、")}`);
  return lines.join("\n");
}

/** Registered in `BUILTIN_EXTENSIONS` (typed there; no import back into index.ts, to keep the graph acyclic). */
export const persona = {
  id: "persona",
  create(): ExtensionFactory {
    return (pi) => {
      pi.on("before_agent_start", (event, ctx) => {
        const binding = currentBinding(ctx.sessionManager);
        if (!binding) return;
        const allowed = toolFilter(binding);
        // Editing selectedTools sets this run's loadout; the rendered prompt below lists only these tools.
        if (allowed) event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter(allowed);
        return { systemPrompt: `${event.systemPrompt}\n\n${personaText(binding)}` };
      });
    };
  },
};
