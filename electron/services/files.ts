import { constants } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { text } from "./settings.js";
export interface DesktopShell {
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): void;
}
function pathOf(p: Record<string, unknown>) {
  return resolve(
    typeof p.cwd === "string" ? p.cwd : process.cwd(),
    text(p.path, "path"),
  );
}
function limit(value: unknown, defaultValue: number, max: number) {
  if (value === undefined || value === null) return defaultValue;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw Error("无效的文件读取限制");
  return value;
}
async function read(path: string, max: number) {
  const fd = await open(path, "r");
  try {
    if (!(await fd.stat()).isFile()) throw Error("不是文件");
    const buffer = Buffer.alloc(max + 1);
    const { bytesRead } = await fd.read(buffer, 0, max + 1, 0);
    return {
      bytes: buffer.subarray(0, Math.min(bytesRead, max)),
      truncated: bytesRead > max,
    };
  } finally {
    await fd.close();
  }
}
export async function workspacePath(root: string, path: string) {
  const canonicalRoot = await realpath(root),
    lexicalRoot = resolve(root),
    raw = resolve(lexicalRoot, path),
    lexicalRelative = relative(lexicalRoot, raw);
  const candidate =
    lexicalRelative !== ".." &&
    !lexicalRelative.startsWith(`..${sep}`) &&
    !isAbsolute(lexicalRelative)
      ? resolve(canonicalRoot, lexicalRelative)
      : raw;
  const rel = relative(canonicalRoot, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error("拒绝工作区外路径");
  let parent = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      parent = await realpath(parent);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(basename(parent));
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  const actual = join(parent, ...missing),
    actualRel = relative(canonicalRoot, actual);
  if (
    actualRel === ".." ||
    actualRel.startsWith(`..${sep}`) ||
    isAbsolute(actualRel)
  )
    throw Error("拒绝符号链接越出工作区");
  return actual;
}
export function fileHandlers(shell: DesktopShell, getWorkspace: () => string) {
  return {
    read_text_file: async (p: Record<string, unknown>) => {
      const r = await read(
        pathOf(p),
        limit(p.maxBytes, 256 * 1024, 16 * 1024 * 1024),
      );
      return (
        r.bytes.toString("utf8") +
        (r.truncated ? "\n\n…(已截断，仅预览前部分内容)" : "")
      );
    },
    read_file_base64: async (p: Record<string, unknown>) => {
      const r = await read(
        pathOf(p),
        limit(p.maxBytes, 1024 * 1024, 32 * 1024 * 1024),
      );
      if (r.truncated) throw Error("文件超过读取限制");
      return r.bytes.toString("base64");
    },
    write_text_file: async (p: Record<string, unknown>) => {
      const root = text(p.workspaceRoot);
      if (!isAbsolute(root)) throw Error("工作区必须为绝对路径");
      if ((await realpath(root)) !== (await realpath(getWorkspace())))
        throw Error("工作区不匹配当前会话");
      const path = await workspacePath(root, text(p.path));
      if (typeof p.content !== "string") throw Error("content必须为字符串");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, p.content, {
        flag:
          constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_TRUNC |
          constants.O_NOFOLLOW,
        mode: 0o600,
      });
      return path;
    },
    list_dir: async (p: Record<string, unknown>) => {
      const path = pathOf(p),
        max = limit(p.maxEntries, 2000, 10000),
        entries = await readdir(path, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          ["node_modules", "target", "dist", "build"].includes(entry.name)
        )
          continue;
        const file = join(path, entry.name);
        result.push({
          name: entry.name,
          path: file,
          kind: entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
          size: entry.isFile() ? (await stat(file)).size : 0,
        });
        if (result.length >= max) break;
      }
      return result.sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name),
      );
    },
    path_stat: async (p: Record<string, unknown>) => {
      const absolute = pathOf(p);
      try {
        const s = await stat(absolute);
        return {
          path: p.path,
          absolute,
          exists: true,
          kind: s.isDirectory() ? "directory" : s.isFile() ? "file" : "other",
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return { path: p.path, absolute, exists: false, kind: "missing" };
      }
    },
    open_path: async (p: Record<string, unknown>) => {
      const error = await shell.openPath(pathOf(p));
      if (error) throw Error(error);
    },
    browse_directory: async (p: Record<string, unknown>) => {
      let path = pathOf(p);
      if (!(await stat(path)).isDirectory()) path = dirname(path);
      const error = await shell.openPath(path);
      if (error) throw Error(error);
    },
    reveal_in_folder: async (p: Record<string, unknown>) => {
      const path = pathOf(p);
      await stat(path);
      shell.showItemInFolder(path);
    },
    open_url: async (p: Record<string, unknown>) => {
      const url = new URL(text(p.url));
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error("不支持的 URL");
      await shell.openExternal(url.href);
    },
  };
}
