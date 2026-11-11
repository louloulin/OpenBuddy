
import { invoke } from "@/lib/ipc";
import type { DirectoryReader } from "./local-kb-provider";


export function isDesktopAvailable(): boolean {
  return typeof window !== "undefined" && !!window.openbuddy;
}


export function createDesktopDirectoryReader(): DirectoryReader {
  return {
    async listDir(path) {
      const entries: Array<{ name: string; path: string; kind: string }> = await invoke(
        "list_dir",
        { path },
      );
      return entries.map((e) => ({ name: e.name, path: e.path, isDir: e.kind === "directory" }));
    },
    async readText(path) {
      try {
        return await invoke<string>("read_text_file", { path, cwd: null, maxBytes: 256 * 1024 });
      } catch {
        return null;
      }
    },
    async readBytes(path) {
      try {
        const base64 = await invoke<string>("read_file_base64", { path, maxBytes: 1024 * 1024 });
        return base64ToBytes(base64);
      } catch {
        // 命令不存在(docx 索引需要后端 read_file_base64 支持);降级为不提取 docx。
        return null;
      }
    },
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]*;base64,/, "").replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
