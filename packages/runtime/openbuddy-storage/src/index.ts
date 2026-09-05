export {
  StorageGateway,
  createStorageEvent,
  type IdempotentResult,
  type StorageCommand,
  type StorageDriver,
  type StorageEventEnvelope,
  type StorageGatewayOptions,
  type StorageReadMode,
  type StorageTransaction,
  type MigrationResult,
} from "./driver/contract";
export { hashRedactedValue, redactStorageValue } from "./driver/redact";
export { SqliteDriver, type JournalMode, type SqliteDriverOptions, type StorageHealthSnapshot } from "./sqlite/driver";
export { closeStorage, openStorage, openStorageSync, type OpenStorageOptions, type OpenStorageResult, type OpenStorageSyncResult } from "./sqlite/open-storage";
export { restoreStorageBackup, type RestoreStorageBackupOptions, type RestoreStorageBackupResult } from "./sqlite/restore";
export { DurableOperationStore, WriterLeaseStore, type DurableOperation, type DurableOperationStatus, type WriterLease } from "./sqlite/coordination";
export { MigrationIssueStore, type MigrationIssue, type MigrationIssueInput } from "./sqlite/migration-issues";
export { HarnessCursorStore } from "./sqlite/harness-state";
export { CollaborationContractStore, CollaborationInboxCursorStore, type CollaborationTaskContract, type CollaborationInboxCursor } from "./sqlite/collaboration-state";
export { EventStore, type EventConsumerCursor, type EventProjector, type EventReplayOptions, type EventReplaySummary, type StoredEventRow } from "./sqlite/events";
export { SyncEventCollection, type SyncEventCollectionOptions } from "./sqlite/sync-event-collection";
export { TeamCatalog, type TeamCatalogMember, type TeamCatalogRecord } from "./sqlite/team-catalog";
export { DEFAULT_MIGRATIONS, MigrationRunner, type MigrationStep } from "./sqlite/migration";
export { SessionCatalog, type SessionCatalogRecord, type SessionCatalogQuery } from "./sqlite/session-catalog";
export { SettingsRegistry, type StoredSetting } from "./sqlite/settings";
export { SettingsDocumentStore, type SettingsDocument } from "./sqlite/settings-document";
export { TaskCatalog, type TaskCatalogEntry, type TaskCatalogOptions } from "./sqlite/task-catalog";
// Stage G-1c: AutomationCatalog removed; automation is owned by
// pi-background-tasks + pi-goal (passthrough).
export { ApprovalCatalog, type ApprovalCatalogOptions, type ApprovalCatalogRecord } from "./sqlite/approval-catalog";
export { McpRegistry, type McpRegistryRecord } from "./sqlite/mcp-registry";
export { MemoryIndex, type MemoryDocument } from "./sqlite/memory";
export { EmailStateStore, type EmailStateDocument, type EmailStateStoreOptions } from "./sqlite/email-state";
export { WorkspaceCatalog, type WorkspaceCatalogDocument, type WorkspaceCatalogOptions, type WorkspaceCatalogRecord } from "./sqlite/workspace-catalog";
export { CalendarCatalog, type CalendarCatalogEvent, type CalendarCatalogOptions, type CalendarCatalogQuery, type CalendarEventStatus } from "./sqlite/calendar-catalog";
// Subagent config moved to pi-subagents (122k weekly downloads, native pi).
export { PiSessionCatalogAdapter, type PiSessionImportResult, type PiSessionCatalogOptions } from "./adapters/pi-session-catalog";
export { LegacyFilesAdapter, type LegacyImportReport, type LegacyTeamMember, type LegacyTeamRecord } from "./adapters/legacy-files";
export { LegacySourcePreflight, preflightLegacySource, preflightLegacySources, type LegacyPreflightRecord, type LegacyPreflightReport, type LegacyPreflightSecretRisk, type LegacyPreflightSource, type LegacySourceKind } from "./adapters/legacy-preflight";
export { ContentAddressedObjectStore, type StoredObject } from "./files/object-store";
export { createPlatformSecretStore, EphemeralSecretStore, PlatformKeychainSecretStore, UnsupportedSecretStore, type KeychainSecretStoreOptions, type PlatformSecretStoreOptions, type SecretRef, type SecretStore } from "./secrets/secret-store";
export { CredentialStore, type CredentialDocument, type CredentialRecord, type CredentialStoreOptions } from "./secrets/credential-store";
export { McpAuthStore, type McpAuthCredential, type McpAuthState, type McpAuthStatus, type McpAuthStoreOptions } from "./sqlite/mcp-auth";
export { StorageMetricsRegistry, type StorageMetrics, type StorageMetricsSnapshot } from "./observability/metrics";
export { storageMetricsRegistry } from "./sqlite/driver";
export { CollaborationBootstrapStore, summarizeContract, summarizeCursor, summarizeEvent, type CollaborationBootstrapOptions, type CollaborationBootstrapSnapshot, type CollaborationBootstrapContract, type CollaborationBootstrapCursor, type CollaborationBootstrapEvent } from "./renderer/collaboration-bootstrap";
// Stage G-1c: AutomationBootstrapStore / redactAutomation* removed; automation is
// owned by pi-background-tasks + pi-goal (passthrough). Only TaskBootstrapStore
// is retained here.
export { TaskBootstrapStore, redactTaskSnapshot, type TaskBootstrapSnapshot } from "./renderer/task-automation-bootstrap";
export { WorkspaceBootstrapStore, summarizeWorkspaceCatalog, type WorkspaceBootstrapSnapshot, type WorkspaceBootstrapSummary } from "./renderer/workspace-bootstrap";
export { RendererStorageGateway, RendererStorageVersionConflictError, type RendererStorageValue } from "./renderer/storage-gateway";
export { errorCode, isMissingSource, legacySourceError } from "./adapters/legacy-errors";
