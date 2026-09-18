import type { ExpertItem } from "@openbuddy/shared-types";
import { OpenExternalIcon } from "@openbuddy/ui-primitives/icons";
import { openUrl } from "@/lib/agent/pi-client";
import { ThumbImg } from "../shared/ThumbImg";

/**
 * pi.dev URL builder for an expert's marketplace page. Centralised here so the
 * detail modal and any future “open in pi.dev” affordance reuse the same shape
 * (npm-style scoped slug → "@scope/name", unscoped → "name").
 *
 * Returns null when the slug is missing / malformed so the caller can decide
 * whether to surface the link at all — keeps the card quiet for the majority
 * of items that aren't published on pi.dev.
 */
function piDevUrlFor(slug: string | undefined): string | null {
  if (!slug) return null;
  const trimmed = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  // Reject anything that isn't a safe npm-style slug (letters, digits, dash,
  // underscore, dot, slash — scoped packages look like "@scope/name").
  if (!/^@?[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed)) return null;
  return "https://pi.dev/packages/" + trimmed;
}

/** Subtitle line, mirroring WorkBuddy's `expertUsageText`: teams prefer the
 *  author (e.g. "CodeBuddy Teams"), agents use the display name; whichever is
 *  non-empty and differs from the title and the description. */
function subtitle(e: ExpertItem): string {
  const title = (e.title || e.name || "").trim();
  const desc = (e.desc || "").trim();
  const cands = e.type === "team" ? [e.author, e.name] : [e.name];
  return cands.map((s) => (s || "").trim()).find((s) => s && s !== title && s !== desc) ?? "";
}

/** Expert / team card (截图 1): square avatar, bold 职称, the 特邀专家 ribbon
 *  when present, an author/name subtitle, 2-line description, ≤3 tag chips, and
 *  a 召唤 button revealed on hover. The whole card summons the expert. */
export function ExpertCard({
  expert, root, onSummon,
}: {
  expert: ExpertItem;
  root?: string;
  onSummon: (expert: ExpertItem) => void;
}) {
  const sub = subtitle(expert);
  const title = expert.title || expert.name;
  return (
    <article className="ec-card" onClick={() => onSummon(expert)} title="召唤该专家开始对话">
      <button type="button" className="ec-card-summon"
        onClick={(ev) => { ev.stopPropagation(); onSummon(expert); }}>
        召唤
      </button>
      <div className="ec-card-head">
        <ThumbImg name={expert.name} local={expert.avatarLocal} url={expert.avatarUrl} root={root}
          size={44} shape="circle" />
        <div className="ec-card-titles">
          <div className="ec-card-title-row">
            <span className="ec-card-title">{title}</span>
            {expert.ribbon && (
              <span className="ec-card-ribbon" title={expert.ribbon}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1l1.3.9 1.6-.2.6 1.5 1.4.8-.3 1.6.8 1.4-1 1.3.1 1.6-1.5.5-.9 1.3-1.6-.3L6 11l-1.5-.8-1.6.3-.9-1.3-1.5-.5.1-1.6-1-1.3.8-1.4-.3-1.6 1.4-.8.6-1.5 1.6.2z"
                    fill="var(--ec-ribbon-bg, #3d3d3d)" />
                  <path d="M5.4 7.6 4 6.2l.8-.8.6.6 1.8-1.8.8.8z" fill="#f7d18f" />
                </svg>
                <span>{expert.ribbon}</span>
              </span>
            )}
          </div>
          {sub && <div className="ec-card-sub">{sub}</div>}
        </div>
      </div>
      {expert.desc && <p className="ec-card-desc">{expert.desc}</p>}
      {expert.tags.length > 0 && (
        <div className="ec-card-tags">
          {expert.tags.slice(0, 3).map((t, i) => (
            <span key={i} className="ec-card-tag">{t}</span>
          ))}
        </div>
      )}
      {(() => {
        const url = piDevUrlFor(expert.piDevSlug);
        if (!url) return null;
        return (
          <button
            type="button"
            className="ec-card-pidev"
            onClick={(ev) => { ev.stopPropagation(); openUrl(url).catch(() => { /* swallow — toast is optional */ }); }}
            title={`在 pi.dev 查看 ${expert.piDevSlug}`}
            aria-label={`在 pi.dev 查看 ${expert.title || expert.name}`}
          >
            <OpenExternalIcon size="sm" />
            <span>在 pi.dev 查看</span>
          </button>
        );
      })()}
    </article>
  );
}
