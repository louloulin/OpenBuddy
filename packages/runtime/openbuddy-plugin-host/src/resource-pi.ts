/**
 * @openbuddy/plugin-host — pi-native resource loader adapter (G9 PR 1).
 *
 * Re-exports pi's resource loader primitives so consumers (Cordis
 * plugins, CLI tools, marketplace installers) can use them without taking
 * on a hard dependency on `@earendil-works/pi-coding-agent`. The actual
 * plugin-host `include.ts` (Cordis plugin entry loader) is intentionally
 * untouched — see §"Spec audit" below for the spec-vs-reality mismatch.
 *
 * Spec note (Round 12 audit): the G9 spec assumed `include.ts` was a
 * 350-LOC project-context-file loader that should be replaced by
 * `loadProjectContextFiles`. Reality: `include.ts` is a 128-LOC Cordis
 * harness plugin that loads / refreshes plugin entry descriptors from a
 * YAML / JSON / JS file — a totally different concern. The G9 spec also
 * got pi's API wrong — pi's `loadProjectContextFiles(options)` actually
 * takes `{ cwd, agentDir }` and returns `Array<{ path, content }>`,
 * not the spec's assumed `(projectRoot, patterns, options)` triple.
 * This facade exposes pi's real signature verbatim and provides a
 * thin named-arg adapter that bridges the spec's vocabulary.
 */
import {
  DefaultResourceLoader,
  loadProjectContextFiles as piLoadProjectContextFiles,
  type ResourceLoader,
  type PathMetadata,
  type ResolvedPaths,
  type ResolvedResource,
  type ResourceCollision,
  type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";

/** Re-exports — preserve pi symbol shape so callers can import a single surface. */
export {
  DefaultResourceLoader,
  type ResourceLoader,
  type PathMetadata,
  type ResolvedPaths,
  type ResolvedResource,
  type ResourceCollision,
  type ResourceDiagnostic,
};

/**
 * Named-arg adapter matching the G9 spec's intent (`projectRoot`,
 * `agentDir`). Pi's actual signature is single-arg options taking
 * `{ cwd, agentDir }`; this overload adapts the spec-friendly name to
 * pi's canonical name (`projectRoot` → `cwd`) and returns pi's
 * canonical type (`Array<{ path: string; content: string }>`).
 */
export async function loadProjectContextFiles(
  projectRoot: string,
  agentDir: string,
): Promise<Array<{ path: string; content: string }>> {
  return piLoadProjectContextFiles({ cwd: projectRoot, agentDir });
}