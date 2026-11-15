import { ThumbImg } from "../../../shared/ui/ThumbImg";

/** Soft tile palette, picked from the expert id so a card keeps its color. */
const TILES = ["#e8f0ff", "#ffeef0", "#e9f7ef", "#f2ecff", "#fff4e0", "#e6f6fa", "#f6f0e6", "#eef1f4"];
const tile = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length];
};

/** An expert's avatar: an image inside an expert directory, else the emoji on a soft tile, else the initial. */
export function ExpertAvatar({ name, emoji, image, seed, size = 44 }: { name: string; emoji?: string; image?: string; seed?: string; size?: number }) {
  if (image) return <ThumbImg name={name} local={image} size={size} shape="square" />;
  if (!emoji) return <ThumbImg name={name} size={size} shape="square" />;
  return (
    <span
      className="ex-avatar"
      role="img"
      aria-label={name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52), borderRadius: Math.round(size * 0.28), background: tile(seed ?? name) }}
    >
      {emoji}
    </span>
  );
}
