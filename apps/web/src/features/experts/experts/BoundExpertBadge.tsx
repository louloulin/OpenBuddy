import { ThumbImg } from "../../../shared/ui/ThumbImg";

/**
 * The expert bound to the open task (chat header): avatar + name, and × to unbind. The persona,
 * model, thinking level and tools it applied stay in effect until it is removed here.
 */
export function BoundExpertBadge({ name, avatar, onClear }: { name: string; avatar?: string; onClear?: () => void }) {
  return (
    <span className="expert-badge ex-bound" data-tip={`专家：${name}（人设、模型与工具已应用到此任务）`} data-testid="bound-expert">
      <ThumbImg name={name} local={avatar} size={18} shape="circle" />
      <span className="ex-bound-name">{name}</span>
      {onClear && (
        <button type="button" className="ex-bound-clear" aria-label={`移除专家 ${name}`} title="移除专家" onClick={onClear}>×</button>
      )}
    </span>
  );
}
