/**
 * host-modules/profile/bundles.ts — marketplace plugin bundles + profile runtime.
 *
 * Phase 8.3 Batch I: 从 agent-host.ts:1170-1203 抽出 (~35 行)
 *   - marketplaceBundles (line 1170) — 解析每个 marketplace plugin 的
 *     package.json → PluginBundle
 *   - runtimeProfileBundle (line 1190) — 合并 marketplace bundles 与传
 *     入 profileBundle, filter 出非 core, 转为 PluginProfile
 *   - mergePluginBundles (line 1198) — bundle.entries + patches 扁平合并
 *
 * 设计:
 *   - state / piHome 通过环形 import 自 ../agent-host
 *   - marketplaceArtifactPackagePaths 纯函数从 sibling ./paths 取
 *     (不走 ../agent-host wrapper 避开 circular init 顺序)
 *   - readBundleManifest / manifestToBundle / filterPublishedCoreBundle
 *     直接 from @openbuddy/plugin-host
 */
import { join } from "node:path";

import {
  manifestToBundle,
  readBundleManifest,
  type PluginBundle,
  type PluginProfile,
} from "@openbuddy/plugin-host";

// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { piHome, state } from "../../agent-host"` (reverse dep)
//   修复后: 通过 installProfileBundles() 一次性注入, 本模块零 agent-host 导入.
import { piHome as _piHome } from "../_host-paths";
import { type AgentHostState } from "../_state-shape";

let piHome: () => string;
let state: AgentHostState;

/**
 * Bind profile-bundles dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installProfileBundles(deps: {
  piHome: () => string;
  state: AgentHostState;
}): void {
  piHome = deps.piHome;
  state = deps.state;
}
import { filterPublishedCoreBundle } from "../deepseek/cordis-runtime";
import { marketplaceArtifactPackagePaths as marketplaceArtifactPackagePathsImpl } from "./paths";

async function marketplaceBundles(): Promise<PluginBundle[]> {
  const bundles: PluginBundle[] = [];
  for (const packagePath of await marketplaceArtifactPackagePathsImpl(state.cwd)) {
    const packageJson = join(packagePath, "package.json");
    try {
      const manifest = await readBundleManifest(packageJson, { importer: () => packageJson });
      bundles.push(await manifestToBundle(manifest, {
        scope: {
          dshHomePath: (sub: string) => join(piHome(), sub),
          process: { platform: process.platform, env: process.env },
        },
      }));
    } catch (error) {
      if (String(error).includes("does not declare any of \"openbuddy.bundle\", \"dsh.bundle\"")) continue;
      throw error;
    }
  }
  return bundles;
}

async function runtimeProfileBundle(profileBundle: PluginBundle): Promise<PluginProfile> {
  const bundle = filterPublishedCoreBundle(mergePluginBundles(profileBundle, ...await marketplaceBundles()));
  return {
    entries: [...bundle.entries],
    patches: [...(bundle.patches ?? [])],
  };
}

function mergePluginBundles(...bundles: readonly PluginBundle[]): PluginBundle {
  return {
    entries: bundles.flatMap((bundle) => bundle.entries.map((entry) => ({ ...entry }))),
    patches: bundles.flatMap((bundle) => bundle.patches ?? []),
  };
}

export {
  marketplaceBundles,
  runtimeProfileBundle,
  mergePluginBundles,
};
