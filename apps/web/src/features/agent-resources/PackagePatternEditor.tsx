import { useState } from "react";
import type {
  ExtensionPackage,
  ExtensionPackageFilters,
  ExtensionResourceKind,
} from "@openbuddy/protocol/extensions";

/** The resource types a Pi package entry can filter, with their Chinese labels. */
const RESOURCE_KINDS: Array<[ExtensionResourceKind, string]> = [
  ["extensions", "扩展"], ["skills", "技能"], ["prompts", "指令"], ["themes", "主题"],
];

/** One row of the editor: is the type loaded, and which patterns decide it. */
type DraftRow = { on: boolean; patterns: string };
type Draft = Record<ExtensionResourceKind, DraftRow>;

/** Read the package's current Pi filters into editable rows. */
function draftOf(entry: ExtensionPackage): Draft {
  const draft = {} as Draft;
  for (const [kind] of RESOURCE_KINDS) {
    const value = entry.filters?.[kind];
    draft[kind] = {
      on: value !== false,
      patterns: Array.isArray(value) ? value.join(", ") : "",
    };
  }
  return draft;
}

/**
 * Pi 包资源过滤模式 (E1): edit the glob patterns Pi applies inside the package folder.
 *
 * Pi's own syntax is used verbatim — `+path` force-includes, `-path` force-excludes, `!pattern`
 * excludes and a bare pattern includes. An empty pattern list loads every resource of that type;
 * switching the type off writes Pi's `[]`, which loads none of it.
 */
export function PackagePatternEditor({
  entry,
  onApply,
}: {
  entry: ExtensionPackage;
  onApply: (filters: ExtensionPackageFilters) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry));

  const patch = (kind: ExtensionResourceKind, next: Partial<DraftRow>) =>
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...next } }));

  const apply = () => {
    const filters: ExtensionPackageFilters = {};
    for (const [kind] of RESOURCE_KINDS) {
      const row = draft[kind];
      if (!row.on) {
        filters[kind] = false;
        continue;
      }
      const patterns = row.patterns.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
      filters[kind] = patterns.length ? patterns : true;
    }
    onApply(filters);
  };

  return <div className="ext-package__patterns" aria-label={`${entry.source} 过滤模式`}>
    {RESOURCE_KINDS.map(([kind, label]) => (
      <label key={kind} className="ext-package__pattern">
        <input
          type="checkbox"
          checked={draft[kind].on}
          aria-label={`${entry.source} ${label} 启用`}
          onChange={(event) => patch(kind, { on: event.target.checked })}
        />
        <span className="ext-package__pattern-label">{label}</span>
        <input
          className="ext-package__pattern-input"
          aria-label={`${entry.source} ${label} 模式`}
          value={draft[kind].patterns}
          placeholder="全部（留空）"
          spellCheck={false}
          onChange={(event) => patch(kind, { patterns: event.target.value })}
        />
      </label>
    ))}
    <button type="button" className="res-panel__btn res-panel__btn--primary" onClick={apply}>保存过滤</button>
    <p className="res-panel__muted">
      Pi glob 语法：<code>+路径</code> 强制包含、<code>-路径</code> 强制排除、<code>!模式</code> 排除、无前缀为包含；多个模式用逗号分隔。留空表示该类型全部加载。
    </p>
  </div>;
}
