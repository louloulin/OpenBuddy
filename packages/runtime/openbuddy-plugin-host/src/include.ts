import { readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify } from "yaml";
import type { Context } from "@openbuddy/cordis";
import { composePluginPatches, type HarnessPlugin, type PluginEntryOptions, type PluginPatch } from "./index";
import { parseCordisPatch, patchRowsToOpenBuddy, type PatchRow } from "./yaml-patch";

type IncludeConfig = {
  path: string;
  initial?: PluginEntryOptions[];
  patches?: readonly PatchRow[][] | readonly PluginPatch[][];
};

type IncludeLoader = {
  load(entries: readonly PluginEntryOptions[]): Promise<void>;
  remove(id: string): Promise<void>;
  loadImmediate(entries: readonly PluginEntryOptions[]): Promise<void>;
  removeImmediate(id: string): Promise<void>;
};

type IncludeHmr = {
  registerConfig(filename: string, refresh: () => Promise<void> | void): Promise<() => Promise<void>>;
};

export type IncludeRuntime = {
  path: string;
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

function includePath(ctx: Context, source: string): string {
  if (isAbsolute(source)) return source;
  const baseUrl = (ctx as Context & { baseUrl?: string }).baseUrl;
  if (baseUrl?.startsWith("file:")) return fileURLToPath(new URL(source, baseUrl));
  return resolve(source);
}

function serializeInitial(filename: string, value: PluginEntryOptions[]): string {
  if (extname(filename) === ".json") return `${JSON.stringify(value, null, 2)}\n`;
  return stringify(value);
}

async function readEntries(filename: string): Promise<PluginEntryOptions[]> {
  if (extname(filename) === ".mjs" || extname(filename) === ".js" || extname(filename) === ".ts") {
    const module = await import(/* @vite-ignore */ pathToFileURL(filename).href);
    const value = module.default ?? module;
    if (!Array.isArray(value)) throw new Error(`deepseek-compat: include ${filename} must export an array`);
    return value as PluginEntryOptions[];
  }
  const source = await readFile(filename, "utf8");
  if (extname(filename) === ".json") {
    const value = JSON.parse(source) as unknown;
    if (!Array.isArray(value)) throw new Error(`deepseek-compat: include ${filename} must contain an array`);
    return value as PluginEntryOptions[];
  }
  const parsed = parseCordisPatch(source);
  const rows = parsed.layers.flatMap((layer) => layer.rows);
  const hasPatchRow = rows.some((row) => "insert" in row || !(row as { name?: unknown }).name);
  if (!hasPatchRow) return rows as PluginEntryOptions[];
  return composePluginPatches([], parsed.layers.map((layer) => patchRowsToOpenBuddy(layer.rows)) as PluginPatch[][]);
}

export function createIncludePlugin(): HarnessPlugin {
  return {
    name: "@deepseek-ai/cordis-plugin-include",
    apply(ctx, rawConfig) {
      const config = (rawConfig ?? {}) as IncludeConfig;
      if (!config.path || typeof config.path !== "string") throw new Error("deepseek-compat: include.path is required");
      const filename = includePath(ctx, config.path);
      const loader = ctx.get("loader") as IncludeLoader | undefined;
      if (!loader) throw new Error("deepseek-compat: loader service is not available");
      let owned: PluginEntryOptions[] = [];
      let content: string | undefined;
      let refreshQueue: Promise<void> = Promise.resolve();
      let unregisterHmr: (() => Promise<void>) | undefined;
      const runtime: IncludeRuntime = {
        path: filename,
        refresh: () => {
          const run = refreshQueue.then(async () => {
            let nextContent: string | undefined;
            try { nextContent = await readFile(filename, "utf8"); } catch (error) {
              if (config.initial === undefined) throw error;
              nextContent = serializeInitial(filename, config.initial);
              await writeFile(filename, nextContent, "utf8");
            }
            if (nextContent === content) return;
            const next = await readEntries(filename);
            const patches = config.patches?.map((layer) => patchRowsToOpenBuddy(layer as PatchRow[], {
              process: { platform: process.platform, arch: process.arch, env: process.env, cwd: process.cwd },
            }) as PluginPatch[]) ?? [];
            const desired = composePluginPatches(next, patches);
            const previous = owned;
            for (const entry of previous) await loader.remove(entry.id);
            try {
              await loader.load(desired);
              owned = desired;
              content = nextContent;
            } catch (error) {
              for (const entry of desired) {
                try { await loader.remove(entry.id); } catch { /* best effort rollback */ }
              }
              await loader.load(previous);
              throw error;
            }
          });
          refreshQueue = run.catch(() => undefined);
          return run;
        },
        dispose: async () => {
          for (const entry of owned.slice().reverse()) await loader.removeImmediate(entry.id);
          owned = [];
        },
      };
      ctx.provide("include", runtime);
      void runtime.refresh().then(async () => {
        const hmr = ctx.get("hmr") as IncludeHmr | undefined;
        if (hmr) unregisterHmr = await hmr.registerConfig(filename, runtime.refresh);
      }).catch((error) => {
        ctx.emit("include/error", { path: filename, error: String(error) });
      });
      return async () => {
        await unregisterHmr?.();
        await runtime.dispose();
      };
    },
  };
}
