import { parseCordisPatch, patchRowsToOpenBuddy } from "./yaml-patch";

export { parseCordisPatch, patchRowsToOpenBuddy };

interface RendererPluginEntry {
  id: string;
  moduleId?: string;
  name: string;
  config?: unknown;
  inject?: readonly string[] | Record<string, unknown>;
  disabled?: boolean;
  group?: boolean | null;
  children?: readonly RendererPluginEntry[];
  external?: readonly string[];
  immediately?: boolean;
}

interface RendererPluginPatch {
  id?: string;
  insert?: RendererPluginEntry | RendererPluginEntry[];
  disabled?: boolean;
  name?: string;
  config?: unknown;
  inject?: readonly string[] | Record<string, unknown>;
  group?: boolean | null;
  children?: readonly RendererPluginEntry[];
  moduleId?: string;
  external?: readonly string[];
  immediately?: boolean;
}

export function composePluginPatches(
  base: readonly RendererPluginEntry[],
  layers: readonly RendererPluginPatch[][],
): RendererPluginEntry[] {
  const entries = base.map((entry) => ({ ...entry }));
  for (const patch of layers.flat()) {
    if (patch.insert) {
      const inserts = Array.isArray(patch.insert) ? patch.insert : [patch.insert];
      entries.push(...inserts.map((entry) => ({ ...entry })));
      continue;
    }
    if (!patch.id) throw new Error("plugin-loader: patch requires id or insert");
    const index = entries.findIndex((entry) => entry.id === patch.id);
    if (index < 0) {
      entries.push({
        id: patch.id,
        name: patch.name ?? patch.id,
        ...(patch.config === undefined ? {} : { config: patch.config }),
        ...(patch.inject === undefined ? {} : { inject: patch.inject }),
        ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
        ...(patch.group === undefined ? {} : { group: patch.group }),
        ...(patch.children === undefined ? {} : { children: patch.children }),
        ...(patch.moduleId === undefined ? {} : { moduleId: patch.moduleId }),
        ...(patch.external === undefined ? {} : { external: patch.external }),
        ...(patch.immediately === undefined ? {} : { immediately: patch.immediately }),
      });
      continue;
    }
    entries[index] = {
      ...entries[index],
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.inject === undefined ? {} : { inject: patch.inject }),
      ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
      ...(patch.group === undefined ? {} : { group: patch.group }),
      ...(patch.children === undefined ? {} : { children: patch.children }),
      ...(patch.moduleId === undefined ? {} : { moduleId: patch.moduleId }),
      ...(patch.external === undefined ? {} : { external: patch.external }),
      ...(patch.immediately === undefined ? {} : { immediately: patch.immediately }),
    };
  }
  return entries;
}
