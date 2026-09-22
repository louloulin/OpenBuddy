/** Electron 目录读取适配器。 */
import { invoke } from "@/lib/platform/electron-api";
import type { DirectoryReader } from "@openbuddy/files-kb";

export function isElectronAvailable(): boolean {
  return typeof window !== "undefined" && "api" in window;
}

export function createElectronDirectoryReader(): DirectoryReader {
  return {
    async listDir(path) {
      const entries: Array<{ name: string; path: string; is_dir: boolean }> = await invoke(
        "shellfs:browse-directory",
        path,
      );
      return entries.map((entry) => ({ name: entry.name, path: entry.path, isDir: entry.is_dir }));
    },
    async readText(path) {
      try {
        return await invoke<string>("shellfs:read-text", { path, cwd: null, maxBytes: 256 * 1024 });
      } catch {
        return null;
      }
    },
    async readBytes(path) {
      try {
        const base64 = await invoke<string>("shellfs:read-file-base64", { path, maxBytes: 1024 * 1024 });
        return base64ToBytes(base64);
      } catch {
        return null;
      }
    },
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]*;base64,/, "").replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
