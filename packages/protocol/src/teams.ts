/**
 * 专家团 (pii W3.5) wire types. A team is a preset pipeline: a list of experts in execution order.
 * It is installed as a 我的指令 prompt template and executed by the model with `ob_subagent`
 * (mode=chain) — there is no separate team runtime.
 */

export interface TeamStage {
  /** Built-in (or user) expert id used for this stage. */
  expertId: string;
  /** Display name resolved from the expert store (falls back to the id). */
  expertName: string;
  /** What this stage does, in one short phrase. */
  role: string;
  /** The instruction handed to the child for this stage. */
  instruction: string;
}

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  /** The 我的指令 name it installs as (`/team-...`). */
  command: string;
  stages: TeamStage[];
  /** True when the prompt template already exists in 我的指令. */
  installed?: boolean;
}
