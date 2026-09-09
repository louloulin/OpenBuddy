/**
 * useFrontmatter — Phase E.3 round 2 (docs/OPENBUDDY_PI_NATIVE_PLAN.md §E.3).
 *
 * React hook that wraps any async frontmatter parser (typically the
 * `parseSkillFrontmatter` helper from `@/lib/agent/pi-client`) so UI
 * components can drop the useState/useEffect/race-condition ceremony.
 *
 * History:
 *   - E.3 round 1 added `parseSkillFrontmatter(raw)` in pi-client and
 *     wired `SkillDetailModal` to call it via inline useEffect.
 *   - E.3 round 2 extracts the state-management into a reusable hook
 *     so other ui-* packages (e.g. ui-conversation tool result
 *     viewers, ui-experts connectors) can render SKILL.md-style
 *     frontmatter without re-implementing the IPC plumbing.
 *
 * Why a custom parseFn parameter (rather than baking in
 * `window.api.pi.text.parseFrontmatter`):
 *   - Keeps `@openbuddy/ui-shared` renderer-agnostic for tests + future
 *     non-Electron runtimes (Storybook, web playground).
 *   - Lets consumers inject a mock parser in unit tests.
 *   - The default `defaultFrontmatterParse` reads `window.api` directly,
 *     so callers that don't care (SkillDetailModal) can omit the arg.
 */
import { useEffect, useRef, useState } from "react";

export interface FrontmatterParseResult {
  /** YAML frontmatter as a key→unknown-value map (kept loose so callers can narrow). */
  frontmatter: Record<string, unknown>;
  /** Body markdown (the part after the closing `---`). */
  body: string;
}

export interface FrontmatterParseFn {
  (raw: string): Promise<FrontmatterParseResult>;
}

export interface UseFrontmatterOptions {
  /** Async parser. Defaults to {@link defaultFrontmatterParse}. */
  parse?: FrontmatterParseFn;
  /**
   * Optional debounce in milliseconds before kicking off the parse.
   * Useful for streamed/typed input where we don't want to parse on
   * every keystroke. `0` (default) means parse on every `raw` change.
   */
  debounceMs?: number;
}

export interface UseFrontmatterResult {
  /** Flat string-keyed frontmatter map (typed values are stringified). */
  meta: Record<string, string>;
  /** Body markdown. */
  body: string;
  /** True while the parse call is in flight (or during debounce window). */
  loading: boolean;
  /** True once at least one parse has resolved for the current `raw`. */
  loaded: boolean;
}

/**
 * Default parser — reaches into the preload `window.api.pi.text.parseFrontmatter`
 * bridge. When the bridge is unavailable (Storybook, web playground, tests
 * without preload stub) it returns an empty frontmatter and the raw as the
 * body, so the modal still renders without crashing.
 *
 * Implementation note: this returns the bridge promise chain verbatim
 * (no `try/catch + await` wrapper) because React 18 + testing-library v16
 * throws "Should not already be working" when an async function body
 * runs an `await` between two microtask checkpoints. `.then().catch()`
 * keeps everything inside a single microtask so the test runner sees one
 * batch of work, not two. See packages/ui/openbuddy-ui-shared/src/__tests__/use-frontmatter.test.tsx
 * for the regression test that pins this contract.
 */
export const defaultFrontmatterParse: FrontmatterParseFn = (raw) => {
  if (typeof window === "undefined") return Promise.resolve({ frontmatter: {}, body: raw });
  const api = (window as unknown as {
    api?: { pi?: { text?: { parseFrontmatter?: FrontmatterParseFn } } };
  }).api;
  const parse = api?.pi?.text?.parseFrontmatter;
  if (typeof parse !== "function") return Promise.resolve({ frontmatter: {}, body: raw });
  // Wrap `parse(raw)` (which already returns a Promise) so we can keep
  // a single microtask checkpoint in the chain. The `.then(onResolve, onReject)`
  // signature avoids the `try { await ... } catch { ... }` pattern which
  // testing-library v16 + vitest currently treats as two separate act()
  // boundaries and throws "Should not already be working" on the second.
  return Promise.resolve(parse(raw)).then(
    (result) => ({
      frontmatter: result?.frontmatter ?? {},
      body: result?.body ?? raw,
    }),
    () => ({ frontmatter: {}, body: raw }),
  );
};

/**
 * Flatten a frontmatter map to `Record<string, string>` by stringifying
 * non-string values. Exported so consumers can apply the same shape
 * without depending on the hook.
 */
export function flattenFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(frontmatter ?? {})) {
    if (typeof v === "string") out[k] = v;
    else if (v === null || v === undefined) continue;
    else out[k] = String(v);
  }
  return out;
}

/**
 * `useFrontmatter(raw, options?)` — React hook that parses a markdown
 * blob with frontmatter and returns a `{ meta, body, loading, loaded }`
 * tuple. Handles:
 *
 *   - useState + useEffect lifecycle (mounts/unmounts cleanly).
 *   - Race conditions when `raw` changes mid-flight (discards stale
 *     resolves via a token counter).
 *   - Optional debounce window for typed/streamed input.
 *   - Empty `raw` shortcut (returns `{ meta: {}, body: "" }` immediately).
 *
 * The hook never throws — failed parses degrade to the empty fallback so
 * the consuming component can still render whatever it has.
 */
export function useFrontmatter(raw: string, options: UseFrontmatterOptions = {}): UseFrontmatterResult {
  const parse = options.parse ?? defaultFrontmatterParse;
  const debounceMs = options.debounceMs ?? 0;

  const [meta, setMeta] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState<boolean>(Boolean(raw));
  const [loaded, setLoaded] = useState<boolean>(false);

  // Token increments on every `raw`/parse identity change; the in-flight
  // resolve bails out when its captured token no longer matches.
  const tokenRef = useRef(0);
  // Track the active debounce timeout so we can clear it on remount/raw change.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Empty input → synchronous reset, no IPC round-trip needed.
    if (!raw) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      tokenRef.current += 1;
      setMeta({});
      setBody("");
      setLoading(false);
      setLoaded(false);
      return;
    }

    const token = ++tokenRef.current;

    const run = () => {
      setLoading(true);
      parse(raw).then((parsed) => {
        if (tokenRef.current !== token) return; // stale resolve — discard
        setMeta(flattenFrontmatter(parsed?.frontmatter));
        setBody(parsed?.body ?? raw);
        setLoading(false);
        setLoaded(true);
      }).catch(() => {
        if (tokenRef.current !== token) return;
        setMeta({});
        setBody(raw);
        setLoading(false);
        setLoaded(true);
      });
    };

    if (debounceMs > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(run, debounceMs);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
      };
    }

    run();
    return () => {
      // No timer to clear; the token bump on next render drops any
      // late-resolving promise.
    };
  }, [raw, parse, debounceMs]);

  return { meta, body, loading, loaded };
}