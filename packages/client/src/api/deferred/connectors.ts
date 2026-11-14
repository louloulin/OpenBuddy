// Deferred (20261115-md Appendix B, 连接器): connectors_* commands and connector://cli-auth-* events. Not in the
// protocol COMMANDS list; the wrappers are kept until the feature gets a host module.
import type { ConnectorCatalog, ConnectorCliAuthDoneEvent, ConnectorCliAuthLogEvent, ConnectorCliAuthResult, ConnectorCliAuthUrlEvent, ConnectorCliStatus } from "@openbuddy/protocol/dto";
import { invoke, listen, type UnlistenFn } from "../../ipc";

// ---------- CLI-type connector authorization (cli.json driven) ----------

/** Probe a CLI connector: has cli.json / CLI installed / currently authed. */
export async function connectorsCliStatus(
  root: string,
  source: string,
): Promise<ConnectorCliStatus> {
  return invoke<ConnectorCliStatus>("connectors_cli_status", { root, source });
}

/** Run the full CLI authorization flow (install → auth steps → verify).
 *  Long-running; auth URLs arrive via `onConnectorCliAuthUrl`. */
export async function connectorsCliAuth(
  root: string,
  source: string,
): Promise<ConnectorCliAuthResult> {
  return invoke<ConnectorCliAuthResult>("connectors_cli_auth", { root, source });
}

/** Cancel an in-flight CLI authorization (kills the child process tree). */
export async function connectorsCliAuthCancel(source: string): Promise<void> {
  await invoke<void>("connectors_cli_auth_cancel", { source });
}

/** Run the connector's unAuth command (logout / credential wipe). */
export async function connectorsCliUnauth(root: string, source: string): Promise<void> {
  await invoke<void>("connectors_cli_unauth", { root, source });
}

/** Absolute path of the connector's bundled skills/ dir (null if none). */
export async function connectorsCliSkillsDir(
  root: string,
  source: string,
): Promise<string | null> {
  return invoke<string | null>("connectors_cli_skills_dir", { root, source });
}

/** Subscribe to CLI auth URL events (show QR / open browser). */
export function onConnectorCliAuthUrl(
  cb: (e: ConnectorCliAuthUrlEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorCliAuthUrlEvent>("connector://cli-auth-url", (ev) => cb(ev.payload));
}

/** Subscribe to CLI auth log lines (progress display in the QR modal). */
export function onConnectorCliAuthLog(
  cb: (e: ConnectorCliAuthLogEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorCliAuthLogEvent>("connector://cli-auth-log", (ev) => cb(ev.payload));
}

/** Subscribe to CLI auth completion events. */
export function onConnectorCliAuthDone(
  cb: (e: ConnectorCliAuthDoneEvent) => void,
): Promise<UnlistenFn> {
  return listen<ConnectorCliAuthDoneEvent>("connector://cli-auth-done", (ev) => cb(ev.payload));
}

// ---------- connector marketplace (live local data dir) ----------

/** First existing candidate marketplace root ("" if none found). */
export async function connectorsDefaultRoot(): Promise<string> {
  return invoke<string>("connectors_default_root");
}

/** Marketplace roots under `root` that contain the connectors manifest. */
export async function connectorsListRoots(root: string): Promise<string[]> {
  return invoke<string[]>("connectors_list_roots", { root });
}

/** Load categories + connectors from the marketplace manifest. */
export async function connectorsLoad(root?: string): Promise<ConnectorCatalog> {
  return invoke<ConnectorCatalog>("connectors_load", { root: root ?? null });
}

/** Read a local icon file as a `data:` URL (svg/png). */
export async function connectorsIcon(path: string): Promise<string> {
  return invoke<string>("connectors_icon", { path });
}

/** Read `<root>/connectors/<source>/mcp.json` raw text ("" if missing). */
export async function connectorsReadMcpConfig(root: string, source: string): Promise<string> {
  return invoke<string>("connectors_read_mcp_config", { root, source });
}
