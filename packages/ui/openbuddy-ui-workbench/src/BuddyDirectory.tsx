import { useMemo } from "react";
import type { CollaborationSnapshot } from "@/lib/agent/assistant-facade";

type TrustLevel = "local" | "org" | "known_peer" | "public";
type BuddyStatus = "offline" | "idle" | "working" | "paused";

interface BuddyEntry {
  id: string;
  handle: string;
  displayName: string;
  ownerUserId?: string;
  organizationId?: string;
  trustLevel: TrustLevel;
  status: BuddyStatus;
  source: "self" | "organization" | "peer";
  trust?: "pending" | "known" | "trusted" | "blocked" | "revoked";
  capabilities?: Array<{ id: string; description: string }>;
  agentCardStatus?: "missing" | "unverified" | "verified";
  lastSeenAt?: string;
  firstSeenAt?: string;
  presenceExpiresAt?: string;
  active?: boolean;
  role?: "owner" | "admin" | "member" | "auditor";
}

const TRUST_LABEL: Record<TrustLevel, string> = {
  local: "本地",
  org: "组织",
  known_peer: "已知 Peer",
  public: "公开",
};

const STATUS_LABEL: Record<BuddyStatus, string> = {
  offline: "离线",
  idle: "空闲",
  working: "工作中",
  paused: "已暂停",
};

const SOURCE_LABEL: Record<BuddyEntry["source"], string> = {
  self: "本人",
  organization: "组织成员",
  peer: "网络 Peer",
};

const TRUST_TONE: Record<TrustLevel, string> = {
  local: "buddy-directory__trust--local",
  org: "buddy-directory__trust--org",
  known_peer: "buddy-directory__trust--peer",
  public: "buddy-directory__trust--public",
};

/**
 * Aggregate every visible Buddy from the local collaboration projection into a
 * single directory. The view is intentionally read-only — authority for
 * collaboration still flows through the assistant facade's typed clients and
 * the Pi tool chain, never through this component.
 */
export function BuddyDirectory({ snapshot, loading }: { snapshot: CollaborationSnapshot | null; loading: boolean }) {
  const entries = useMemo<BuddyEntry[]>(() => {
    if (!snapshot) return [];
    const out: BuddyEntry[] = [];
    out.push({
      id: snapshot.identity.id,
      handle: snapshot.identity.handle,
      displayName: snapshot.identity.displayName,
      trustLevel: "local",
      status: snapshot.identity.status,
      source: "self",
    });
    for (const member of snapshot.organization.members) {
      if (member.identity.id === snapshot.identity.id) continue;
      out.push({
        id: member.identity.id,
        handle: member.identity.handle,
        displayName: member.identity.displayName,
        ownerUserId: member.identity.ownerUserId,
        organizationId: member.identity.organizationId,
        trustLevel: member.identity.trustLevel as BuddyEntry["trustLevel"],
        status: member.identity.status as BuddyEntry["status"],
        source: "organization",
        active: member.active,
        role: member.role,
      });
    }
    for (const peer of snapshot.network.peers) {
      out.push({
        id: peer.identity.id,
        handle: peer.identity.handle,
        displayName: peer.identity.displayName,
        organizationId: peer.identity.organizationId,
        trustLevel: peer.identity.trustLevel as BuddyEntry["trustLevel"],
        status: peer.identity.status as BuddyEntry["status"],
        source: "peer",
        trust: peer.trust,
        capabilities: peer.capabilities,
        agentCardStatus: peer.agentCardStatus,
        firstSeenAt: peer.firstSeenAt,
        lastSeenAt: peer.lastSeenAt,
        presenceExpiresAt: peer.presence?.expiresAt,
      });
    }
    return out;
  }, [snapshot]);

  if (loading && entries.length === 0) {
    return <p className="buddy-directory__empty">正在读取 Buddy 投影…</p>;
  }
  if (entries.length === 0) {
    return <p className="buddy-directory__empty">当前没有可见 Buddy。先添加组织成员或注册一个网络 Peer。</p>;
  }

  const counts = entries.reduce<Record<BuddyEntry["source"], number>>(
    (acc, entry) => {
      acc[entry.source] = (acc[entry.source] ?? 0) + 1;
      return acc;
    },
    { self: 0, organization: 0, peer: 0 },
  );

  return (
    <section className="buddy-directory" aria-label="Buddy 目录">
      <header className="buddy-directory__header">
        <div>
          <h3>Buddy 目录</h3>
          <p>本人 {counts.self} · 组织 {counts.organization} · Peer {counts.peer}</p>
        </div>
        <span className="buddy-directory__note">
          Discovery ≠ Authorization：此处只展示可见 Buddy；协作前需通过 Federated Room Grant 精确授权。
        </span>
      </header>
      <ul className="buddy-directory__list">
        {entries.map((entry) => (
          <li key={entry.id} className={"buddy-directory__card buddy-directory__card--" + entry.source}>
            <div className="buddy-directory__card-head">
              <span className="buddy-directory__avatar" aria-hidden>{entry.displayName.slice(0, 1)}</span>
              <div className="buddy-directory__card-main">
                <strong>{entry.displayName}</strong>
                <span className="buddy-directory__handle">@{entry.handle}</span>
              </div>
              <span className={"buddy-directory__trust " + TRUST_TONE[entry.trustLevel]}>{TRUST_LABEL[entry.trustLevel]}</span>
            </div>
            <dl className="buddy-directory__meta">
              <div><dt>来源</dt><dd>{SOURCE_LABEL[entry.source]}</dd></div>
              <div><dt>状态</dt><dd>{STATUS_LABEL[entry.status]}</dd></div>
              {entry.organizationId && <div><dt>组织</dt><dd>{entry.organizationId}</dd></div>}
              {entry.role && <div><dt>角色</dt><dd>{entry.role}</dd></div>}
              {entry.trust && <div><dt>网络信任</dt><dd>{entry.trust}</dd></div>}
              {entry.agentCardStatus && <div><dt>Agent Card</dt><dd>{entry.agentCardStatus}</dd></div>}
              {entry.lastSeenAt && <div><dt>最近活跃</dt><dd>{new Date(entry.lastSeenAt).toLocaleString()}</dd></div>}
              {entry.active === false && <div><dt>组织状态</dt><dd>已停用</dd></div>}
            </dl>
            {entry.capabilities && entry.capabilities.length > 0 && (
              <ul className="buddy-directory__caps" aria-label="已声明能力">
                {entry.capabilities.map((cap) => (
                  <li key={cap.id}><code>{cap.id}</code><span>{cap.description}</span></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type { BuddyEntry };
