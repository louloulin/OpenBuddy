/**
 * `@` file mention (20261116-pii W1.3): `files_search(cwd, query)` lists workspace files with the
 * same ignore rules as Pi's `find` tool (.gitignore, never node_modules / .git), fuzzy ranked.
 */

export const FILES_SEARCH_MAX_RESULTS = 200;

export interface FileSearchHit {
  /** Path relative to the workspace, `/`-separated. */
  path: string;
  /** Base name. */
  name: string;
  size: number;
  mtimeMs: number;
}

export interface FileSearchResult {
  cwd: string;
  hits: FileSearchHit[];
  /** The walk stopped early (file or time budget); results come from the part that was read. */
  partial: boolean;
}
