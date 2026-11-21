import type { ExpertCategoryInfo, ExpertEntry } from "@openbuddy/protocol/experts";
import { ExpertAvatar } from "./ExpertAvatar";
import { subtitle } from "./expert-model";

/** Expert card (专家中心 grid): avatar, name, category · source, two-line description, tags,
 *  and a 召唤 button revealed on hover. Clicking the card opens the detail view. */
export function ExpertCard({
  expert, categories, onOpen, onSummon,
}: {
  expert: ExpertEntry;
  categories: ExpertCategoryInfo[];
  onOpen: (expert: ExpertEntry) => void;
  onSummon: (expert: ExpertEntry) => void;
}) {
  return (
    <article className="ec-card" data-expert-id={expert.id} onClick={() => onOpen(expert)} title={`查看「${expert.name}」`}>
      <button type="button" className="ec-card-summon" aria-label={`召唤 ${expert.name}`}
        onClick={(ev) => { ev.stopPropagation(); onSummon(expert); }}>
        召唤
      </button>
      <div className="ec-card-head">
        <ExpertAvatar name={expert.name} emoji={expert.emoji} image={expert.image} seed={expert.id} />
        <div className="ec-card-titles">
          <div className="ec-card-title-row">
            <span className="ec-card-title">{expert.name}</span>
            {expert.scope !== "builtin" && <span className={`ex-scope ex-scope--${expert.scope}`}>{expert.scope === "user" ? "我的" : expert.scope === "project" ? "项目" : "专家库"}</span>}
          </div>
          <div className="ec-card-sub">{subtitle(expert, categories)}</div>
        </div>
      </div>
      {expert.description && <p className="ec-card-desc">{expert.description}</p>}
      {expert.tags.length > 0 && (
        <div className="ec-card-tags">
          {expert.tags.slice(0, 3).map((t) => (
            <span key={t} className="ec-card-tag">{t}</span>
          ))}
        </div>
      )}
    </article>
  );
}
