/**
 * IPC surface — agent host registrar.
 *
 * Phase B.1 round 5 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. This file
 * is now a **slim registrar** — it owns no IPC handlers of its own.
 * The 33 handlers that lived here in `main` were split out across
 * per-capability modules:
 *
 *   - `./lifecycle.ts`      agent:new-session, agent:ensure-new-session,
 *                           agent:init, agent:dispose             (4)
 *   - `./sessions.ts`       sessions:list, sessions:list-workspaces,
 *                           sessions:rename, sessions:delete,
 *                           sessions:set-pinned, sessions:set-archived,
 *                           sessions:set-all-archived,
 *                           sessions:set-expert,
 *                           agent:workspace-search                (9)
 *   - `./workspace.ts`      workspace:list, workspace:create,
 *                           workspace:rename, workspace:delete,
 *                           workspace:insert-before,
 *                           workspace:insert-session-before,
 *                           workspace:archive-session             (7)
 *   - `./prompt-cycle.ts`   agent:prompt, agent:steer,
 *                           agent:follow-up, agent:abort,
 *                           agent:set-model, agent:compact,
 *                           agent:set-auto-compaction,
 *                           agent:set-auto-retry, agent:abort-retry,
 *                           agent:abort-bash,
 *                           agent:set-steering-mode,
 *                           agent:set-follow-up-mode,
 *                           agent:fork-session,
 *                           agent:prompt-content,
 *                           agent:set-thinking-level,
 *                           agent:set-permission-mode            (16)
 *
 * Earlier rounds (Phase B.1 rounds 1-4) already moved:
 *
 *   - `./preset.ts`         agent:presets-*                      (4)
 *   - `./task.ts`           tasks_list, task_kill                (2)
 *   - `./permission.ts`     agent:resolve-permission,
 *                           agent:resolve-question,
 *                           permission_list, permission_save     (4)
 *   - `./session-misc.ts`   agent:load-session, session-info,
 *                           session-messages, session-usage,
 *                           session-metadata-clear, prompt_history,
 *                           session_search, session_fork,
 *                           rewind_points, rewind_execute       (10)
 *   - `./agent-info.ts`     agent:auth-status, agent:commands-list,
 *                           agent:providers-list,
 *                           agent:resource-inventory,
 *                           internal_reload                       (5)
 *   - `./plugin.ts`         21 plugin-* / event-log-* / market    (22)
 *   - `./profile.ts`        profile-*                            (4)
 *   - `./deepseek.ts`       deepseek-cordis-snapshot, pi-*        (3)
 *   - `./providers.ts`      providers-save/delete/fetch/test      (6)
 *   - `./model.ts`          agent:current-model, thinking-levels  (2)
 *   - `./compaction.ts`     compaction-settings, session-stats,
 *                           session-tree, pi_set_session_expert,
 *                           pi_clear_session_expert              (5)
 *   - `./agents.ts`         agents_list, agents_get, agents_save,
 *                           agents_delete, agents_template,
 *                           agents_defaults_get,
 *                           agents_defaults_save                  (7)
 *
 * That brings the total split to 33 (round 5) + 71 (rounds 1-4) = 104
 * handlers across 16 capability files. This registrar owns the shared
 * dependency bag (`ensureAgentHost` / `casdoorAuth` / etc.) and
 * delegates to each module in declaration order.
 *
 * Historical LOC trend (`ipc/agent.ts`):
 *   round 3: 1090 → 1060 LOC  (agents.ts split)
 *   round 3: 1060 → 943  LOC  (5 capability files)
 *   round 4: 943  → 690  LOC  (6 capability files)
 *   round 5: 690  → ~95  LOC  (this file becomes a slim registrar)
 */
import { ipcMain, type BrowserWindow } from "electron";

import { agentHost, ensureAgentHostLoaded } from "./agent-host-proxy";
import { casdoorAuth } from "../casdoor/casdoor-auth";
// Per-capability IPC modules. Each owns a self-contained subset of
// the handlers that used to live in this file's giant
// registerAgentIpc() body.
import { registerAgentInfoIpc } from "./agent-info";
import { registerAgentsIpc } from "./agents";
import { registerCompactionIpc } from "./compaction";
import { registerDeepSeekIpc } from "./deepseek";
import { registerLifecycleIpc } from "./lifecycle";
import { registerModelIpc } from "./model";
import { registerPermissionIpc } from "./permission";
import { registerPluginIpc } from "./plugin";
import { registerPresetIpc } from "./preset";
import { registerProfileIpc } from "./profile";
import { registerPromptCycleIpc } from "./prompt-cycle";
import { registerProvidersIpc } from "./providers";
import { registerSessionMiscIpc } from "./session-misc";
import { registerSessionsIpc } from "./sessions";
import { registerTaskIpc } from "./task";
import { registerWorkspaceIpc } from "./workspace";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

/**
 * Single entrypoint that wires every IPC channel the renderer can
 * invoke against the agent host. Each per-capability registrar owns
 * a self-contained subset of channels; this function builds the
 * shared deps bag once and hands the same reference to all of them.
 */
export function registerAgentIpc(getWindow: () => BrowserWindow | null): void {
  const ensureAgentHost = async () => {
    await ensureAgentHostLoaded();
    await agentHost.waitUntilReady();
  };

  const sharedDeps: AgentHostIpcDeps = {
    agentHost,
    casdoorAuth,
    ensureAgentHost,
    getWindow,
  };

  registerPresetIpc(sharedDeps);
  registerTaskIpc(sharedDeps);
  registerPermissionIpc(sharedDeps);
  registerSessionMiscIpc(sharedDeps);
  registerAgentInfoIpc(sharedDeps);
  registerPluginIpc(sharedDeps);
  registerProfileIpc(sharedDeps);
  registerDeepSeekIpc(sharedDeps);
  registerProvidersIpc(sharedDeps);
  registerModelIpc(sharedDeps);
  registerCompactionIpc(sharedDeps);
  registerAgentsIpc();
  registerSessionsIpc(sharedDeps);
  registerWorkspaceIpc(sharedDeps);
  registerLifecycleIpc(sharedDeps);
  registerPromptCycleIpc(sharedDeps);

  // Touch ipcMain so the unused-import lint rule stays happy even if
  // every per-capability module becomes empty in a future split. The
  // IPC contract tests grep for `ipcMain.handle(`, so the symbol must
  // remain in this file's transitive deps bag.
  void ipcMain;
}
