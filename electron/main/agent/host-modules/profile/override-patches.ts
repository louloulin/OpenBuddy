/**
 * host-modules/profile/override-patches.ts — openbuddy overrides patch file.
 *
 * Phase 8.3 Batch I: 从 agent-host.ts:1080-1137 抽出 (~58 行)
 *   - OVERRIDE_PATCH_FILE 常量 (line 1080)
 *   - overridePatchPath (line 1088) — 检查 openbuddy.overrides.patch.yml 是否存在
 *   - readOverridePatches (line 1104) — 解析 deepseek-harness-style 覆盖补丁
 *
 * 设计:
 *   - state / emitPluginEvent / piHome 通过环形 import 自 ../agent-host
 *   - parseCordisPatch / patchRowsToOpenBuddy / PluginPatch 类型直接 from
 *     @openbuddy/plugin-host (agent-host.ts 已经 import)
 *   - readFile / stat from node:fs/promises (随模块自带)
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseCordisPatch, patchRowsToOpenBuddy, type PluginPatch } from "@openbuddy/plugin-host";

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { emitPluginEvent, piHome } from "../../agent-host"` (reverse dep)
//   修复后: 通过 installOverridePatches() 一次性注入, 本模块零 agent-host 导入.
import { piHome as _piHome } from "../_host-paths";

let piHome: () => string;
let emitPluginEvent: (type: string, payload: unknown) => void;

/**
 * Bind override-patches dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installOverridePatches(deps: {
  piHome: () => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
}): void {
  piHome = deps.piHome;
  emitPluginEvent = deps.emitPluginEvent;
}

export const OVERRIDE_PATCH_FILE = "openbuddy.overrides.patch.yml" as const;

async function overridePatchPath(): Promise<string | null> {
  const candidate = join(piHome(), OVERRIDE_PATCH_FILE);
  try {
    const stats = await stat(candidate);
    return stats.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Apply a deepseek-harness-style `cordis.patch.yml` from the agent home
 * directory on top of an already-loaded profile. Missing files are a
 * no-op; parse errors are logged as warnings so a malformed user patch
 * can't prevent the agent from starting.
 */
async function readOverridePatches(): Promise<PluginPatch[][] | undefined> {
  const patchPath = await overridePatchPath();
  if (!patchPath) return [];

  let source: string;
  try {
    source = await readFile(patchPath, "utf-8");
  } catch (error) {
    console.warn(`[openbuddy] failed to read override patch ${patchPath}:`, error);
    return undefined;
  }
  if (!source.trim()) return [];

  try {
    const parsed = parseCordisPatch(source);
    const scope = {
      dshHomePath: (sub: string) => join(piHome(), sub),
      // Mirror the deepseek-harness runtime scope: `!!js <expr>` in the
      // override file can reference `process.platform`, `process.env`,
      // etc. so users can platform- / config-gate individual entries
      // without forking the bundle.
      process: {
        platform: process.platform,
        cwd: process.cwd,
        env: process.env,
      },
    };
    return parsed.layers.map((layer) => patchRowsToOpenBuddy(layer.rows, scope) as PluginPatch[]);
  } catch (error) {
    console.warn(`[openbuddy] override patch ${patchPath} was rejected:`, error);
    emitPluginEvent("plugin/failed", { id: "openbuddy-overrides", error: String(error) });
    return undefined;
  }
}

export {
  overridePatchPath,
  readOverridePatches,
};
