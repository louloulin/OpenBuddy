import type { createSettings, SafeStorage } from "@openbuddy/services/settings/settings";
import type { DesktopShell } from "@openbuddy/services/files/files";
import type { PiEngine } from "@openbuddy/engine/pi-engine";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Emit } from "@openbuddy/engine/permissions/permissions";
export interface EngineOptions {
  userDataDir: string;
  emit: Emit;
  safeStorage: SafeStorage;
  shell: DesktopShell;
  /** Trusted host-provided extensions; never accepted in renderer IPC. */
  extensionFactories?: ExtensionFactory[];
  /**
   * The embedding app, for `host_capabilities`: its kind and the commands/events it serves
   * itself (desktop: native dialogs, windows, clipboard, export; window/focus events).
   */
  platform?: { kind: string; commands?: readonly string[]; events?: readonly string[] };
}
export type Handler = (
  payload: Record<string, unknown>,
) => unknown | Promise<unknown>;
type Settings = ReturnType<typeof createSettings>;
/**
 * What every command handler closes over (20261115-md R4). Built once by
 * `createEngineHandlers` after the engine has initialized; modules only read it.
 */
export interface HostContext {
  options: EngineOptions;
  settings: Settings;
  /** Redacting event sink handed to the engine. */
  emit: Emit;
  engine: PiEngine;
  /** Read-modify-write of the persisted config. */
  update: (fn: (c: ReturnType<Settings["config"]["read"]>) => void) => void;
  /** Names of the commands the assembled host serves (read lazily, after assembly). */
  servedCommands: () => readonly string[];
}
/** One group of commands from the §5.3 module table. */
export interface HostModule {
  id: string;
  commands: Record<string, Handler>;
}
export type HostModuleFactory = (ctx: HostContext) => HostModule;
