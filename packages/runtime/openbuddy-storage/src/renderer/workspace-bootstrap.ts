import { WorkspaceCatalog, type WorkspaceCatalogDocument, type WorkspaceCatalogOptions } from "../sqlite/workspace-catalog";

export interface WorkspaceBootstrapSummary {
  id: string;
  path: string;
  title: string;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBootstrapSnapshot {
  schema: "openbuddy.storage-workspace-bootstrap.v1";
  order: string[];
  archivedSessionCount: number;
  workspaces: WorkspaceBootstrapSummary[];
  capturedAt: string;
}

function redactedTimestamp(value: string, fallback: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function summarizeWorkspaceCatalog(document: WorkspaceCatalogDocument, now: () => string = () => new Date().toISOString()): WorkspaceBootstrapSnapshot {
  const capturedAt = now();
  const workspaces: WorkspaceBootstrapSummary[] = document.order.flatMap((id) => {
    const record = document.records[id];
    if (!record) return [];
    return [{
      id: record.id,
      path: record.path,
      title: record.title,
      sessionCount: record.sessionIds.length,
      createdAt: redactedTimestamp(record.createdAt, capturedAt),
      updatedAt: redactedTimestamp(record.updatedAt, capturedAt),
    }];
  });
  return {
    schema: "openbuddy.storage-workspace-bootstrap.v1",
    order: document.order.slice(),
    archivedSessionCount: document.archivedSessionIds.length,
    workspaces,
    capturedAt,
  };
}

export class WorkspaceBootstrapStore {
  private catalog?: WorkspaceCatalog;

  constructor(private readonly options: WorkspaceCatalogOptions) {}

  private async catalogInstance(): Promise<WorkspaceCatalog> {
    return (this.catalog ??= new WorkspaceCatalog(this.options));
  }

  async snapshot(): Promise<WorkspaceBootstrapSnapshot> {
    const document = await (await this.catalogInstance()).read();
    return summarizeWorkspaceCatalog(document, this.options.now);
  }

  async close(): Promise<void> {
    const catalog = this.catalog;
    this.catalog = undefined;
    if (!catalog) return;
    await catalog.close();
  }
}
