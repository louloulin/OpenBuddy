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
| `pi://update` | `electron/main/agent/agent-host.ts:4830, 4832, 4893` (replay + inspiration streams) | `src/lib/agent/pi-client.ts:2217` | live |
| `pi://complete` | `electron/main/agent/agent-host.ts:4833, 4880, 4895, 4900` | `src/lib/agent/pi-client.ts:2229` `handlers.onComplete` | live |
| `pi://error` | `electron/main/agent/agent-host.ts:3980, 4014, 4879, 4899` | `src/lib/agent/pi-client.ts` turn error path | live |
| `pi://notification` | `electron/main/agent/agent-host.ts:3363` | `src/lib/agent/pi-client.ts` notification toast | live (gated by `OPENBUDDY_NOTIFICATIONS_ENABLED`) |
| `pi://permission` | `electron/main/agent/agent-host.ts:2576, 3347` | `src/lib/agent/pi-client.ts:2228` `handlers.onPermission` | live |
| `pi://question` | `electron/main/agent/agent-host.ts:3341, 3353, 3359` | `src/lib/agent/pi-client.ts:2237` `handlers.onQuestion` | live |
| `pi://summary` | `electron/main/agent/agent-host.ts:3472` | `src/lib/agent/pi-client.ts:2230` `handlers.onSummary` | live |
| `pi://turn-error` | `electron/main/agent/agent-host.ts:3477, 4901` | `src/lib/agent/pi-client.ts:2240` `handlers.onTurnError` | live |
| `pi://mcp-status` | `electron/main/mcp/*` | `src/lib/agent/pi-client.ts:2231` `handlers.onMcpStatus` | live |
| `pi://folder-trust` | `electron/main/folder-trust/*` | `src/lib/agent/pi-client.ts:2232` `handlers.onFolderTrust` | live |
| `pi://plan-mode` | `electron/main/plan-mode/*` | `src/lib/agent/pi-client.ts:2233` `handlers.onPlanMode` | live |
| `pi://permission-mode` | `electron/main/permission/*` | `src/lib/agent/pi-client.ts:2234` `handlers.onPermissionMode` | live |
| `pi://task-update` | `electron/main/tasks/*` | `src/lib/agent/pi-client.ts:2236` `handlers.onTaskUpdate` | live |
| `pi://models-update` | `electron/main/agent/agent-host.ts:4120` (setModel) | `src/lib/agent/pi-client.ts:2235` `handlers.onModelsUpdate` | live (added in PR 4) |
| `pi://agent-died` | `electron/main/agent/agent-host.ts:3497` (handler throw) | `src/lib/agent/pi-client.ts:2238` `handlers.onAgentDied` | live (added in PR 4) |
| `pi://subagent` | `electron/main/agent/agent-host.ts:3431, 3448` (subagent-shaped tool exec) | `src/lib/agent/pi-client.ts:2239` `handlers.onSubagent` | live (added in PR 4) |
| `pi://extension-ui` | `electron/main/agent/agent-host.ts:3366, 3371, 3376` | `src/lib/agent/pi-client.ts:2241` `handlers.onExtensionUi` | live |
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
3. Add a `wire*` consumer in `src/lib/agent/pi-client.ts` (or the
   domain store).
5. Add a row to this matrix with `live` status.
4. Add a unit test in `electron/main/agent/__tests__/event-channel-matrix.test.ts`
   that fails CI if the matrix says `live` but the allowlist, producer, or
   consumer is missing.