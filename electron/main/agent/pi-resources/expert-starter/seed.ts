/**
 * expert-starter/seed — 幂等物化「内置起步专家」到 `<agentHome>/experts/`。
 *
 * 为什么需要这个文件:
 *   专家页此前**完全**依赖外部 WorkBuddy 数据目录。开源用户第一次打开
 *   「专家·技能·连接器」看到的是一张空状态卡 + Windows 路径提示 —— 一个
 *   开源产品不该有的首启体验。这份 seed 保证 fresh install 就有可用专家,
 *   精选场景也不再空。
 *
 * 设计契约:
 *   - 与 WorkBuddy manifest **同构**:`_meta/_expert_center.json` 的字段就是
 *     `listExpertCatalog()` 期望的形状,不需要第二条解析路径。
 *   - 幂等:用 `_meta/.starter-seed.json` 的 `version` 字段做哨兵,版本匹配
 *     就立刻返回;版本不匹配或文件缺失才写盘。
 *   - 与用户条目共存:manifest 合并时过滤掉 `plugin` 以 `starter-` 开头的条目
 *     后再叠加新版本,所以用户导入的专家不会被覆盖,删除的内置条目也会被恢复。
 *   - 不动 agent .md 已有内容:内置专家的 `agents/<agent>.md` 仅在文件不存在
 *     时创建;若用户编辑过,seed 跳过它(避免静默覆盖)。
 *   - 启动时由 `expertDefaultRoot()` 调一次,失败不影响图片/召唤等子路径。
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { agentRoot, readJson, writeJson, writeTextAtomic } from "../shared";
import {
  STARTER_CATEGORIES,
  STARTER_EXPERTS,
  starterAgentMarkdown,
  starterManifest,
  starterMemberMarkdown,
  starterScenesManifest,
  type StarterExpert,
} from "./catalog";

/** Bump when `STARTER_EXPERTS` / `STARTER_CATEGORIES` / `STARTER_SCENES` change
 *  in a way the seeded manifest must reflect. Existing installs re-seed safely
 *  because the merge only touches `starter-`-prefixed entries. */
export const STARTER_SEED_VERSION = 1;

/** Prefix shared by all built-in plugins. Used to filter merged manifests. */
export const STARTER_PLUGIN_PREFIX = "starter-";

interface SeedMarker {
  version: number;
  seededAt: string;
}

/** Canonical root for the built-in expert catalog. Lives next to
 *  `workbuddy-experts/` in `agentHome()`, so it inherits any user override of
 *  `OPENBUDDY_AGENT_DIR` / `PI_CODING_AGENT_DIR`. */
export function starterExpertsRoot(): string {
  return join(agentRoot(), "experts");
}

function isStarterPlugin(plugin: unknown): boolean {
  return typeof plugin === "string" && plugin.startsWith(STARTER_PLUGIN_PREFIX);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Plugin manifest consumed by `buildManifestExpert` for `agentName` / `avatar`.
 *  Written under BOTH `.openbuddy-plugin/` (canonical) and `.aily-plugin/` so the
 *  existing reader picks it up without code changes. */
function pluginManifest(e: StarterExpert): Record<string, unknown> {
  return {
    name: e.plugin,
    displayName: e.title,
    profession: e.title,
    author: e.author,
    description: e.desc,
    agentName: e.agent,
    version: "1.0.0",
  };
}

/** Merge helper: keep non-starter entries, drop starter entries — we re-add the
 *  fresh ones from the bundled catalog. */
function mergeExperts(existing: unknown, fresh: unknown[]): unknown[] {
  const kept = Array.isArray(existing)
    ? existing.filter((value) => {
        if (!value || typeof value !== "object") return false;
        return !isStarterPlugin((value as Record<string, unknown>).plugin);
      })
    : [];
  return [...kept, ...fresh];
}

function mergeCategories(existing: unknown): unknown[] {
  const kept = Array.isArray(existing)
    ? existing.filter((value) => {
        if (!value || typeof value !== "object") return false;
        const id = (value as Record<string, unknown>).id;
        return typeof id !== "string" || !id.startsWith(STARTER_PLUGIN_PREFIX);
      })
    : [];
  const existingIds = new Set(
    kept.flatMap((value) => {
      const id = value && typeof value === "object" ? (value as Record<string, unknown>).id : undefined;
      return typeof id === "string" ? [id] : [];
    }),
  );
  for (const category of STARTER_CATEGORIES) {
    if (!existingIds.has(category.id)) {
      kept.push({ id: category.id, name: { zh: category.zh, en: category.en } });
    }
  }
  return kept;
}

function mergeScenes(existing: unknown, fresh: unknown[]): unknown[] {
  const kept = Array.isArray(existing)
    ? existing.filter((value) => {
        if (!value || typeof value !== "object") return false;
        const id = (value as Record<string, unknown>).id;
        return typeof id === "string" ? !id.startsWith(STARTER_PLUGIN_PREFIX) : true;
      })
    : [];
  return [...kept, ...fresh];
}

/** Materialize the starter expert catalog into `root` if the marker is missing
 *  or its version differs from `STARTER_SEED_VERSION`. Returns the resolved root. */
export async function ensureStarterExperts(root: string = starterExpertsRoot()): Promise<string> {
  const base = resolve(root);
  const markerPath = join(base, "_meta", ".starter-seed.json");
  const marker = await readJson<SeedMarker>(markerPath, { version: -1, seededAt: "" });
  if (marker.version === STARTER_SEED_VERSION) return base;

  await mkdir(join(base, "_meta"), { recursive: true });

  // 1. Per-plugin materialization (idempotent for agent .md).
  for (const e of STARTER_EXPERTS) {
    const pluginDir = join(base, e.plugin);
    const agentsDir = join(pluginDir, "agents");
    // Lead agent.
    const leadFile = join(agentsDir, `${e.agent}.md`);
    if (!(await fileExists(leadFile))) {
      await mkdir(agentsDir, { recursive: true });
      await writeTextAtomic(leadFile, starterAgentMarkdown(e));
    }
    // Team members — each becomes a real `agents/<id>.md` file with its own
    // frontmatter, so `expertsLinkAgents()` can copy them into `~/.pi/agents/`
    // and the lead can dispatch to them by bare name via pi-subagents.
    if (e.members) {
      for (const member of e.members) {
        const memberFile = join(agentsDir, `${member.id}.md`);
        if (await fileExists(memberFile)) continue;
        await mkdir(dirname(memberFile), { recursive: true });
        await writeTextAtomic(memberFile, starterMemberMarkdown(e, member));
      }
    }
    const manifestPath = join(pluginDir, ".openbuddy-plugin", "plugin.json");
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeJson(manifestPath, pluginManifest(e), 0o600);
    // Mirror under `.aily-plugin/` so the existing `buildManifestExpert` reader
    // (which scans `.aily-plugin` / `.codebuddy-plugin`) picks up `agentName`.
    const ailyPath = join(pluginDir, ".aily-plugin", "plugin.json");
    await mkdir(dirname(ailyPath), { recursive: true });
    await writeJson(ailyPath, pluginManifest(e), 0o600);
  }

  // 2. Manifests: merge with whatever the user already wrote so non-starter
  //    experts (imported via the WorkBuddy flow, copied in manually, …) survive.
  const centerPath = join(base, "_meta", "_expert_center.json");
  const center = await readJson<Record<string, unknown>>(centerPath, {});
  await writeJson(centerPath, {
    ...center,
    categories: mergeCategories(center.categories),
    experts: mergeExperts(center.experts, (starterManifest().experts ?? []) as unknown[]),
  }, 0o600);

  const scenesPath = join(base, "_meta", "featuredScenes.json");
  const scenes = await readJson<Record<string, unknown>>(scenesPath, {});
  await writeJson(scenesPath, {
    ...scenes,
    scenes: mergeScenes(scenes.scenes, (starterScenesManifest().scenes ?? []) as unknown[]),
  }, 0o600);

  await writeJson(markerPath, { version: STARTER_SEED_VERSION, seededAt: new Date().toISOString() }, 0o600);
  return base;
}

/** Best-effort variant used by `expertDefaultRoot`. Never throws. */
export async function tryEnsureStarterExperts(): Promise<void> {
  try {
    await ensureStarterExperts();
  } catch {
    /* the starter root is best-effort — never block the expert page on it */
  }
}
