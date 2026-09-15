/**
 * SkillRecommendBar — 技能推荐栏 (Phase 4 新功能)
 * 横向滚动展示工作流 / 技能推荐，点击填充到 Composer 输入框。
 * 使用 @openbuddy/ui-motion/Marquee + Skeleton 占位
 */
import { memo, useState } from "react";
import { Marquee, Skeleton } from "@openbuddy/ui-primitives";
import { useT } from "@/lib/platform/i18n";

export interface SkillRecommend {
  id: string;
  icon: string;
  label: string;
  prompt: string;
}

export interface SkillRecommendBarProps {
  skills: ReadonlyArray<SkillRecommend>;
  onSelectSkill(skill: SkillRecommend): void;
  loading?: boolean;
}

export const SkillRecommendBar = memo(function SkillRecommendBar({
  skills, onSelectSkill, loading,
}: SkillRecommendBarProps) {
  const [paused, setPaused] = useState(false);
  const titleText = useT("skill.bar.title");

  if (loading) {
    return (
      <div className="skill-recommend-bar skill-recommend-bar--loading">
        <Skeleton width={80} height={12} />
        <div style={{ display: "flex", gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width={140} height={48} radius={10} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="skill-recommend-bar">
      <div className="skill-recommend-bar__title">{titleText}</div>
      <Marquee speed={30} pauseOnHover>
        {skills.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className="skill-recommend-chip"
            onClick={() => onSelectSkill(skill)}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <span className="skill-recommend-chip__icon" aria-hidden>{skill.icon}</span>
            <span className="skill-recommend-chip__label">{skill.label}</span>
          </button>
        ))}
      </Marquee>
      {paused && <span className="skill-recommend-bar__hint">⏸</span>}
    </div>
  );
});
