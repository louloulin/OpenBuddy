/**
 * MemoryPanel —— 本地两层记忆面板(阶段 1.5)。
 *
 * 两层:user(全局)/ workspace(按当前 cwd)。数据面是 `memory:*` IPC →
 * `<agentHome>/memory.json`(串行写入,不丢条目)。云层明确不做。
 *
 * 交互只有四件真事:列、搜索、增、删/改 —— 每件都**写后端再刷新**,
 * 不做本地乐观更新(本仓库"本地翻转 + 成功 toast"正是假成功的形态)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DeleteIcon, EditToolIcon, SearchIcon } from "@openbuddy/ui-primitives/icons";
import {
  createMemoryClient,
  type OpenBuddyMemoryEntry,
  type OpenBuddyMemoryScope,
} from "@openbuddy/ui-contract/memory-client";
import { useLocale } from "@openbuddy/ui-locale/client";

export interface MemoryPanelProps {
  /** 当前工作区 cwd —— 决定 workspace 层能看到哪些条目。 */
  cwd?: string;
  onToast?: (message: string) => void;
  /**
   * IPC 出口由调用方注入:UI 包不反向依赖应用的 `@/` 层(否则单包测试无法独立跑)。
   * 调用方传应用的 invoke 包装即可。
   */
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
}

type ScopeFilter = OpenBuddyMemoryScope | "all";

export function MemoryPanel({ cwd, onToast, invoke }: MemoryPanelProps) {
  const locale = useLocale();
  const memory = useMemo(() => createMemoryClient(invoke as never), [invoke]);
  const [entries, setEntries] = useState<OpenBuddyMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftScope, setDraftScope] = useState<OpenBuddyMemoryScope>("user");
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // 传 cwd:用户层 + 当前工作区层都回来;不传就只剩用户层。
      setEntries(await memory.list({ cwd, query: query.trim() || undefined }));
    } catch (error) {
      onToast?.(locale.t("memory.listFailed", { message: String(error).replace(/^Error:\s*/, "") }));
    } finally {
      setLoading(false);
    }
  }, [memory, cwd, query, onToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(
    () => (scope === "all" ? entries : entries.filter((entry) => entry.scope === scope)),
    [entries, scope],
  );

  const handleAdd = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title) return;
    try {
      await memory.add({
        title,
        body: draftBody.trim() || title,
        scope: draftScope,
        ...(draftScope === "workspace" ? { cwd } : {}),
      });
      setDraftTitle("");
      setDraftBody("");
      await reload();
    } catch (error) {
      onToast?.(locale.t("memory.addFailed", { message: String(error).replace(/^Error:\s*/, "") }));
    }
  }, [memory, draftTitle, draftBody, draftScope, cwd, reload, onToast]);

  const handleDelete = useCallback(
    async (entry: OpenBuddyMemoryEntry) => {
      try {
        await memory.remove(entry.id);
        await reload();
      } catch (error) {
        onToast?.(locale.t("memory.deleteFailed", { message: String(error).replace(/^Error:\s*/, "") }));
      }
    },
    [memory, reload, onToast],
  );

  const handleRename = useCallback(
    async (entry: OpenBuddyMemoryEntry, title: string) => {
      const next = title.trim();
      if (!next || next === entry.title) {
        setEditingId(null);
        return;
      }
      try {
        await memory.update(entry.id, { title: next });
        await reload();
      } catch (error) {
        onToast?.(locale.t("memory.updateFailed", { message: String(error).replace(/^Error:\s*/, "") }));
      } finally {
        setEditingId(null);
      }
    },
    [memory, reload, onToast],
  );

  return (
    <section className="memory-panel" aria-label={locale.t("memory.title")}>
      <header className="memory-panel__head">
        <div className="memory-panel__title" aria-label={locale.t("memory.title")}>{locale.t("memory.title")}</div>
        <p className="memory-panel__hint">{locale.t("memory.subtitle")}</p>
      </header>

      <div className="memory-panel__filters">
        <label className="memory-panel__search">
          <SearchIcon size="sm" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={locale.t("memory.searchPlaceholder")}
            aria-label={locale.t("memory.searchPlaceholder")}
          />
        </label>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as ScopeFilter)}
          aria-label={locale.t("memory.scopeAll")}
        >
          <option value="all">{locale.t("memory.scopeAll")}</option>
          <option value="user">{locale.t("memory.writeUser")}</option>
          <option value="workspace">{locale.t("memory.writeWorkspace")}</option>
        </select>
      </div>

      <div className="memory-panel__composer">
        <input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          placeholder={locale.t("memory.composerTitle")}
          aria-label={locale.t("memory.composerTitle")}
        />
        <textarea
          value={draftBody}
          onChange={(event) => setDraftBody(event.target.value)}
          placeholder={locale.t("memory.composerBody")}
          aria-label={locale.t("memory.composerBody")}
          rows={2}
        />
        <div className="memory-panel__composer-row">
          <select
            value={draftScope}
            onChange={(event) => setDraftScope(event.target.value as OpenBuddyMemoryScope)}
            aria-label={locale.t("memory.writeUser")}
          >
            <option value="user">{locale.t("memory.writeUser")}</option>
            <option value="workspace">{locale.t("memory.writeWorkspace")}</option>
          </select>
          <button type="button" onClick={() => void handleAdd()} disabled={!draftTitle.trim() || loading}>
            {locale.t("memory.add")}
          </button>
        </div>
      </div>

      <p className="memory-panel__count" data-testid="memory-panel-count">
        {loading ? locale.t("memory.loading") : locale.t("memory.count", { count: String(visible.length) })}
      </p>

      <ul className="memory-panel__list">
        {visible.map((entry) => (
          <li key={entry.id} className="memory-panel__item" data-testid={`memory-item-${entry.id}`}>
            <div className="memory-panel__item-head">
              {editingId === entry.id ? (
                <input
                  autoFocus
                  defaultValue={entry.title}
                  aria-label={locale.t("memory.composerTitle")}
                  onBlur={(event) => void handleRename(entry, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleRename(entry, (event.target as HTMLInputElement).value);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <strong>{entry.title}</strong>
              )}
              <span className={`memory-panel__badge memory-panel__badge--${entry.scope}`}>
                {entry.scope === "user" ? locale.t("memory.scopeBadgeUser") : locale.t("memory.scopeBadgeWorkspace")}
              </span>
              <button
                type="button"
                aria-label={locale.t("memory.renameAria", { title: entry.title })}
                onClick={() => setEditingId(entry.id)}
              >
                <EditToolIcon size="sm" />
              </button>
              <button
                type="button"
                aria-label={locale.t("memory.deleteAria", { title: entry.title })}
                onClick={() => void handleDelete(entry)}
              >
                <DeleteIcon size="sm" />
              </button>
            </div>
            {entry.body && entry.body !== entry.title ? <p className="memory-panel__body">{entry.body}</p> : null}
            {entry.tags.length > 0 ? (
              <div className="memory-panel__tags">
                {entry.tags.map((tag) => (
                  <span key={tag} className="memory-panel__tag">#{tag}</span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {!loading && visible.length === 0 ? (
        <p className="memory-panel__empty" data-testid="memory-panel-empty">
          {query.trim() ? locale.t("memory.emptySearch") : locale.t("memory.empty")}
        </p>
      ) : null}
    </section>
  );
}
