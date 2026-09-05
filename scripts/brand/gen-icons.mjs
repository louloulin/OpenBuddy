#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Regenerate every raster icon from the single vector source of truth.
//
//   source : src/assets/logo-mark.svg
//   outputs: app-icon.png           README / press master (1024, transparent)
//            public/favicon.ico     browser tab (16/32/48)
//            build/icon.icns        macOS app bundle (electron-builder)
//            build/icon.ico         Windows app + installer (needs 256)
//            build/icon.png         Linux app (512)
//
// `build/` is gitignored, so this must run before packaging on a fresh clone.
// Run with: pnpm brand:icons
//
// Requires: librsvg (rsvg-convert) + ImageMagick (magick). macOS `iconutil`
// is used for .icns when available; otherwise .icns is skipped with a warning.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = join(ROOT, "src/assets/logo-mark.svg");

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

const has = (cmd) => {
  try {
    run("command", ["-v", cmd]);
    return true;
  } catch {
    try {
      run(cmd, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }
};

/** Rasterize the source SVG at `size` square, preserving transparency. */
const png = (size, out) => {
  mkdirSync(dirname(out), { recursive: true });
  run("rsvg-convert", ["-w", String(size), "-h", String(size), "-b", "none", SOURCE, "-o", out]);
  return out;
};

if (!existsSync(SOURCE)) throw new Error(`missing vector source: ${SOURCE}`);
for (const bin of ["rsvg-convert", "magick"]) {
  if (!has(bin)) throw new Error(`missing dependency: ${bin} (brew install librsvg imagemagick)`);
}

const tmp = mkdtempSync(join(tmpdir(), "openbuddy-icons-"));
const done = [];

try {
  // README / press master + Linux app icon.
  done.push(png(1024, join(ROOT, "app-icon.png")));
  done.push(png(512, join(ROOT, "build/icon.png")));

  // Multi-resolution .ico files. Windows installers reject an .ico without 256.
  const icoFrames = (sizes) => sizes.map((s) => png(s, join(tmp, `ico-${s}.png`)));
  mkdirSync(join(ROOT, "public"), { recursive: true });
  run("magick", [...icoFrames([16, 32, 48]), join(ROOT, "public/favicon.ico")]);
  done.push(join(ROOT, "public/favicon.ico"));
  run("magick", [...icoFrames([16, 32, 48, 64, 128, 256]), join(ROOT, "build/icon.ico")]);
  done.push(join(ROOT, "build/icon.ico"));

  // macOS .icns via iconutil (Apple's own packer; keeps the retina variants).
  if (has("iconutil")) {
    const set = join(tmp, "OpenBuddy.iconset");
    mkdirSync(set, { recursive: true });
    for (const [size, name] of [
      [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
      [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
      [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
      [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
      [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
    ]) png(size, join(set, name));
    mkdirSync(join(ROOT, "build"), { recursive: true });
    run("iconutil", ["-c", "icns", set, "-o", join(ROOT, "build/icon.icns")]);
    done.push(join(ROOT, "build/icon.icns"));
  } else {
    console.warn("! iconutil not found (non-macOS host) — skipped build/icon.icns");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

for (const file of done) console.log(`✓ ${file.replace(`${ROOT}/`, "")}`);
