import type { ExpertEntry, ExpertSceneInfo } from "@openbuddy/protocol/experts";
import { ScrollRow } from "../shared/ui";
import { ExpertAvatar } from "./ExpertAvatar";

/** 精选场景 strip: themed gradient cards, each listing up to three experts from the live catalog. */
export function FeaturedScenes({
  scenes, expertById, onOpen,
}: {
  scenes: ExpertSceneInfo[];
  expertById: Map<string, ExpertEntry>;
  onOpen: (expert: ExpertEntry) => void;
}) {
  const visible = scenes
    .map((scene) => ({ scene, members: scene.expertIds.map((id) => expertById.get(id)).filter((x): x is ExpertEntry => !!x).slice(0, 3) }))
    .filter((s) => s.members.length > 0);
  if (visible.length === 0) return null;
  return (
    <section className="ec-scenes">
      <h3 className="ec-section-title">精选场景</h3>
      <ScrollRow className="ec-scenes-row">
        {visible.map(({ scene, members }) => (
          <article key={scene.id} className="ec-scene-card ex-scene" style={{ background: `linear-gradient(150deg, ${scene.from}, ${scene.to})` }}>
            <div className="ec-scene-name">{scene.title}</div>
            <div className="ex-scene-desc">{scene.description}</div>
            <div className="ec-scene-list">
              {members.map((m) => (
                <button key={m.id} type="button" className="ec-scene-expert" onClick={() => onOpen(m)}>
                  <ExpertAvatar name={m.name} emoji={m.emoji} image={m.image} seed={m.id} size={26} />
                  <span className="ec-scene-expert-name">{m.name}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </ScrollRow>
    </section>
  );
}
