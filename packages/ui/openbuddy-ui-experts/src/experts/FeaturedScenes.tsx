import { useEffect, useState } from "react";
import type { ExpertItem, FeaturedScene } from "@openbuddy/shared-types";
import { expertsImageBytes } from "@/lib/agent/pi-client";
import { ThumbImg } from "../shared/ThumbImg";
import { ScrollRow } from "../shared/ui";

/** path -> resolved data URL (banners are few and above-the-fold, so a plain
 *  module cache is enough — no IntersectionObserver needed). */
const bannerCache = new Map<string, string>();
const bannerInflight = new Map<string, Promise<string>>();

function loadBanner(path: string, root?: string): Promise<string> {
  const key = `${root ?? ""}\0${path}`;
  const hit = bannerCache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = bannerInflight.get(path);
  if (!p) {
    p = expertsImageBytes(path, root)
      .then((dataUrl) => {
        if (dataUrl) bannerCache.set(key, dataUrl);
        return dataUrl || "";
      })
      .catch(() => "")
      .finally(() => {
        bannerInflight.delete(key);
      });
    bannerInflight.set(key, p);
  }
  return p;
}

/** Top 精选场景 strip: banner cards (local photo → remote photo → themed
 *  gradient), each listing up to 3 experts resolved from the live catalog. */
export function FeaturedScenes({
  scenes, expertById, onSummon,
  root,
}: {
  scenes: FeaturedScene[];
  expertById: Map<string, ExpertItem>;
  onSummon: (expert: ExpertItem) => void;
  root?: string;
}) {
  if (scenes.length === 0) return null;
  return (
    <section className="ec-scenes">
      <h3 className="ec-section-title">精选场景</h3>
      <ScrollRow className="ec-scenes-row">
        {scenes.map((scene) => {
          const members = scene.expertIds
            .map((id) => expertById.get(id))
            .filter((x): x is ExpertItem => !!x)
            .slice(0, 3);
          if (members.length === 0) return null;
          const gradient = scene.from && scene.to
            ? `linear-gradient(150deg, ${scene.from}, ${scene.to})`
            : "var(--wb-bg-tertiary)";
          return (
            <article key={scene.id} className="ec-scene-card" style={{ background: gradient }}>
              <SceneBanner local={scene.imageLocal} remote={scene.image} root={root} />
              <div className="ec-scene-name">{scene.zh}</div>
              <div className="ec-scene-list">
                {members.map((m) => (
                  <button key={m.id} type="button" className="ec-scene-expert"
                    onClick={() => onSummon(m)}>
                    <ThumbImg name={m.name} local={m.avatarLocal} url={m.avatarUrl} root={root}
                      size={24} shape="circle" />
                    <span className="ec-scene-expert-name">{m.title || m.name}</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </ScrollRow>
    </section>
  );
}

/** Banner image: prefer the local file (read via command), then the remote URL;
 *  on any failure it renders nothing so the card's gradient shows through. */
function SceneBanner({ local, remote, root }: { local?: string; remote?: string; root?: string }) {
  const [src, setSrc] = useState<string | undefined>(() =>
    local ? bannerCache.get(`${root ?? ""}\0${local}`) : remote,
  );
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
    if (!local) {
      setSrc(remote);
      return;
    }
    const hit = bannerCache.get(`${root ?? ""}\0${local}`);
    if (hit) {
      setSrc(hit);
      return;
    }
    setSrc(remote); // remote (or undefined) until the local bytes resolve
    let disposed = false;
    loadBanner(local, root).then((u) => {
      if (!disposed && u) setSrc(u);
    });
    return () => {
      disposed = true;
    };
  }, [local, remote, root]);

  if (broken || !src) return null;
  return (
    <img className="ec-scene-bg" src={src} alt="" loading="lazy"
      onError={() => setBroken(true)} />
  );
}
