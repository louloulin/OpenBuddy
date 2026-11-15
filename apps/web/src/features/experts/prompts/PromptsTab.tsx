import { useCallback, useEffect, useState } from "react";
import {
  AddCircleIcon, DeleteIcon, EditToolIcon, RefreshCwIcon, SearchIcon, ChevronLeftIcon,
} from "@openbuddy/ui/icon/icons/index";
import {
  promptsDelete, promptsList, promptsSave,
} from "@openbuddy/client/agent-client";
import type { PromptInfo } from "@openbuddy/client/agent-client";
import { Chip } from "../shared/ui";

/**
 * 我的指令 (20261116-pii W2.7 / S8): Pi prompt templates. Every template is a Markdown file in
 * 应用数据目录/pi/prompts（全局）或受信任任务的 .pi/prompts（项目），通过 Pi 的 `promptsOverride`
 * 进入 `/` 菜单 — 在这里新建或编辑，下一个任务里输入 `/名字` 即可展开。
 */
interface Props {
  pills: React.ReactNode;
  onToast?: (m: string) => void;
  cwd?: string;
}

export function PromptsTab({ pills, onToast, cwd }: Props) {
  const [items, setItems] = useState<PromptInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "edit">("list");
  const [editing, setEditing] = useState<{ name: string; description: string; argumentHint: string; content: string; scope: "global" | "workspace"; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await promptsList(cwd));
    } catch (e) {
      onToast?.(`加载指令失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setLoading(false);
    }
  }, [cwd, onToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await promptsSave(
        { name: editing.name, description: editing.description || undefined, argumentHint: editing.argumentHint || undefined, content: editing.content },
        editing.scope,
        cwd,
      );
      onToast?.(editing.isNew ? "已创建指令，输入 /名字 即可调用" : "已保存");
      setEditing(null);
      setView("list");
      await reload();
    } catch (e) {
      onToast?.(`保存失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [editing, cwd, onToast, reload]);

  const handleDelete = useCallback(
    async (item: PromptInfo) => {
      if (!window.confirm(`确定删除「${item.name}」？`)) return;
      try {
        await promptsDelete(item.scope, item.name, cwd);
        onToast?.("已删除");
        await reload();
      } catch (e) {
        onToast?.(`删除失败：${String(e).replace(/^Error:\s*/, "")}`);
      }
    },
    [cwd, onToast, reload],
  );

  const filtered = items.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase()),
  );
  const globalCount = items.filter((p) => p.scope === "global").length;

  if (view === "edit" && editing) {
    return (
      <div className="um-prompts">
        <div className="um-topbar">
          <div className="um-topbar__left">
            <button className="um-prompts__back" onClick={() => { setEditing(null); setView("list"); }}>
              <ChevronLeftIcon size="sm" /> 返回
            </button>
          </div>
          {pills}
        </div>
        <div className="um-prompts__editor">
          <div className="um-prompts__editor-row">
            <label>
              指令名（/ 菜单里输入的名字）
              <input
                value={editing.name}
                disabled={!editing.isNew}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="weekly-report"
              />
            </label>
            <label>
              范围
              <select value={editing.scope} disabled={!editing.isNew} onChange={(e) => setEditing({ ...editing, scope: e.target.value === "workspace" ? "workspace" : "global" })}>
                <option value="global">全局</option>
                {cwd && <option value="workspace">工作区</option>}
              </select>
            </label>
          </div>
          <div className="um-prompts__editor-row">
            <label>
              描述（/ 菜单里显示）
              <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="一句话说明这条指令做什么" />
            </label>
            <label>
              参数提示（可选）
              <input value={editing.argumentHint} onChange={(e) => setEditing({ ...editing, argumentHint: e.target.value })} placeholder="<本周要点>" />
            </label>
          </div>
          <label className="um-prompts__editor-content">
            内容（$1、$2… 会被参数替换；$ARGUMENTS 是全部参数）
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              spellCheck={false}
              rows={14}
            />
          </label>
          <div className="um-prompts__editor-actions">
            <button className="btn btn--ghost" onClick={() => { setEditing(null); setView("list"); }}>取消</button>
            <button className="btn btn--primary" disabled={busy} onClick={handleSave}>{busy ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="um-prompts">
      <div className="um-topbar">
        <div className="um-topbar__left" />
        {pills}
      </div>
      <div className="um-prompts__toolbar">
        <div className="um-prompts__search">
          <SearchIcon size="md" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索指令…" />
        </div>
        <button
          className="um-prompts__create"
          onClick={() => { setEditing({ name: "", description: "", argumentHint: "", content: "", scope: "global", isNew: true }); setView("edit"); }}
        >
          <AddCircleIcon size="sm" /> 新建指令
        </button>
        <button className="um-prompts__refresh" onClick={() => void reload()} disabled={loading} title="刷新">
          <RefreshCwIcon size="sm" />
        </button>
      </div>
      <p className="um-prompts__hint">
        指令保存在 <code>应用数据目录/pi/prompts/</code>（全局 {globalCount} 条{cwd ? "，受信任任务另有工作区指令" : ""}）。对话里输入 <code>/指令名</code> 直接展开，参数按 $1、$2 依次填入。
      </p>
      <div className="um-prompts__list">
        {filtered.length === 0 && !loading && (
          <div className="um-prompts__empty">
            <p>还没有指令。新建一条，或把常用的提示词存成模板。</p>
          </div>
        )}
        {filtered.map((item) => (
          <div key={`${item.scope}/${item.name}`} className="um-prompts__item">
            <div className="um-prompts__item-main">
              <div className="um-prompts__item-name">
                /{item.name}
                <span className="um-prompts__item-scope">{item.scope === "global" ? "全局" : "工作区"}</span>
                {item.argumentHint && <code className="um-prompts__item-hint">{item.argumentHint}</code>}
              </div>
              <div className="um-prompts__item-desc">{item.description || item.content.split("\n")[0]?.slice(0, 80)}</div>
            </div>
            <div className="um-prompts__item-actions">
              <button
                className="um-prompts__icon-btn"
                title="编辑"
                onClick={() => { setEditing({ name: item.name, description: item.description, argumentHint: item.argumentHint ?? "", content: item.content, scope: item.scope, isNew: false }); setView("edit"); }}
              >
                <EditToolIcon size="sm" />
              </button>
              <button className="um-prompts__icon-btn um-prompts__icon-btn--danger" title="删除" onClick={() => void handleDelete(item)}>
                <DeleteIcon size="sm" />
              </button>
            </div>
          </div>
        ))}
        {loading && <div className="um-prompts__empty">加载中…</div>}
      </div>
    </div>
  );
}

// Chip re-exported for the shared market look (keeps the import used).
export { Chip as PromptsChip };
