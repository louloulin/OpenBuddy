# Event Channel Matrix

This document enumerates every renderer-visible event channel the OpenBuddy
Electron main process emits or accepts, and pairs it with its producer +
 consumer locations so the channel matrix stays in sync with code. The
allowlist itself lives in [electron/preload/index.ts:104-136](../electron/preload/index.ts).

Status legend:

- `live` — producer emits AND renderer consumer wired
- `orphan-emit` — producer emits but renderer never listens (data leaks)
- `orphan-consume` — preload allows + renderer listens but no producer (dead wire)
- `deliberate-drop` — documented as never produced; consumer is a defensive no-op

| Channel | Producer (file:line) | Consumer (file:line) | Status |
|---|---|---|---|
| `pi://event` | (none — alias of `openbuddy://plugin-event`; preload allowlist kept for backward compatibility) | n/a | deliberate-drop |
| `pi://update` | `electron/main/agent/agent-host.ts:4830, 4832, 4893` (replay + inspiration streams) | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2162` | live |
| `pi://complete` | `electron/main/agent/agent-host.ts:4833, 4880, 4895, 4900` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2165` `handlers.onComplete` | live |
| `pi://error` | `electron/main/agent/agent-host.ts:3980, 4014, 4879, 4899` | none — emitted + allowlisted, never received | `orphan-emit`|
| `pi://notification` | `electron/main/agent/agent-host.ts:3363` | none — emitted + allowlisted, never received | `orphan-emit`|
| `pi://permission` | `electron/main/agent/agent-host.ts:2576, 3347` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2244` `handlers.onPermission` | live |
| `pi://question` | `electron/main/agent/agent-host.ts:3341, 3353, 3359` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2253` `handlers.onQuestion` | live |
| `pi://summary` | `electron/main/agent/agent-host.ts:3472` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2246` `handlers.onSummary` | live |
| `pi://turn-error` | `electron/main/agent/agent-host.ts:3477, 4901` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2256` `handlers.onTurnError` | live |
| `pi://mcp-status` | `electron/main/mcp/*` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2247` `handlers.onMcpStatus` | live |
| `pi://folder-trust` | `electron/main/folder-trust/*` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2248` `handlers.onFolderTrust` | live |
| `pi://plan-mode` | `electron/main/plan-mode/*` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2249` `handlers.onPlanMode` | live |
| `pi://permission-mode` | `electron/main/permission/*` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2250` `handlers.onPermissionMode` | live |
| `pi://task-update` | `electron/main/tasks/*` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2252` `handlers.onTaskUpdate` | live |
| `pi://models-update` | `electron/main/agent/agent-host.ts:4120` (setModel) | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2251` `handlers.onModelsUpdate` | live (added in PR 4) |
| `pi://agent-died` | `electron/main/agent/agent-host.ts:3497` (handler throw) | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2254` `handlers.onAgentDied` | live (added in PR 4) |
| `pi://subagent` | `electron/main/agent/agent-host.ts:3431, 3448` (subagent-shaped tool exec) | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2255` `handlers.onSubagent` | live (added in PR 4) |
| `pi://extension-ui` | `electron/main/agent/agent-host.ts:3366, 3371, 3376` | `packages/ui/openbuddy-ui-contract/src/pi-client.ts:2257` `handlers.onExtensionUi` | live |
| `openbuddy://window-resized` | `electron/main/window/*` | `src/App.tsx` resize hook | live |
| `openbuddy://agent-event` | `electron/main/agent/agent-host.ts` plugin event bridge | `src/App.tsx` plugin listener | live |
| `openbuddy://plugin-event` | `electron/main/agent/agent-host.ts` plugin event bridge | `src/App.tsx` plugin listener | live |
| `openbuddy://collaboration-update` | `electron/main/collaboration/*` | `src/stores/collaboration-store.ts` | live |
| `openbuddy://workbench-scope` | `electron/main/workbench/*` | `src/stores/workbench-store.ts` | live |
| `connector://cli-auth-url` | `electron/main/connectors/*` | `src/stores/connector-store.ts` | live |
| `connector://cli-auth-log` | `electron/main/connectors/*` | `src/stores/connector-store.ts` | live |
| `connector://cli-auth-done` | `electron/main/connectors/*` | `src/stores/connector-store.ts` | live |
| `dsh://rpc` | `electron/main/dsh/*` | `electron/preload/index.ts:232` `rpc.onMessage` | live |
| `casdoor://auth` | `electron/main/casdoor/*` | `src/stores/casdoor-auth-store.ts` | live |
| `casdoor://lifecycle` | `electron/main/casdoor/*` | `src/stores/casdoor-auth-store.ts` | live |
| `casdoor://member-revocation` | `electron/main/casdoor/*` | `src/stores/member-store.ts` | live |
| `casdoor://casdoor-webhook` | `electron/main/casdoor/*` | `src/stores/casdoor-store.ts` | live |
| `electron-bridge-status` | `electron/preload/index.ts:145` | `src/stores/bridge-health-store.ts` | live (PR 5) |
| `pi-bridge-text:parse-frontmatter` | `electron/main/agent/pi-bridge/index.ts:31` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.parseFrontmatter` | live (Phase A.1) |
| `pi-bridge-text:strip-frontmatter` | `electron/main/agent/pi-bridge/index.ts:34` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.stripFrontmatter` | live (Phase A.1) |
| `pi-bridge-text:truncate-head` | `electron/main/agent/pi-bridge/index.ts:37` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.truncateHead` | live (Phase A.1) |
| `pi-bridge-text:truncate-tail` | `electron/main/agent/pi-bridge/index.ts:43` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.truncateTail` | live (Phase A.1) |
| `pi-bridge-text:truncate-line` | `electron/main/agent/pi-bridge/index.ts:49` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.truncateLine` | live (Phase A.1) |
| `pi-bridge-text:generate-diff` | `electron/main/agent/pi-bridge/index.ts:55` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.generateDiff` | live (Phase A.1) |
| `pi-bridge-text:generate-patch` | `electron/main/agent/pi-bridge/index.ts:64` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `text.generatePatch` | live (Phase A.1) |
| `pi-bridge-image:detect-mime` | `electron/main/agent/pi-bridge/index.ts:74` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `image.detectMime` | live (Phase A.1) |
| `pi-bridge-image:resize` | `electron/main/agent/pi-bridge/index.ts:78` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `image.resize` | live (Phase A.1) |
| `pi-bridge-image:resize-file` | `electron/main/agent/pi-bridge/index.ts:91` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `image.resizeFile` | live (Phase A.1) |
| `pi-bridge-image:convert-to-png` | `electron/main/agent/pi-bridge/index.ts:98` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `image.convertToPng` | live (Phase A.1) |
| `pi-bridge-skills:load` | `electron/main/agent/pi-bridge/index.ts:103` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `skills.load` | live (Phase A.1) |
| `pi-bridge-skills:load-from-dir` | `electron/main/agent/pi-bridge/index.ts:108` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `skills.loadFromDir` | live (Phase A.1) |
| `pi-bridge-skills:format-for-prompt` | `electron/main/agent/pi-bridge/index.ts:112` | `packages/ui/openbuddy-ui-contract/src/pi-bridge-client.ts` `skills.formatForPrompt` | live (Phase A.1) |

## Replay channel

- `agent:event-log-replay` — added in PR 4. Invoked by the renderer after a
  bridge recovery. Reads `agent.event-log` from the persisted
  `harness:session-cursors` cursor and re-emits events through the existing
  `pi://event` channel so the renderer's stores rehydrate without a full
  reload. Gated by `OPENBUDDY_REPLAY_ON_SUBSCRIBE=1`.

## How to extend

When adding a new channel:

1. Add it to `allowedEventChannels` in `electron/preload/index.ts`.
2. Add an `emit*` producer somewhere under `electron/main/`.
3. Add a `wire*` consumer in `packages/ui/openbuddy-ui-contract/src/pi-client.ts` (or the
   domain store).
5. Add a row to this matrix with `live` status.
4. Add a unit test in `electron/main/agent/__tests__/event-channel-matrix.test.ts`
   that fails CI if the matrix says `live` but the allowlist, producer, or
   consumer is missing.