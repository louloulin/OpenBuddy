import type { ExpertCategoryInfo, ExpertEntry } from "@openbuddy/protocol/experts";
import { ChevronLeftIcon, DeleteIcon, EditToolIcon } from "@openbuddy/ui/icon/icons/index";
import { ExpertAvatar } from "./ExpertAvatar";
import { MyExpertsEmpty } from "./MyExpertsEmpty";
import { subtitle } from "./expert-model";

interface Props {
  experts: ExpertEntry[];
  categories: ExpertCategoryInfo[];
  loading: boolean;
  userDir?: string;
  /** WorkBuddy package import (S18): ZIP picker + conversion progress. */
  importing?: boolean;
  onImportWorkbuddy?: () => void;
  /** 从链接或本地包导入 (B3b). */
  onImportLink?: () => void;
  onBack: () => void;
  onCreate: () => void;
  onOpen: (expert: ExpertEntry) => void;
  onSummon: (expert: ExpertEntry) => void;
  onEdit: (expert: ExpertEntry) => void;
  onDuplicate: (expert: ExpertEntry) => void;
  onDelete: (expert: ExpertEntry) => void;
}

/** 我的专家: the user's own experts (and the trusted project's, read-only) with 召唤 / 编辑 / 复制 / 删除. */
export function MyExperts({ experts, categories, loading, userDir, importing, onImportWorkbuddy, onImportLink, onBack, onCreate, onOpen, onSummon, onEdit, onDuplicate, onDelete }: Props) {
  return (
    <div className="um-page">
      <header className="um-topbar">
        <div className="um-topbar-left">
          <button type="button" className="um-back" onClick={onBack}>
            <ChevronLeftIcon size="sm" /><span>专家中心</span>
          </button>
          <span className="ex-page-title">我的专家</span>
        </div>
        <div className="um-topbar-right">
          {onImportLink && (
            <button type="button" className="um-btn um-btn--grey" onClick={onImportLink} title="从 https 链接或本地包导入专家">
              从链接导入
            </button>
          )}
          {onImportWorkbuddy && (
            <button type="button" className="um-btn um-btn--grey" disabled={importing} onClick={onImportWorkbuddy} title="导入 WorkBuddy 导出的 .zip 专家包">
              {importing ? "导入中…" : "导入 WorkBuddy"}
            </button>
          )}
          <button type="button" className="um-btn um-btn--primary" onClick={onCreate}>+ 创建专家</button>
        </div>
      </header>
      <div className="um-scroll">
        {userDir && <p className="ex-dir-hint" title={userDir}>保存在 <code>{userDir}</code>，每位专家是一个 Markdown 文件。</p>}
        {loading && experts.length === 0 ? (
          <div className="ec-loading">加载中…</div>
        ) : experts.length === 0 ? (
          <MyExpertsEmpty onCreate={onCreate} />
        ) : (
          <div className="ec-my-grid">
            {experts.map((e) => (
              <article key={e.path} className="ec-my-card ex-my-card" data-expert-id={e.id} onClick={() => onOpen(e)}>
                <div className="ec-card-head">
                  <ExpertAvatar name={e.name} emoji={e.emoji} image={e.image} seed={e.id} />
                  <div className="ec-card-titles">
                    <div className="ec-card-title">{e.name}</div>
                    <div className="ec-card-sub">{subtitle(e, categories)}</div>
                  </div>
                </div>
                <p className="ec-card-desc">{e.description || "（无简介）"}</p>
                <div className="ec-my-card-foot" onClick={(ev) => ev.stopPropagation()}>
                  <button type="button" className="um-btn um-btn--grey ex-summon" onClick={() => onSummon(e)}>召唤</button>
                  <div className="ex-card-actions">
                    {e.scope === "user" && (
                      <button type="button" className="ec-my-del ex-icon-btn" title="编辑" aria-label={`编辑 ${e.name}`} onClick={() => onEdit(e)}><EditToolIcon size="sm" /></button>
                    )}
                    <button type="button" className="ec-my-del ex-icon-btn" title="复制" aria-label={`复制 ${e.name}`} onClick={() => onDuplicate(e)}>⧉</button>
                    {e.scope === "user" && (
                      <button type="button" className="ec-my-del" title="删除" aria-label={`删除 ${e.name}`} onClick={() => onDelete(e)}><DeleteIcon size="sm" /></button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            <button type="button" className="ec-create-tile" onClick={onCreate}>
              <span className="ec-create-plus">+</span><span>创建专家</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
