// §5.3 `extensions` module: agent_extensions_list / add / remove / set_enabled.
import { invoke } from "../ipc";

export interface ExtensionsConfig { enabled: boolean; paths: string[]; projectTrusted: boolean }
export const agentExtensionsList = () => invoke<ExtensionsConfig>("agent_extensions_list");
export const agentExtensionsAdd = (path: string) => invoke<ExtensionsConfig>("agent_extensions_add", { path });
export const agentExtensionsRemove = (path: string) => invoke<ExtensionsConfig>("agent_extensions_remove", { path });
export const agentExtensionsSetEnabled = (enabled: boolean) => invoke<ExtensionsConfig>("agent_extensions_set_enabled", { enabled });
