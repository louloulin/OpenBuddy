import { invoke } from "@/lib/platform/electron-api";
import { createElectronDirectoryReader } from "@/lib/files/electron-kb-reader";
import { createLocalKbProvider } from "@openbuddy/files-kb";
import { registerKbProvider, searchKb, unregisterKbProvider, type KbEntry } from "@openbuddy/files-kb";

let loadedRootsKey = "";
let loadedProviderIds: string[] = [];

/** Load persisted local knowledge roots without requiring the Knowledge Base page first. */
export async function ensureStoredLocalKnowledgeProviders(): Promise<void> {
  let storedRoots: unknown;
  try {
    storedRoots = await invoke<unknown>("knowledge-sources:list");
  } catch {
    return;
  }
  if (!Array.isArray(storedRoots)) return;
  const roots = storedRoots.filter((root): root is string => typeof root === "string" && root.trim().length > 0);
  const nextKey = roots.join("\u0000");
  if (nextKey === loadedRootsKey) return;
  for (const providerId of loadedProviderIds) unregisterKbProvider(providerId);
  const reader = createElectronDirectoryReader();
  loadedProviderIds = roots.map((root, index) => index === 0 ? "local" : `local:${encodeURIComponent(root)}`);
  roots.forEach((root, index) => {
    registerKbProvider(createLocalKbProvider(root, reader, {
      providerId: loadedProviderIds[index],
      label: "本地文件夹",
    }));
  });
  loadedRootsKey = nextKey;
}

/** Search persisted knowledge sources for unified workspace search. */
export async function searchStoredKnowledge(query: string): Promise<KbEntry[]> {
  await ensureStoredLocalKnowledgeProviders();
  return searchKb(query);
}
