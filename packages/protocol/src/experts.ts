/**
 * 专家 (experts) wire types — 20261116-pii W2.1–W2.3.
 *
 * An expert is a Markdown file `agents/<id>.md`: YAML front matter (name, avatar, description,
 * category, model, thinking, tools, skills, connectors, examples, tags) and a body that is the
 * persona prompt. Sources, in precedence order: the user's own directory, the trusted project's
 * `.pi/agents/`, directories the user added as libraries, and the built-in seeds.
 */
import type { AgentEntry } from './dto.js';
import type { ThinkingLevel } from './types.js';

/** Where an expert comes from. Only `user` experts are writable. */
export type ExpertScope = 'user' | 'project' | 'library' | 'builtin';

/** File-name safe id: lowercase letters, digits, `-` and `_`; never a path. */
export const EXPERT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const isExpertId = (value: unknown): value is string => typeof value === 'string' && EXPERT_ID_PATTERN.test(value);

export const EXPERT_LIMITS = {
  name: 60,
  description: 300,
  prompt: 50_000,
  avatar: 512,
  category: 32,
  model: 256,
  list: 64,
  item: 128,
  examples: 8,
  example: 500,
  tags: 8,
  tag: 24,
} as const;

/** What the editor sends to `agents_save` / `agents_template`. */
export interface ExpertDraft {
  /** Omitted when creating: derived from the name and made unique. */
  id?: string;
  name: string;
  /** An emoji, or a path relative to the expert file (image avatar). */
  avatar?: string;
  description?: string;
  category?: string;
  /** `model:<provider>/<id>`, `<provider>/<id>` or a bare model id; unset = the session's model. */
  model?: string;
  thinking?: ThinkingLevel;
  /** Tool allowlist (`read`, `bash`, `mcp__*` …); unset = every tool the mode allows. */
  tools?: string[];
  skills?: string[];
  connectors?: string[];
  /** Sample tasks shown as 试试这样问我 and used to pre-fill the composer. */
  examples?: string[];
  tags?: string[];
  /** Persona prompt (the Markdown body). */
  prompt: string;
}

/**
 * One expert. Extends the legacy `AgentEntry` so older callers of `agents_list` keep working:
 * `name`, `description`, `scope`, `path` and `raw` mean the same; a numeric legacy avatar stays in
 * `avatar`, an emoji avatar is in `emoji`.
 */
export interface ExpertEntry extends AgentEntry {
  id: string;
  scope: ExpertScope;
  emoji?: string;
  /** Absolute path of an image avatar inside an allowed root (feed to `experts_thumbnail`). */
  image?: string;
  category?: string;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  skills?: string[];
  connectors?: string[];
  examples: string[];
  tags: string[];
  prompt: string;
  /** True for anything outside the user's own directory. */
  readonly: boolean;
  /** Library directory the expert was read from (scope `library`). */
  origin?: string;
  /** ISO time of the last change on disk (absent for built-ins). */
  updatedAt?: string;
}

export interface ExpertCategoryInfo {
  id: string;
  label: string;
  emoji: string;
}

/** A 精选场景 strip card: a theme and the experts that fit it. */
export interface ExpertSceneInfo {
  id: string;
  title: string;
  description: string;
  expertIds: string[];
  /** Soft gradient endpoints for the banner. */
  from: string;
  to: string;
}

export interface ExpertRootInfo {
  path: string;
  exists: boolean;
  /** Experts found in it. */
  count: number;
  error?: string;
}

/** One capability the package declared and OpenBuddy installed (B1b). */
export interface WorkBuddyContribution {
  kind: "skill" | "prompt" | "mcp";
  name: string;
  /** Skills/prompts: true when active; MCP: always false until the user opts in. */
  enabled: boolean;
}

/** A declared capability that was deliberately not installed, with the reason. */
export interface WorkBuddySkippedContribution {
  kind: "skill" | "command" | "hook" | "extension" | "mcp";
  name: string;
  reason: string;
}

/** `experts_import_workbuddy`: what a WorkBuddy package produced (S18/S21/B1b). */
export interface WorkBuddyImportResult {
  package: string;
  imported: ExpertEntry[];
  skipped: Array<{ id: string; error: string }>;
  /** Team packages also install a 我的指令 prompt; `command` is its `/` invocation (S21). */
  team?: { name: string; command?: string; leadAgent?: string; members: string[]; error?: string };
  /** Installed skills / prompts / MCP servers (B1b). */
  contributions?: WorkBuddyContribution[];
  /** Declared but not installed, so the UI can explain what was left out. */
  skippedContributions?: WorkBuddySkippedContribution[];
  /** Capability gates declared by the package (`requiresProductFeature`). */
  requires?: string[];
}

/** `experts_load`: the merged catalog for one working directory. */
export interface ExpertCenterCatalog {
  /** The user's own experts directory (`<pi>/agents`). */
  userDir: string;
  /** `<cwd>/.pi/agents` when a project is open. */
  projectDir?: string;
  /** Project experts are read only when the folder is trusted. */
  projectTrusted: boolean;
  categories: ExpertCategoryInfo[];
  experts: ExpertEntry[];
  scenes: ExpertSceneInfo[];
  roots: ExpertRootInfo[];
  /** Files that could not be parsed (bad YAML, invalid id …), so the user can fix them. */
  problems: Array<{ path: string; error: string }>;
}

/** The expert bound to a session (`agent_set_session_expert`, the load snapshot). */
export interface SessionExpertInfo {
  sessionId: string;
  id: string;
  name: string;
  /** Emoji or absolute image path. */
  avatar?: string;
  scope: string;
  /** What binding changed: model key, thinking level, active tools. */
  applied: { model?: string; thinking?: ThinkingLevel; tools?: string[] };
  /** Preferences that could not be applied (e.g. `model_unavailable`). */
  warnings: string[];
}
