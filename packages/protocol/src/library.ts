/** 资料库 (pii W5.5): a persistent knowledge source (local folder). */
export interface LibrarySource {
  /** Canonical folder path (also the id). */
  id: string;
  kind: "folder";
  /** Display name (folder basename). */
  label: string;
  path: string;
  addedAt: string;
}
