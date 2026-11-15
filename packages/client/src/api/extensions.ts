// §5.3 `extensions` module: agent_extensions_list / inspect / add / remove / set_enabled.
// 扩展中心 (pii W2.6): `list` also reports what each path registers and where it failed to load.
import { invoke } from "../ipc";

/** One configured extension path: what it registers, or why it failed (isolated load). */
export interface ExtensionReport {
  path: string;
  resolvedPath: string | null;
  ok: boolean;
  tools: string[];
  commands: string[];
  shortcuts: string[];
  error: string | null;
}

export interface ExtensionsConfig {
  enabled: boolean;
  paths: string[];
  /** Paths configured but switched off in 扩展中心 (W2.6). */
  disabled?: string[];
  projectTrusted: boolean;
  /** Per-path previews (W2.6). */
  items?: Array<ExtensionReport & { enabled?: boolean }>;
  /** Paths that failed to load in the last opened session. */
  errors?: Array<{ path: string; error: string }>;
}
export const agentExtensionsList = (cwd?: string) => invoke<ExtensionsConfig>("agent_extensions_list", { cwd: cwd ?? null });
/** Preview what one path would register, before it is added (isolated loader). */
export const agentExtensionsInspect = (path: string, cwd?: string) =>
  invoke<ExtensionReport>("agent_extensions_inspect", { path, cwd: cwd ?? null });
export const agentExtensionsAdd = (path: string) => invoke<ExtensionsConfig>("agent_extensions_add", { path });
export const agentExtensionsRemove = (path: string) => invoke<ExtensionsConfig>("agent_extensions_remove", { path });
export const agentExtensionsSetEnabled = (enabled: boolean) => invoke<ExtensionsConfig>("agent_extensions_set_enabled", { enabled });
/** Per-extension switch (W2.6): a disabled path stays configured but is not loaded. */
export const agentExtensionsSetPathEnabled = (path: string, enabled: boolean) =>
  invoke<ExtensionsConfig>("agent_extensions_set_path_enabled", { path, enabled });
