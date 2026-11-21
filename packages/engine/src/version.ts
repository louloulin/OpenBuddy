import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Version of the bundled Pi SDK, read from its package manifest. */
export const PI_VERSION = (() => {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve("@earendil-works/pi-coding-agent"));
    for (let depth = 0; depth < 6; depth++, dir = dirname(dir)) {
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@earendil-works/pi-coding-agent" && pkg.version) return pkg.version;
    }
  } catch {
    /* Fall through to an explicit unknown marker. */
  }
  return "unknown";
})();
