/**
 * 专家编辑器 (20261116-pii W2.3): create / edit / duplicate one of 我的专家. This is the old
 * AssistantsPanel `CreateColleagueDialog` folded into the experts flow — same dialog shell and
 * fields (avatar, name, description, prompt, "从模板创建") — extended with what an expert file
 * holds: category, sample tasks, tags, model, thinking level, tools, skills and connectors.
 */
import { useEffect, useMemo, useState } from "react";
import type { ExpertCategoryInfo, ExpertDraft, ExpertEntry } from "@openbuddy/protocol/experts";
import type { McpServerEntry, SkillInfo } from "@openbuddy/protocol/dto";
import { agentsSave, agentsTemplate, flattenModels, mcpList, providersList, skillsList, type ModelOptionRow } from "@openbuddy/client/agent-client";
import { XCloseIcon } from "@openbuddy/ui/icon/icons/index";
import { ExpertAvatar } from "./ExpertAvatar";
import { AVATAR_PRESETS, THINKING_OPTIONS, TOOL_OPTIONS, draftOf, errorText } from "./expert-model";

interface Props {
  draft: ExpertDraft;
  categories: ExpertCategoryInfo[];
  /** Read-only experts offered under 从模板创建 (new experts only). */
  templates: ExpertEntry[];
  onCancel: () => void;
  onSaved: (expert: ExpertEntry, created: boolean) => void;
}

const lines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

export function ExpertEditor({ draft: initial, categories, templates, onCancel, onSaved }: Props) {
  const [d, setD] = useState<ExpertDraft>(initial);
  const [tab, setTab] = useState<"create" | "template">("create");
  const [examples, setExamples] = useState((initial.examples ?? []).join("\n"));
  const [tags, setTags] = useState((initial.tags ?? []).join("，"));
  const [advanced, setAdvanced] = useState(!!(initial.model || initial.thinking || initial.tools || initial.skills || initial.connectors));
  const [models, setModels] = useState<ModelOptionRow[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [connectors, setConnectors] = useState<McpServerEntry[]>([]);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isNew = !initial.id;
  const set = <K extends keyof ExpertDraft>(key: K, value: ExpertDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Pickers for the advanced section (best-effort: an empty list just hides the choice).
  useEffect(() => {
    if (!advanced) return;
    let disposed = false;
    void providersList().then((list) => { if (!disposed) setModels(flattenModels(list)); }).catch(() => {});
    void skillsList().then((list) => { if (!disposed) setSkills(list.filter((s) => s.enabled)); }).catch(() => {});
    void mcpList().then((list) => { if (!disposed) setConnectors(list); }).catch(() => {});
    return () => { disposed = true; };
  }, [advanced]);

  const value = useMemo<ExpertDraft>(() => {
    const out: ExpertDraft = { ...d, examples: lines(examples).slice(0, 8), tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 8) };
    if (!out.model) delete out.model;
    if (!out.thinking) delete out.thinking;
    return out;
  }, [d, examples, tags]);

  const pickTemplate = (template: ExpertEntry) => {
    const next = draftOf(template, true);
    setD(next);
    setExamples((next.examples ?? []).join("\n"));
    setTags((next.tags ?? []).join("，"));
    setAdvanced(!!(next.model || next.thinking || next.tools));
    setTab("create");
  };

  const toggle = (key: "tools" | "skills" | "connectors", name: string) =>
    setD((prev) => {
      const current = prev[key] ?? [];
      return { ...prev, [key]: current.includes(name) ? current.filter((n) => n !== name) : [...current, name] };
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await agentsSave(value, isNew ? "create" : "update");
      onSaved(saved, isNew);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const showMarkdown = async () => {
    if (markdown !== null) return setMarkdown(null);
    try { setMarkdown(await agentsTemplate(value)); } catch (e) { setError(errorText(e)); }
  };

  const canSave = !!value.name.trim() && !!value.prompt.trim() && !saving;
  return (
    <div className="modal-overlay create-colleague-overlay" onClick={onCancel}>
      <div className="create-colleague-dialog ex-editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={isNew ? "创建专家" : `编辑 ${initial.name}`}>
        <div className="create-colleague-header">
          <h3>{isNew ? (initial.name ? "复制专家" : "创建专家") : `编辑 ${initial.name}`}</h3>
          <button className="create-colleague-close" onClick={onCancel} aria-label="关闭"><XCloseIcon size="md" /></button>
        </div>

        {isNew && templates.length > 0 && (
          <div className="create-colleague-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "create"} className={`create-colleague-tab${tab === "create" ? " create-colleague-tab--active" : ""}`} onClick={() => setTab("create")}>自定义创建</button>
            <button role="tab" aria-selected={tab === "template"} className={`create-colleague-tab${tab === "template" ? " create-colleague-tab--active" : ""}`} onClick={() => setTab("template")}>从模板创建</button>
          </div>
        )}

        {tab === "template" ? (
          <div className="create-colleague-hire-body">
            <p className="create-colleague-hire-desc">选一位现有专家作为起点，复制后可以自由修改。</p>
            <div className="create-colleague-hire-grid">
              {templates.map((t) => (
                <button key={t.id} className="create-colleague-hire-card" onClick={() => pickTemplate(t)}>
                  <ExpertAvatar name={t.name} emoji={t.emoji} image={t.image} seed={t.id} size={36} />
                  <div className="create-colleague-hire-card-info">
                    <span className="create-colleague-hire-card-name">{t.name}</span>
                    <span className="create-colleague-hire-card-desc">{t.description ?? ""}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="create-colleague-body">
            <div className="create-colleague-field">
              <span className="create-colleague-label">头像</span>
              <div className="create-colleague-avatar-picker">
                <ExpertAvatar name={d.name || "?"} emoji={d.avatar} size={56} seed={d.name} />
                <div className="ex-emoji-grid">
                  {AVATAR_PRESETS.map((emoji) => (
                    <button key={emoji} type="button" aria-label={`头像 ${emoji}`} className={`ex-emoji${d.avatar === emoji ? " ex-emoji--on" : ""}`} onClick={() => set("avatar", emoji)}>{emoji}</button>
                  ))}
                  <input className="create-colleague-input ex-emoji-input" aria-label="自定义头像" maxLength={8} value={d.avatar ?? ""} onChange={(e) => set("avatar", e.target.value)} placeholder="自定义" />
                </div>
              </div>
            </div>
            <div className="ex-row">
              <label className="create-colleague-field ex-grow">
                <span className="create-colleague-label">名称 *</span>
                <input className="create-colleague-input" aria-label="专家名称" value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="例如：周报助手" />
              </label>
              <label className="create-colleague-field">
                <span className="create-colleague-label">类别</span>
                <select className="create-colleague-input" aria-label="类别" value={d.category ?? "custom"} onChange={(e) => set("category", e.target.value)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                </select>
              </label>
            </div>
            <label className="create-colleague-field">
              <span className="create-colleague-label">简介</span>
              <input className="create-colleague-input" aria-label="简介" value={d.description ?? ""} maxLength={300} onChange={(e) => set("description", e.target.value)} placeholder="一句话说明这位专家擅长什么" />
            </label>
            <label className="create-colleague-field">
              <span className="create-colleague-label">人设 *</span>
              <textarea className="create-colleague-textarea" aria-label="人设" rows={8} value={d.prompt} onChange={(e) => set("prompt", e.target.value)}
                placeholder={"写给模型的角色设定，例如：\n你是一名……，擅长……\n## 工作方式\n- ……\n## 输出规范\n- ……"} />
              <span className="ex-hint">召唤后会追加到任务的系统提示词里，不会出现在对话中。</span>
            </label>
            <label className="create-colleague-field">
              <span className="create-colleague-label">示例任务（每行一个，召唤时预填第一个）</span>
              <textarea className="create-colleague-textarea ex-plain" aria-label="示例任务" rows={3} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="帮我把这周的工作整理成周报" />
            </label>
            <label className="create-colleague-field">
              <span className="create-colleague-label">标签（用逗号分隔）</span>
              <input className="create-colleague-input" aria-label="标签" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="周报，总结" />
            </label>

            <button type="button" className="ex-link" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>{advanced ? "▾ 高级设置" : "▸ 高级设置（模型、思考、工具、技能、连接器）"}</button>
            {advanced && (
              <div className="ex-advanced">
                <div className="ex-row">
                  <label className="create-colleague-field ex-grow">
                    <span className="create-colleague-label">模型</span>
                    <select className="create-colleague-input" aria-label="模型" value={d.model ?? ""} onChange={(e) => set("model", e.target.value || undefined)}>
                      <option value="">跟随任务设置</option>
                      {d.model && !models.some((m) => m.id === d.model) && <option value={d.model}>{d.model}</option>}
                      {models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.providerLabel}</option>)}
                    </select>
                  </label>
                  <label className="create-colleague-field">
                    <span className="create-colleague-label">思考档位</span>
                    <select className="create-colleague-input" aria-label="思考档位" value={d.thinking ?? ""} onChange={(e) => set("thinking", (e.target.value || undefined) as ExpertDraft["thinking"])}>
                      {THINKING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="create-colleague-field">
                  <span className="create-colleague-label">工具</span>
                  <label className="ex-check"><input type="checkbox" checked={!d.tools} onChange={(e) => set("tools", e.target.checked ? undefined : ["read", "ls", "find", "grep"])} />不限制（跟随“做一做 / 想一想 / 问一问”）</label>
                  {d.tools && (
                    <div className="create-colleague-tags">
                      {TOOL_OPTIONS.map((t) => (
                        <button key={t.name} type="button" title={t.hint} className={`create-colleague-tag${d.tools!.includes(t.name) ? " create-colleague-tag--on" : ""}`} onClick={() => toggle("tools", t.name)}>{t.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                {skills.length > 0 && (
                  <div className="create-colleague-field">
                    <span className="create-colleague-label">优先使用的技能</span>
                    <div className="create-colleague-tags">
                      {skills.map((s) => <button key={s.name} type="button" className={`create-colleague-tag${d.skills?.includes(s.name) ? " create-colleague-tag--on" : ""}`} onClick={() => toggle("skills", s.name)}>{s.displayName || s.name}</button>)}
                    </div>
                  </div>
                )}
                {connectors.length > 0 && (
                  <div className="create-colleague-field">
                    <span className="create-colleague-label">连接器</span>
                    <div className="create-colleague-tags">
                      {connectors.map((c) => <button key={c.name} type="button" className={`create-colleague-tag${d.connectors?.includes(c.name) ? " create-colleague-tag--on" : ""}`} onClick={() => toggle("connectors", c.name)}>{c.name}</button>)}
                    </div>
                  </div>
                )}
              </div>
            )}
            {markdown !== null && <pre className="ex-persona" aria-label="Markdown 预览">{markdown}</pre>}
          </div>
        )}

        {error && <div className="ex-error" role="alert">{error}</div>}
        <div className="create-colleague-footer">
          {tab === "create" && <button className="btn btn--ghost ex-footer-left" onClick={showMarkdown} disabled={!value.name.trim()}>{markdown === null ? "查看 Markdown" : "隐藏 Markdown"}</button>}
          <button className="btn btn--ghost" onClick={onCancel}>取消</button>
          {tab === "create" && <button className="btn btn--primary" onClick={save} disabled={!canSave}>{saving ? "保存中…" : isNew ? "创建" : "保存"}</button>}
        </div>
      </div>
    </div>
  );
}
