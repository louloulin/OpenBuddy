import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { JsonStore, text, type Settings } from "../settings/settings.js";
import type { LibrarySource } from "@openbuddy/protocol/library";

interface LibraryFile {
  sources: LibrarySource[];
}

/**
 * 资料库 (20261116-pii W5.5): persistent knowledge sources.
 *
 * The 知识库 panel used to register local folders in memory only, so they vanished on restart.
 * This service keeps them in `library.json` (id = the canonical folder path), so the panel can
 * rebuild its local providers on every launch. 我的文件 reads `list_dir` directly and 记忆 has its
 * own service; this is only the knowledge-source registry.
 */
export class LibraryService {
  private store: JsonStore<LibraryFile>;
  constructor(settings: Settings) {
    this.store = new JsonStore(join(settings.dir, "library.json"), () => ({ sources: [] }));
  }
  get path() {
    return this.store.path;
  }
  list(): LibrarySource[] {
    return [...this.store.read().sources].sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1));
  }
  /** Add a folder knowledge source; adding the same folder twice returns the existing entry. */
  addFolder(folder: string): LibrarySource {
    // Canonical path: /var → /private/var symlinks and duplicate spellings collapse to one source.
    const path = realpathSync(resolve(text(folder, "path")));
    const stat = statSync(path);
    if (!stat.isDirectory()) throw Error("library_not_a_folder: 只能添加文件夹作为知识源");
    const file = this.store.read();
    const existing = file.sources.find((source) => source.path === path);
    if (existing) return existing;
    const source: LibrarySource = { id: path, kind: "folder", label: basename(path) || path, path, addedAt: new Date().toISOString() };
    file.sources.push(source);
    this.store.write(file);
    return source;
  }
  remove(id: string) {
    const file = this.store.read();
    const next = file.sources.filter((source) => source.id !== id);
    if (next.length === file.sources.length) throw Error("library_source_not_found: 找不到这个知识源");
    this.store.write({ sources: next });
  }
  /** Drop sources whose folder disappeared (the panel calls this on load). */
  prune(): LibrarySource[] {
    const file = this.store.read();
    const kept = file.sources.filter((source) => existsSync(source.path));
    if (kept.length !== file.sources.length) this.store.write({ sources: kept });
    return kept;
  }
}
