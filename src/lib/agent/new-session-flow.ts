/**
 * newSessionFlow — single send-first-message orchestrator.
 *
 * ## Why this exists
 *
 * Four `handleSend*` entry points in `App.tsx`
 * (handleSendNew / handleLaunchDiscover / handleStartProject /
 * handleStartProjectConversation) used to repeat the same post-migration
 * choreography:
 *
 *   1. await the optimistic `ensureNewSession` promise → real sessionId
 *   2. handle the "supersede" path (a piggy-backed promise may resolve to
 *      a *stale* pendingId — re-await the current in-flight record to
 *      land somewhere real)
 *   3. `migrateSession(pendingId, realId)` on BOTH stores
 *      (test-pinned contract: see `sessions-store.test.ts:107–158` and
 *      `session-store.test.ts:84–104`)
 *   4. optional expert-persona wrapping (`piSetSessionExpert` + the
 *      `EXPERT_PERSONA_BEGIN/END` markers around the user text)
 *   5. optional project-conversation registration (`useProjectsStore
 *      .addConversation`) + first-conversation pre-wrap
 *   6. finally `piSend(realId, text)` to actually drive the model
 *
 * This module lifts steps 4–6 (and the supersede-guard) out of App.tsx so
 * the four callers can collapse to a thin wrapper. The migration step (3)
 * stays the same — Phase 1's `useOptimisticNewSession.recordAlias` is
 * called by the caller BEFORE invoking this flow, so the alias map is
 * already populated when `migrateSession` runs.
 *
 * ## Design rules
 *
 * - **No React imports.** Pure async function; the React glue layer
 *   (`useSendFirstMessage`) is a separate hook.
 * - **No store reads** besides the action invocations. The function does
 *   not mutate `pendingId`, `streaming`, `optimisticBubble`, etc. — those
 *   are caller responsibilities (set synchronously *before* awaiting the
 *   IPC).
 * - **`assertRealSessionId` guard.** `piSetSessionExpert` and `piSend`
 *   both route through this guard in `pi-client.ts:79`. By the time this
 *   flow runs, `migrateSession` has already collapsed the pendingId to a
 *   real sessionId, so the guards always see a real id.
 * - **One throw on terminal failure.** `PlaceholderNeverResolvedError` is
 *   the only way the flow signals "we couldn't land on a real id"; the
 *   caller catches and runs the rollback block.
 */
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { usePendingExpertStore } from "@/stores/pending-expert-store";
import { useProjectsStore } from "@/stores/projects-store";
import { piSend, piSetSessionExpert } from "@/lib/agent/pi-client";
import { friendlyError } from "@/lib/platform/error-format";
import { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "@/lib/agent/persona-markers";
import type { AgentEntry } from "@openbuddy/shared-types";

/**
 * Thrown when the optimistic pendingId never resolves to a real
 * sessionId (the supersede guard keeps retrying but the IPC pipeline
 * ultimately fails). The caller is responsible for rollback
 * (`popOptimistic` + `setStreaming(false)` + `setSession(null)` + `remove(pendingId)`).
 */
export class PlaceholderNeverResolvedError extends Error {
  constructor(message = "会话创建尚未完成，请稍后再试") {
    super(message);
    this.name = "PlaceholderNeverResolvedError";
  }
}

export interface PersonaSpec {
  expertId: string;
  name: string;
  source: string;
  avatarLocal?: string;
  /** The persona body — wrapped between EXPERT_PERSONA_BEGIN / END markers. */
  prompt: string;
}

export interface ProjectSeed {
  id: string;
  name: string;
  /** Optional project background — prepended to the first message in the project. */
  instructions?: string;
}

export interface NewSessionFlowDeps {
  /**
   * Re-await the *current* in-flight pending session. Used to recover
   * from the supersede case where the original promise resolves to a
   * stale pendingId (a newer caller has overwritten `pendingId` in the
   * shared record). Defaults to a no-op if omitted — only call this
   * flow from `useOptimisticNewSession`-backed entry points.
   */
  awaitPendingNewSession?: () => Promise<string | null>;
  /** Optional expert-persona wrapping. */
  persona?: PersonaSpec;
  /** Optional project background + first-conversation pre-wrap. */
  projectSeed?: ProjectSeed;
  /**
   * If true, register this conversation in the project once we have the
   * real id. Defaults to true when `projectSeed` is supplied.
   */
  registerProjectConversation?: boolean;
}

export interface NewSessionFlowArgs {
  /** The `__pending_<nonce>` id minted by `ensureNewSession`. */
  pendingId: string;
  /** Promise that resolves to the real sessionId (or another pendingId). */
  promise: Promise<string>;
  /** Text to send to the model. */
  text: string;
  /** CWD for the session — currently unused by the flow itself, but
   *  threaded through so callers don't have to remember the field. */
  cwd: string;
  flowDeps?: NewSessionFlowDeps;
}

/**
 * Run the post-migration choreography for a new-session send.
 *
 * Returns the resolved realId so the caller can run additional cleanup
 * (e.g. focus sidebar row, update draft key). Throws
 * `PlaceholderNeverResolvedError` if no realId can be recovered.
 */
export async function newSessionFlow(args: NewSessionFlowArgs): Promise<{ realId: string }> {
  const deps: NewSessionFlowDeps = args.flowDeps ?? {};
  let realId = await args.promise;

  // Supersede guard — a piggy-backed promise may resolve to a *later*
  // pendingId that another caller already owns. Re-await the current
  // in-flight record to land somewhere real.
  if (!realId || realId.startsWith("__pending_")) {
    const refreshed = await (deps.awaitPendingNewSession ?? (async () => null))();
    if (refreshed && !refreshed.startsWith("__pending_")) realId = refreshed;
  }
  if (!realId || realId.startsWith("__pending_")) {
    useSessionStore.getState().setError(friendlyError("会话创建尚未完成，请稍后再试"));
    throw new PlaceholderNeverResolvedError();
  }

  // Atomic migration — test-pinned contract (sessions-store.test.ts:107-158,
  // session-store.test.ts:84-104). The pendingId → realId rename rekeys
  // independent, every workspace cache, drafts, AND currentSessionId.
  useSessionStore.getState().migrateSession(args.pendingId, realId);
  useSessionsStore.getState().migrateSession(args.pendingId, realId);

  // Compose the actual text we'll send to pi. Start with the raw user
  // text and layer persona + project seed wrappers as needed.
  let textForPi = args.text;

  // Expert-persona wrapping — invisible markers around the user text so
  // pi sees the persona as instructions but the renderer strips it on
  // history replay. `piSetSessionExpert` only runs when an expert is
  // pending; it's awaited so the binding reaches the backend before the
  // prompt lands (otherwise the persona wouldn't apply to the first
  // turn).
  if (deps.persona) {
    textForPi = `${EXPERT_PERSONA_BEGIN}\n${deps.persona.prompt}\n${EXPERT_PERSONA_END}\n\n${textForPi}`;
    await piSetSessionExpert(
      realId,
      deps.persona.expertId,
      deps.persona.name,
      deps.persona.source,
      deps.persona.avatarLocal,
    );
    useSessionsStore.getState().upsert({
      sessionId: realId,
      expertId: deps.persona.expertId,
      expertName: deps.persona.name,
      expertAvatar: deps.persona.avatarLocal,
    });
    usePendingExpertStore.getState().clear();
  }

  // Project conversation registration + first-conversation pre-wrap.
  // Mirrors the inline logic from `App.tsx:2011-2019` and `App.tsx:1867-1871`.
  const shouldRegister = deps.registerProjectConversation ?? Boolean(deps.projectSeed);
  if (deps.projectSeed && shouldRegister) {
    useProjectsStore.getState().addConversation(deps.projectSeed.id, {
      sessionId: realId,
      title: deps.projectSeed.name,
      createdAt: new Date().toISOString(),
    });
    if (deps.projectSeed.instructions?.trim() && textForPi.trim().length > 0) {
      // First conversation in a project — prepend the project instructions
      // so pi understands the project's background on the very first turn.
      const project = useProjectsStore
        .getState()
        .projects.find((p) => p.id === deps.projectSeed!.id);
      const isFirst = project?.conversations.length === 1; // count after addConversation above
      if (isFirst) {
        textForPi = `[项目「${deps.projectSeed.name}」背景与规范]\n${deps.projectSeed.instructions.trim()}\n\n[用户消息]\n${textForPi}`;
      }
    }
  }

  await piSend(realId, textForPi);
  return { realId };
}

/**
 * Compose the prompt body for the Discover wizard — wraps the user's
 * first question in a role-prompt preamble so the agent knows which
 * expert persona to adopt for this conversation.
 *
 * Mirrors the inline logic in `App.tsx:1874-1897` lifted into a pure
 * helper. Kept colocated with `newSessionFlow` because it is the
 * canonical input shape for the discover entry point.
 */
export function composeDiscoverBody(prompt: string, agent?: AgentEntry): string {
  if (!agent) return prompt;
  const promptBody = agent.raw ? extractMarkdownBody(agent.raw) : agent.description ?? "";
  return [
    `【角色设定 — ${agent.name}】`,
    `从现在开始，你将以下述专家身份进行本次对话。请严格遵循角色定义。`,
    ``,
    promptBody,
    ``,
    `---`,
    `用户的第一个问题：`,
    ``,
    prompt,
  ].join("\n");
}

/** Strip YAML frontmatter from a markdown agent file (mirrors
 *  `App.tsx:153-162`). */
function extractMarkdownBody(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return raw.trim();
  const afterOpen = trimmed.indexOf("\n");
  if (afterOpen === -1) return raw.trim();
  const rest = trimmed.slice(afterOpen + 1);
  const closeIdx = rest.search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return raw.trim();
  return rest.slice(closeIdx + 1).replace(/^\n---\s*/, "").trim();
}