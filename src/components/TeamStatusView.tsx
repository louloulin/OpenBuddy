
import { useMemo } from "react";
import { deriveTeams, teamStats } from "@/lib/team-derive";
import type { ChatMessage } from "@/stores/session-store";

interface TeamStatusViewProps {
  messages?: ChatMessage[];
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "创建中",
  completed: "已就绪",
  failed: "失败",
};

export function TeamStatusView({ messages }: TeamStatusViewProps) {
  const teams = useMemo(() => {
    if (!messages) return [];
    return deriveTeams(messages);
  }, [messages]);

  const stats = useMemo(() => teamStats(teams), [teams]);

  if (teams.length === 0) return null;

  return (
    <div className="team-status-view" role="region" aria-label="团队状态">
      <div className="team-status-view__head">
        <span className="team-status-view__title">团队</span>
        <span className="team-status-view__summary">
          {stats.teamCount} 个 · {stats.memberCount} 名成员
        </span>
      </div>
      <ul className="team-status-view__list">
        {teams.map((t) => (
          <li
            key={t.id}
            className={"team-status-view__row team-status-view__row--" + t.status}
          >
            <span className="team-status-view__icon">👥</span>
            <div className="team-status-view__info">
              <div className="team-status-view__name-line">
                <span className="team-status-view__team-id">{t.teamId || "(未命名)"}</span>
                <span className="team-status-view__status">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              {t.members.length > 0 && (
                <div className="team-status-view__members">
                  {t.members.map((m, i) => (
                    <span key={i} className="team-status-view__member-chip">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
