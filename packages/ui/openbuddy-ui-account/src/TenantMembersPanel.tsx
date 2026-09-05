/**
 * OpenBuddy 租户成员管理面板。
 *
 * 列出当前组织（tenantId）下的所有成员、其所属组、是否被禁用，
 * 并允许通过 casdoor:member-revocation 触发单成员撤销/恢复。
 * 与 AccountSettingsPanel 内嵌的 admin overview 不同，本面板专注：
 *  - 列表（按 owner 过滤当前组织）
 *  - 状态徽标（正常 / 已禁用 / 已撤销）
 *  - 一键撤销 / 恢复（带 reason）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldOff, ShieldCheck, Users } from "lucide-react";
import {
  casdoorListUsers,
  casdoorListMemberRevocations,
  casdoorSetMemberRevocation,
  casdoorStatus,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorUserSummary } from "@/lib/casdoor/casdoor-client";
import type { CasdoorMemberRevocation } from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

export function TenantMembersPanel() {
  const [owner, setOwner] = useState<string | null>(null);
  const [members, setMembers] = useState<CasdoorUserSummary[]>([]);
  const [revocations, setRevocations] = useState<CasdoorMemberRevocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySubject, setBusySubject] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const revokedBySubject = useMemo(() => {
    const map = new Map<string, CasdoorMemberRevocation>();
    for (const entry of revocations) {
      if (entry.revoked) map.set(entry.subject, entry);
    }
    return map;
  }, [revocations]);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await casdoorStatus().catch(() => null);
      const orgOwner = session?.identity?.owner ?? null;
      setOwner(orgOwner);
      if (!orgOwner) {
        setMembers([]);
        setRevocations([]);
        return;
      }
      const [users, revokes] = await Promise.all([
        casdoorListUsers({ owner: orgOwner }).catch((error) => {
          setMessage({ kind: "warn", text: `加载成员失败：${describeError(error)}` });
          return [] as CasdoorUserSummary[];
        }),
        casdoorListMemberRevocations().catch((error) => {
          setMessage({ kind: "warn", text: `加载撤销名单失败：${describeError(error)}` });
          return [] as CasdoorMemberRevocation[];
        }),
      ]);
      setMembers(users.filter((user) => user.owner === orgOwner));
      setRevocations(revokes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleToggle = useCallback(async (subject: string, nextRevoked: boolean) => {
    setBusySubject(subject);
    try {
      const result = await casdoorSetMemberRevocation(subject, nextRevoked, nextRevoked ? "管理员手动撤销" : "管理员手动恢复");
      await reload();
      if (result.revoked) {
        setMessage({ kind: "ok", text: `已撤销 ${subject}` });
      } else {
        setMessage({ kind: "ok", text: `已恢复 ${subject}` });
      }
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusySubject(null);
    }
  }, [reload]);

  return (
    <SectionShell
      title="租户成员"
      desc="集中查看当前组织下的成员、其所属组与撤销状态。撤销会让该主体的会话在 Gateway 立即失效，直到手动恢复。"
    >
      {!owner ? (
        <p className="settings-hint">请先登录企业账户，再浏览成员列表。</p>
      ) : (
        <p className="settings-hint">当前组织：<strong>{owner}</strong> · 共 {members.length} 位成员 · 已撤销 {revocations.length} 位</p>
      )}

      <div className="account-section" data-testid="tenant-members-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <Users size={16} /> 成员列表
          </h3>
          <button className="settings-btn" onClick={reload} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        {loading && members.length === 0 ? (
          <p className="settings-hint">正在加载成员…</p>
        ) : members.length === 0 ? (
          <p className="settings-hint">当前组织下没有成员。请通过 Casdoor 管理后台或邀请接口添加。</p>
        ) : (
          <ul className="shortcuts-list" data-testid="tenant-members-list">
            {members.map((user) => {
              const subject = `${user.owner}/${user.name}`;
              const revocation = revokedBySubject.get(subject);
              const forbidden = user.isForbidden === true || revocation !== undefined;
              const groups = user.groups?.length ? user.groups.join(", ") : "—";
              return (
                <li key={subject} className="shortcuts-list__row" data-testid={`tenant-member-row-${user.name}`}>
                  <div className="shortcuts-list__row-meta">
                    <span className="shortcuts-list__action">
                      {user.displayName || user.name} · {user.email ?? user.phone ?? "—"}
                      {user.isAdmin ? <span className="settings-msg--ok"> · 管理员</span> : null}
                      {forbidden ? <span className="settings-msg--err"> · 已撤销</span> : null}
                    </span>
                    <span className="shortcuts-list__key">
                      主体：{subject} · 组：{groups}
                      {user.createdTime ? ` · 创建 ${new Date(user.createdTime).toLocaleString()}` : ""}
                    </span>
                    {revocation?.reason ? (
                      <span className="shortcuts-list__key">撤销原因：{revocation.reason}</span>
                    ) : null}
                  </div>
                  <button
                    className="settings-btn settings-btn--ghost"
                    data-testid={`tenant-member-toggle-${user.name}`}
                    onClick={() => handleToggle(subject, !forbidden)}
                    disabled={busySubject === subject || !owner}
                  >
                    {forbidden ? (
                      <>
                        <ShieldCheck size={14} /> 恢复
                      </>
                    ) : (
                      <>
                        <ShieldOff size={14} /> 撤销
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="tenant-members-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default TenantMembersPanel;
