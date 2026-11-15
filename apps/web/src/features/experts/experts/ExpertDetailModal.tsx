/**
 * Expert detail: avatar, name, category · source, ability intro, tags, what it changes in a task
 * (model / thinking / tools), 试试这样问我 sample tasks, the persona itself (collapsed), and the
 * actions: 召唤 (pre-fills the composer, never sends), 复制到我的专家 / 编辑 / 导入.
 */
import { useEffect, useRef, useState } from "react";
import type { ExpertCategoryInfo, ExpertEntry } from "@openbuddy/protocol/experts";
import { expertsImageBytes } from "@openbuddy/client/agent-client";
import { ExpertAvatar } from "./ExpertAvatar";
import { capabilityChips, subtitle } from "./expert-model";

interface Props {
  expert: ExpertEntry;
  categories: ExpertCategoryInfo[];
  onClose: () => void;
  /** 召唤 with an optional sample task to pre-fill. */
  onSummon: (expert: ExpertEntry, example?: string) => void;
  /** 复制到我的专家 (read-only experts) — opens the editor with a copy. */
  onDuplicate: (expert: ExpertEntry) => void;
  /** 编辑 (the user's own experts). */
  onEdit: (expert: ExpertEntry) => void;
  /** 导入到我的专家 (experts from a library directory). */
  onImport?: (expert: ExpertEntry) => void;
}

export function ExpertDetailModal({ expert, categories, onClose, onSummon, onDuplicate, onEdit, onImport }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [showPersona, setShowPersona] = useState(false);
  const [hero, setHero] = useState<string>();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Image avatars are shown full size here (cards use the small thumbnail).
  useEffect(() => {
    setHero(undefined);
    if (!expert.image) return;
    let disposed = false;
    expertsImageBytes(expert.image).then((url) => { if (!disposed) setHero(url); }).catch(() => {});
    return () => { disposed = true; };
  }, [expert.image]);

  const examples = expert.examples.filter(Boolean).slice(0, 5);
  return (
    <div className="ec-modal-overlay" ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="ec-modal ex-modal" role="dialog" aria-label={`专家：${expert.name}`}>
        <button className="ec-modal-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="ec-modal-header">
          {hero ? <img className="ex-hero" src={hero} alt="" /> : <ExpertAvatar name={expert.name} emoji={expert.emoji} image={expert.image} seed={expert.id} size={64} />}
          <div className="ec-modal-info">
            <div className="ec-modal-title">{expert.name}</div>
            <div className="ec-modal-meta"><span>{subtitle(expert, categories)}</span></div>
          </div>
        </div>

        {expert.description && (
          <div className="ec-modal-section">
            <div className="ec-modal-section-title">能力介绍</div>
            <p className="ec-modal-desc">{expert.description}</p>
          </div>
        )}

        <div className="ec-modal-section">
          <div className="ec-modal-section-title">工作方式</div>
          <div className="ec-modal-tags">
            {[...expert.tags, ...capabilityChips(expert)].map((t) => <span key={t} className="ec-modal-tag">{t}</span>)}
          </div>
        </div>

        {examples.length > 0 && (
          <div className="ec-modal-section">
            <div className="ec-modal-section-title">试试这样问我</div>
            <div className="ec-modal-quick-prompts">
              {examples.map((example) => (
                <button key={example} className="ec-modal-qp-btn" onClick={() => onSummon(expert, example)}>
                  <span className="ec-modal-qp-text">“{example}”</span>
                  <span className="ec-modal-qp-arrow">›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ec-modal-section">
          <button type="button" className="ex-link" aria-expanded={showPersona} onClick={() => setShowPersona((v) => !v)}>
            {showPersona ? "收起人设" : "查看人设"}
          </button>
          {showPersona && <pre className="ex-persona">{expert.prompt}</pre>}
        </div>

        <div className="ex-modal-actions">
          {expert.scope === "user" ? (
            <button type="button" className="um-btn" onClick={() => onEdit(expert)}>编辑</button>
          ) : expert.scope === "library" && onImport ? (
            <button type="button" className="um-btn" onClick={() => onImport(expert)}>导入到我的专家</button>
          ) : (
            <button type="button" className="um-btn" onClick={() => onDuplicate(expert)}>复制到我的专家</button>
          )}
          <button className="ec-modal-summon-btn" onClick={() => onSummon(expert)}>召唤 {expert.name}</button>
        </div>
      </div>
    </div>
  );
}
