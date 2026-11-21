import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon, CheckIcon, SparklesIcon } from "@openbuddy/ui/icon/icons/index";
import { teamsInstall, teamsList } from "@openbuddy/client/agent-client";
import type { TeamTemplate } from "@openbuddy/protocol/teams";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * 专家团 (pii W3.5): preset pipelines of built-in experts. Each card shows the stages in order;
 * 添加到我的指令 writes a normal prompt template (`/team-...`) that tells the model to run the
 * stages with ob_subagent chain — there is no separate team runtime.
 */
export function TeamCards({ onToast, onSearch }: { onToast?: (m: string) => void; onSearch?: (q: string) => void }) {
  const [teams, setTeams] = useState<TeamTemplate[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try { setTeams(await teamsList()); }
    catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const install = async (team: TeamTemplate) => {
    setBusy(team.id); setError("");
    try {
      const next = await teamsInstall(team.id);
      setTeams((current) => current.map((t) => (t.id === next.id ? next : t)));
      onToast?.(`已添加到我的指令：对话里输入 /${team.command} 运行「${team.name}」`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy("");
    }
  };

  if (!teams.length && !error) return null;
  return (
    <section className="team-cards" aria-label="专家团">
      <div className="ec-list-head">
        <h3 className="ec-section-title">专家团<span className="ex-count">{teams.length}</span></h3>
        <span className="team-cards__hint">有顺序的专家组合，安装后以我的指令运行</span>
      </div>
      {error && <p className="res-panel__error" role="alert">{error}</p>}
      <div className="team-cards__grid">
        {teams.map((team) => (
          <article key={team.id} className="team-card">
            <h4 className="team-card__title">{team.name}</h4>
            <p className="team-card__desc">{team.description}</p>
            <ol className="team-card__stages">
              {team.stages.map((stage, index) => (
                <li key={`${team.id}-${index}`} className="team-card__stage">
                  <span className="team-card__role">{stage.role}</span>
                  <button
                    type="button"
                    className="team-card__expert"
                    title={`查看 ${stage.expertName}`}
                    onClick={() => onSearch?.(stage.expertName)}
                  >
                    {stage.expertName}
                  </button>
                  {index < team.stages.length - 1 && <ChevronRightIcon size="sm" className="team-card__arrow" />}
                </li>
              ))}
            </ol>
            <div className="team-card__actions">
              <code className="team-card__command">/{team.command}</code>
              {team.installed ? (
                <span className="team-card__installed"><CheckIcon size="sm" /> 已在我的指令</span>
              ) : (
                <button type="button" className="inspiration-card__save" disabled={busy === team.id} onClick={() => { void install(team); }}>
                  <SparklesIcon size="sm" /> {busy === team.id ? "安装中…" : "添加到我的指令"}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
