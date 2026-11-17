import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";

/** A file's identity for change detection (size + mtime); undefined when it vanished. */
function fileSignature(path: string): string | undefined {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}

/**
 * 文件触发 (20261116-pii W4.7)：监听工作空间里的某个文件或目录，变化后触发任务。
 *
 * 参照 Pi SDK 随包发布的 `file-trigger` 示例扩展（`examples/extensions/file-trigger.ts`）：
 * 用 `fs.watch` 观察触发路径，把变化的内容注入这一轮对话。差别在于本项目的自动化是
 * 「后台会话 + 提示词」，所以这里只负责**发现变化**（防抖 5 秒），由宿主去跑任务。
 *
 * - 监听文件时观察它的目录（编辑器的原子替换会换 inode），并按文件名过滤。
 * - 监听目录时不递归；一次保存可能触发多个事件，防抖把它们合并成一次。
 * - watcher 不阻止进程退出（`persistent: false`），Electron 退出时不需要额外清理。
 */

export const DEFAULT_DEBOUNCE_MS = 5000;

export interface FileTriggerOptions {
  /** 防抖窗口（毫秒），默认 5000。 */
  debounceMs?: number;
}

export interface FileTriggerChange {
  /** 发生变化的那个路径（文件触发时是文件本身）。 */
  path: string;
  /** 触发时刻。 */
  at: number;
  /** 调用方挂在路径上的信息（例如自动化任务 id）。 */
  meta?: unknown;
}

interface Watched {
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
  debounceMs: number;
  meta?: unknown;
  /** The watched file's signature (size + mtime); a directory event only counts when it changed. */
  signature?: string;
}

export class FileTriggerWatcher {
  private readonly watched = new Map<string, Watched>();

  constructor(
    private readonly onChange: (change: FileTriggerChange) => void,
    private readonly options: FileTriggerOptions = {},
  ) {}

  /** Watch `target` (a file or a directory). Returns false when the path does not exist. */
  watch(target: string, options: { debounceMs?: number; meta?: unknown } = {}): boolean {
    const path = resolve(target);
    const existing = this.watched.get(path);
    if (existing) {
      // Re-watch with the new options (the task's path or debounce may have changed).
      existing.debounceMs = options.debounceMs ?? this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
      existing.meta = options.meta ?? existing.meta;
      return true;
    }
    if (!existsSync(path)) return false;
    const isFile = statSync(path).isFile();
    const dir = isFile ? dirname(path) : path;
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, () => {
        // macOS 不保证给出文件名，所以按「被监听文件的签名是否变化」判断，而不是按文件名过滤。
        if (isFile) {
          const signature = fileSignature(path);
          if (signature === undefined) return;
          const entry = this.watched.get(path);
          if (!entry || entry.signature === signature) return;
          entry.signature = signature;
        }
        this.debounce(path);
      });
    } catch {
      return false;
    }
    watcher.unref?.();
    this.watched.set(path, {
      watcher,
      debounceMs: options.debounceMs ?? this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      meta: options.meta,
      ...(isFile ? { signature: fileSignature(path) } : {}),
    });
    return true;
  }

  /** Stop watching one path. */
  unwatch(target: string): void {
    const path = resolve(target);
    const entry = this.watched.get(path);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    this.watched.delete(path);
  }

  /** Stop watching everything. */
  dispose(): void {
    for (const path of [...this.watched.keys()]) this.unwatch(path);
  }

  get watching(): string[] {
    return [...this.watched.keys()];
  }

  private debounce(path: string) {
    const entry = this.watched.get(path);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      this.onChange({ path, at: Date.now(), meta: entry.meta });
    }, entry.debounceMs);
    entry.timer.unref?.();
  }
}

/**
 * The content injected into the run (Pi's `file-trigger` example sends the file's text).
 * Unreadable or huge files yield an empty body instead of failing the run.
 */
export function readTriggerContent(path: string, limit = 8000): string {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return "";
    const text = readFileSync(path, "utf-8");
    return text.length > limit ? `${text.slice(0, limit)}\n…（内容已截断）` : text;
  } catch {
    return "";
  }
}
