/**
 * inject-system-prompt-sections.ts — inject pre-session system prompt sections.
 *
 * Phase 8.3 §45: extracted from electron/main/agent/agent-host.ts
 * :initialize() (~40 lines of inline section injection).
 *
 * Two sections are injected into the systemPrompt context before
 * piSessionRuntime.create() runs:
 *
 *   1. "agent-instructions:workspace" (order: 10)
 *      - Workspace-level instructions read from disk via piResources.
 *      - Optional: only injected when the file exists / has content.
 *
 *   2. "agent-instructions:pi-compatibility" (order: 20)
 *      - Documents every adapter-projected slash command so the agent
 *        can use them as first-class affordances.
 *      - Gated on the active profile specs so a vanilla profile does
 *        not pay the prompt cost.
 *
 * The systemPrompt interface is { section(...), render(...) } — we use
 * the section API which appends to the prompt in the order specified.
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from agent-host.ts. The deps interface
 *   is small (state context + piResources + markdown helper).
 */

export interface InjectSystemPromptSectionsDeps {
  /**
   * cwd of the workspace being booted. Passed to piResources.readWorkspaceInstructions
   * to load AGENTS.md / .openbuddy/instructions.md.
   */
  cwd: string;
  /**
   * Cordis context. The `systemPrompt` slot is a service with `.section(...)`.
   */
  context: { get: (key: string) => unknown };
  /**
   * Used to read workspace-level instructions (AGENTS.md / .openbuddy/instructions.md).
   */
  piResources: { readWorkspaceInstructions: (cwd: string) => Promise<string | undefined> };
  /**
   * Renders the markdown list of adapter-projected slash commands.
   * Returns null/undefined when no adapter specs are active.
   */
  describeCompatibilityAdapterCommandsMarkdown: (adapterIds: string[]) => string | undefined | null;
  /**
   * Active adapter ids (profile spec entries with mode === "adapter").
   */
  activeAdapterIds: ReadonlySet<string>;
}

interface SystemPromptService {
  section?: (section: { name: string; order: number; text: string }) => () => void;
}

/**
 * Inject the workspace instructions + adapter-commands markdown sections into
 * the systemPrompt service. Returns the number of sections actually injected
 * (0, 1, or 2) so callers can log a diagnostic.
 *
 * Idempotent: re-running on the same context appends new sections without
 * removing the old ones. This matches the existing inline behavior — the
 * Pi runtime deduplicates section names internally.
 */
export async function injectSystemPromptSections(
  deps: InjectSystemPromptSectionsDeps,
): Promise<{ workspace: boolean; adapters: boolean }> {
  const { cwd, context, piResources, describeCompatibilityAdapterCommandsMarkdown, activeAdapterIds } = deps;

  // 1. Workspace instructions — read from disk if available
  const agentInstructions = context.get("agentInstructions") as { read?: (request?: { cwd?: string }) => Promise<string> } | undefined;
  const workspaceInstructions = agentInstructions?.read
    ? await agentInstructions.read({ cwd })
    : await piResources.readWorkspaceInstructions(cwd);
  let workspaceInjected = false;
  if (workspaceInstructions) {
    const systemPrompt = context.get("systemPrompt") as SystemPromptService | undefined;
    systemPrompt?.section?.({ name: "agent-instructions:workspace", order: 10, text: workspaceInstructions });
    workspaceInjected = true;
  }

  // 2. Adapter-commands markdown — only if any adapter is active
  let adapterInjected = false;
  if (activeAdapterIds.size > 0) {
    const adapterMarkdown = describeCompatibilityAdapterCommandsMarkdown([...activeAdapterIds]);
    if (adapterMarkdown) {
      const systemPrompt = context.get("systemPrompt") as SystemPromptService | undefined;
      systemPrompt?.section?.({ name: "agent-instructions:pi-compatibility", order: 20, text: adapterMarkdown });
      adapterInjected = true;
    }
  }

  return { workspace: workspaceInjected, adapters: adapterInjected };
}
