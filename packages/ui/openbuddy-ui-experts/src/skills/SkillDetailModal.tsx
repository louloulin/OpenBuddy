/**
 * Skill detail view — shown when clicking a skill card, mirrors WorkBuddy's
 * SkillDetailView: a header (icon + name + description + install/try buttons),
 * a preview/source toggle, and the rendered SKILL.md markdown body.
 *
 * Unlike WorkBuddy (which inlines the view), we use a full-screen overlay so
 * the back button returns to the skill grid without disturbing the grid state.
 */
import { useEffect, useMemo, useState } from "react";
import type { SkillItem, SkillInfo } from "@openbuddy/shared-types";
import { parseSkillFrontmatter, skillsCatalogReadSkill, skillsAdd } from "@/lib/agent/pi-client";
import { useFrontmatter } from "@openbuddy/ui-shared";
import { Markdown } from "@openbuddy/ui-markdown";
import { ConnectorIcon } from "../shared/ConnectorIcon";
import { LetterAvatar } from "../shared/LetterAvatar";
import {
  ChevronLeftIcon, AddIcon, CheckIcon, FileTextIcon, Code2Icon,
} from "@openbuddy/ui-primitives/icons";

interface Props {
  skill: SkillItem;
  onClose: () => void;
  /** Installed skills (from pi), to show install state + toggle. */
  installed?: SkillInfo[];
  onInstalled?: () => void;
  onToast?: (m: string) => void;
  root?: string;
}

export function SkillDetailModal({ skill, installed = [], onClose, onInstalled, onToast, root }: Props) {
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [rawMd, setRawMd] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setRawMd("");
    skillsCatalogReadSkill(skill.sourceDir, root)
      .then((txt) => { if (!disposed) setRawMd(txt); })
      .catch(() => { if (!disposed) setRawMd(""); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [skill.sourceDir, root]);

  // Parse frontmatter + body from the raw markdown.
  // Phase E.3 round 2 — delegate to the shared `useFrontmatter` hook
  // (lives in `@openbuddy/ui-shared`) so any ui-* package can render
  // SKILL.md-style frontmatter without re-implementing the IPC plumbing.
  // The hook wraps `parseSkillFrontmatter` (pi-bridge IPC) and owns the
  // useState/useEffect/race-condition cleanup ceremony. See
  // docs/OPENBUDDY_PI_NATIVE_PLAN.md §E.3 for the IPC rationale.
  const { meta, body } = useFrontmatter(rawMd, { parse: parseSkillFrontmatter });

  // Is this skill already installed in pi?
  const installedEntry = useMemo(
    () => installed.find((s) => (s.displayName || s.name).toLowerCase() === skill.name.toLowerCase()
      || s.name.toLowerCase() === skill.id.toLowerCase()),
    [installed, skill.name, skill.id],
  );

  const handleInstall = async () => {
    if (installing || installedEntry) return;
    setInstalling(true);
    try {
      await skillsAdd(skill.sourceDir);
      onToast?.(`已导入技能「${skill.name}」`);
      onInstalled?.();
    } catch (e) {
      onToast?.(`导入失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setInstalling(false);
    }
  };

  const displayName = meta.name || skill.name;
  const description = skill.desc || meta.description || "";

  return (
    <div className="sk-detail-overlay" onClick={onClose}>
      <div className="sk-detail" onClick={(e) => e.stopPropagation()}>
        {/* Header bar with back button */}
        <div className="sk-detail-bar">
          <button type="button" className="um-back" onClick={onClose}>
            <ChevronLeftIcon size="sm" /><span>技能市场</span>
          </button>
        </div>

        <div className="sk-detail-scroll">
          {/* Header: icon + name + description + actions */}
          <div className="sk-detail-header">
            {skill.iconLocal ? (
              <ConnectorIcon local={skill.iconLocal} name={displayName} size={56} shape="square" root={root} />
            ) : (
              <LetterAvatar name={displayName} size={56} shape="square" />
            )}
            <div className="sk-detail-headinfo">
              <h2 className="sk-detail-title">{displayName}</h2>
              {description && <p className="sk-detail-sub">{description}</p>}
              <div className="sk-detail-actions">
                {installedEntry ? (
                  <>
                    <span className="sk-detail-installed">
                      <CheckIcon size="sm" /><span>已安装</span>
                    </span>
                    <label className="sk-toggle" title={installedEntry.enabled ? "已启用" : "已禁用"}>
                      <input type="checkbox" checked={installedEntry.enabled} readOnly />
                      <span className="sk-toggle-track"><span className="sk-toggle-thumb" /></span>
                    </label>
                  </>
                ) : (
                  <button type="button" className="sk-detail-install-btn" onClick={handleInstall} disabled={installing}>
                    <AddIcon size="sm" /><span>{installing ? "导入中…" : "导入技能"}</span>
                  </button>
                )}
                {meta.version && <span className="sk-detail-ver">v{meta.version}</span>}
              </div>
            </div>
          </div>

          {/* Toolbar: preview / source toggle */}
          <div className="sk-detail-toolbar">
            <button type="button"
              className={`sk-detail-tab${mode === "preview" ? " sk-detail-tab--active" : ""}`}
              onClick={() => setMode("preview")}>
              <FileTextIcon size="sm" /><span>预览</span>
            </button>
            <button type="button"
              className={`sk-detail-tab${mode === "code" ? " sk-detail-tab--active" : ""}`}
              onClick={() => setMode("code")}>
              <Code2Icon size="sm" /><span>源码</span>
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="sk-detail-loading">加载技能详情…</div>
          ) : mode === "code" ? (
            <pre className="sk-detail-code"><code>{rawMd}</code></pre>
          ) : (
            <div className="sk-detail-content">
              {/* Meta grid (frontmatter key-values, excluding slug/name/description) */}
              {Object.keys(meta).length > 0 && (
                <div className="sk-detail-meta-grid">
                  {Object.entries(meta)
                    .filter(([k]) => !["slug", "name", "description", "description_zh", "description_en"].includes(k))
                    .map(([k, v]) => (
                      <div key={k} className="sk-detail-meta-item">
                        <span className="sk-detail-meta-label">{k}</span>
                        <span className="sk-detail-meta-value">{v}</span>
                      </div>
                    ))}
                </div>
              )}
              {body ? (
                <Markdown complete>{body}</Markdown>
              ) : (
                <p className="sk-detail-empty">该技能暂无详细说明</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
