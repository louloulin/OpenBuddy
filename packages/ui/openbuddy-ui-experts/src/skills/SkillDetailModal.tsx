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
import { skillsCatalogReadSkill, skillsAdd } from "@/lib/agent/pi-client";
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
  const { meta, body } = useMemo(() => parseFrontmatter(rawMd), [rawMd]);

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

/** Split raw SKILL.md into a frontmatter meta map + body markdown. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const t = raw.trimStart();
  if (!t.startsWith("---")) return { meta: {}, body: raw };
  const afterOpen = t.slice(3);
  const nl = afterOpen.indexOf("\n");
  if (nl === -1) return { meta: {}, body: raw };
  const rest = afterOpen.slice(nl + 1);
  const closeIdx = rest.search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return { meta: {}, body: raw };
  const fm = rest.slice(0, closeIdx);
  const bodyStart = rest.indexOf("\n", closeIdx + 1);
  const body = bodyStart >= 0 ? rest.slice(bodyStart + 1).trim() : "";

  const meta: Record<string, string> = {};
  let currentKey = "";
  for (const line of fm.split("\n")) {
    // Top-level key: value
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m && !line.startsWith(" ")) {
      currentKey = m[1];
      let v = m[2].trim();
      // Strip quotes.
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v && v !== "|" && v !== "|-" && v !== ">" && v !== ">-") {
        meta[currentKey] = v;
      }
    } else if (currentKey && line.startsWith(" ") && meta[currentKey] !== undefined) {
      // Continuation of a plain multi-line value — append.
      meta[currentKey] += " " + line.trim();
    }
  }
  return { meta, body };
}
