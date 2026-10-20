import type { SkillItem } from "@openbuddy/shared-types";
import { AddIcon, CheckIcon, SparklesIcon } from "@openbuddy/ui-primitives/icons";
import { ConnectorIcon } from "../shared/ConnectorIcon";
import { LetterAvatar } from "../shared/LetterAvatar";

/** One skill card in the catalog grid. Connector skills show their
 *  connector icon; built-in skills fall back to a letter tile. Clicking the
 *  card body opens the detail view; the + button installs directly. */
export function SkillCatalogCard({
  skill, installed, onAdd, onOpen,
  root,
}: {
  skill: SkillItem;
  installed?: boolean;
  onAdd: (skill: SkillItem) => void;
  onOpen: (skill: SkillItem) => void;
  root?: string;
}) {
  // 卡片内嵌了一个真实 <button>(安装),把容器换成 <button> 会产生非法的
  // 按钮嵌套;保留容器元素并补 role + tabIndex + 键盘事件,让键盘用户能激活卡片。
  const openFromCard = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(skill); }
  };
  return (
    <div className={`sk-card${installed ? " sk-card--installed" : ""}`}
      role="button" tabIndex={0}
      onClick={() => onOpen(skill)}
      onKeyDown={openFromCard}
      style={{ cursor: "pointer" }}>
      <div className="sk-card-top">
        {skill.iconLocal ? (
          <ConnectorIcon local={skill.iconLocal} name={skill.name} size={32} shape="square" root={root} />
        ) : (
          <LetterAvatar name={skill.name} size={32} shape="square" />
        )}
        <button type="button"
          className={`sk-add${installed ? " sk-add--done" : ""}`}
          title={installed ? "已安装" : "安装 / 导入"}
          onClick={(e) => { e.stopPropagation(); !installed && onAdd(skill); }}
          disabled={installed}>
          {installed ? <CheckIcon size="sm" /> : <AddIcon size="sm" />}
        </button>
      </div>
      <div className="sk-card-title">
        {skill.featured && <SparklesIcon size={12} className="sk-card-star" />}
        <span className="sk-card-name-text">{skill.name}</span>
      </div>
      <p className="sk-card-desc">{skill.desc || "（无描述）"}</p>
    </div>
  );
}
