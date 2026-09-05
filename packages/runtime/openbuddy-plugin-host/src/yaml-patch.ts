/**
 * Deepseek-harness `cordis.patch.yml` parser — the patch layer format used by
 * `@deepseek-ai/dsh-*` bundles. Each top-level list item is either an
 * `insert:` (entries to add) or an `id:` keyed patch (fields to merge into
 * an existing entry by id). One file produces one patch layer.
 *
 * Recognized subset:
 *   - top-level array; each item has shape `{ insert: [...] }` OR
 *     `{ id, name?, config?, disabled?, inject?, group? }`
 *   - scalar values: strings (single/double quoted), numbers, booleans, null
 *   - flow-style arrays `[a, b]` and inline JSON
 *   - full YAML block and flow mappings/sequences, quoted scalars,
 *     comments, anchors, and multi-document streams via the `yaml` package
 *   - the `!!js <expr>` tag → `{ __jsExpr: '<expr>' }` payload (evaluated by
 *     `interpolate()` at apply time, matching deepseek-harness semantics)
 */
import { parseAllDocuments } from "yaml";
import { isJsExpr, type JsExpr } from "./js-expr";

export interface PatchEntry {
  id: string;
  /** Module specifier imported by the loader. Required for `insert:`
   *  rows so the row is assignable to `PluginEntryOptions` directly. */
  name: string;
  config?: unknown;
  inject?: string[] | Record<string, unknown>;
  /**
   * Raw disabled flag. Either a plain boolean, or a `!!js` expression
   * (mirrors deepseek-harness `disabled: !!js <expr>` for platform /
   * feature gates). The downstream `interpolate()` pass evaluates
   * JsExpr payloads against the scope before they reach the loader.
   */
  disabled?: boolean | JsExpr;
  group?: boolean;
  isolate?: Record<string, true | string>;
  children?: PatchEntry[];
}

export interface PatchInsertRow {
  insert: PatchEntry[];
}

export interface PatchUpdateRow {
  id: string;
  name?: string;
  config?: unknown;
  inject?: string[] | Record<string, unknown>;
  disabled?: boolean | JsExpr;
  group?: boolean;
  isolate?: Record<string, true | string>;
  children?: PatchEntry[];
}

export type PatchRow = PatchInsertRow | PatchUpdateRow;

export interface ParsedPatchLayer {
  rows: PatchRow[];
  rawJsExprs: JsExpr[];
}

export interface ParsedCordisPatch {
  layers: ParsedPatchLayer[];
}

export interface CordisCompositionEntry {
  id: string;
  name: string;
  config?: unknown;
  inject?: string[] | Record<string, unknown>;
  disabled?: boolean;
  group?: boolean;
  isolate?: Record<string, true | string>;
  children?: CordisCompositionEntry[];
}

export function parseCordisPatch(source: string): ParsedCordisPatch {
  if (!source.trim()) return { layers: [] };
  const documents = parseAllDocuments(source, {
    customTags: [{
      tag: "tag:yaml.org,2002:js",
      identify: () => false,
      resolve: (value: string) => ({ __jsExpr: value } satisfies JsExpr),
    }],
  });
  const layers: ParsedPatchLayer[] = [];
  for (const document of documents) {
    if (document.errors.length) {
      throw new Error(`yaml-patch: ${document.errors.map((error) => error.message).join("; ")}`);
    }
    const value = document.toJSON() as unknown;
    if (value === null || value === undefined) continue;
    if (!Array.isArray(value)) {
      throw new Error("yaml-patch: each document must contain a top-level sequence");
    }
    const rows: PatchRow[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const object = item as Record<string, unknown>;
      if (Array.isArray(object.insert)) {
        rows.push({ insert: object.insert as PatchEntry[] });
      } else if (typeof object.id === "string") {
        rows.push(object as unknown as PatchUpdateRow);
      }
    }
    layers.push({ rows, rawJsExprs: collectJsExprs(rows) });
  }
  return { layers };
}

/** Parse a DeepSeek Harness agent.cordis.yml top-level entry sequence. */
export function parseCordisComposition(source: string, scope: Record<string, unknown> = {}): CordisCompositionEntry[] {
  if (!source.trim()) throw new Error("yaml-composition: composition is empty");
  const effectiveScope = {
    ...scope,
    process: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      env: { ...process.env },
      cwd: process.cwd,
      exit: process.exit,
      ...(scope.process && typeof scope.process === "object" ? scope.process : {}),
    },
  };
  const documents = parseAllDocuments(source, {
    customTags: [{
      tag: "tag:yaml.org,2002:js",
      identify: () => false,
      resolve: (value: string) => ({ __jsExpr: value } satisfies JsExpr),
    }],
  });
  const entries: CordisCompositionEntry[] = [];
  for (const document of documents) {
    if (document.errors.length) throw new Error(`yaml-composition: ${document.errors.map((error) => error.message).join("; ")}`);
    const value = interpolate(scope, document.toJSON(), effectiveScope);
    if (value === null || value === undefined) continue;
    if (!Array.isArray(value)) throw new Error("yaml-composition: each document must contain a top-level sequence");
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("yaml-composition: every entry must be a mapping");
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || !entry.id.trim() || typeof entry.name !== "string" || !entry.name.trim()) {
        throw new Error("yaml-composition: every entry requires id and name");
      }
      entries.push(entry as unknown as CordisCompositionEntry);
    }
  }
  if (!entries.length) throw new Error("yaml-composition: composition has no entries");
  return entries;
}

function collectJsExprs(rows: readonly PatchRow[]): JsExpr[] {
  const out: JsExpr[] = [];
  const walk = (value: unknown) => {
    if (isJsExpr(value)) { out.push(value); return; }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const v of value) walk(v); return; }
    for (const v of Object.values(value as Record<string, unknown>)) walk(v);
  };
  for (const row of rows) walk(row);
  return out;
}

/**
 * Convert a parsed patch layer into the `PluginPatch[]` shape that
 * `HarnessPluginLoader.composePluginPatches()` consumes. `!!js` expressions
 * inside `config:` are evaluated against `scope`.
 */
export function patchRowsToOpenBuddy(
  rows: readonly PatchRow[],
  scope: Record<string, unknown> = {},
): {
  id?: string;
  name?: string;
  config?: unknown;
  inject?: string[] | Record<string, unknown>;
  disabled?: boolean;
  insert?: PatchEntry[];
  group?: boolean | null;
  isolate?: Record<string, true | string>;
  children?: PatchEntry[];
}[] {
  // Mirror deepseek-harness default scope for !!js expressions.
  const suppliedProcess = scope.process && typeof scope.process === "object"
    ? scope.process as Record<string, unknown>
    : {};
  const effectiveScope = {
    ...scope,
    process: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      env: { ...process.env },
      cwd: process.cwd,
      exit: process.exit,
      ...suppliedProcess,
    },
  };
  return rows.map((row) => {
    if ("insert" in row && Array.isArray(row.insert)) {
      return {
        insert: row.insert.map((entry) => ({
          ...entry,
          config: interpolate(scope, entry.config, effectiveScope),
          // The interpolate() pass resolves any `!!js` JsExpr to the
          // evaluated value (boolean in practice), but the static type
          // still permits `JsExpr` because we widened PatchEntry above
          // — narrow at the call site so the return type matches
          // PluginEntryOptions.
          disabled: entry.disabled !== undefined
            ? (interpolate(scope, entry.disabled, effectiveScope) as boolean | undefined)
            : entry.disabled,
          children: entry.children
            ? interpolate(scope, entry.children, effectiveScope) as PatchEntry[]
            : entry.children,
          isolate: entry.isolate,
        })) as unknown as PatchEntry[],
      };
    }
    // Narrow to PatchUpdateRow via unknown — the union discriminator above
    // already excluded insert rows, so the remaining shape is keyed by id.
    const update = row as unknown as PatchUpdateRow;
    const out: Record<string, unknown> = { id: update.id };
    if (update.name !== undefined) out.name = update.name;
    if (update.config !== undefined) out.config = interpolate(scope, update.config, effectiveScope);
    if (update.inject !== undefined) out.inject = update.inject ?? undefined;
    if (update.disabled !== undefined) {
      // Resolve any `!!js` expression against the scope before the
      // loader sees it — the loader expects a boolean here.
      out.disabled = (interpolate(scope, update.disabled, effectiveScope) as boolean | null | undefined) ?? undefined;
    }
    if (update.group !== undefined) out.group = update.group ?? undefined;
    if (update.isolate !== undefined) out.isolate = update.isolate;
    if (update.children !== undefined) out.children = interpolate(scope, update.children, effectiveScope);
    return out;
  }) as unknown as {
    id?: string;
    name?: string;
    config?: unknown;
    inject?: string[] | Record<string, unknown>;
    disabled?: boolean;
    insert?: PatchEntry[];
    group?: boolean | null;
    children?: PatchEntry[];
  }[];
}

function interpolate(
  scope: Record<string, unknown>,
  value: unknown,
  effective: Record<string, unknown> = scope,
): unknown {
  if (isJsExpr(value)) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    return (new Function("ctx", "expr", "with (ctx) { return eval(expr) }") as (
      ctx: Record<string, unknown>,
      expr: string,
    ) => unknown)(effective, value.__jsExpr);
  }
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => interpolate(scope, entry, effective));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = interpolate(scope, entry, effective);
  }
  return out;
}
