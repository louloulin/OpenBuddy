import type { SqliteDriver } from "./driver";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";

export class HarnessCursorStore {
  private storage?: Promise<OpenStorageResult>;

  constructor(private readonly databasePath: string) { }

  private async driver(): Promise<SqliteDriver> {
    return (await (this.storage ??= openStorage({ filePath: this.databasePath, appVersion: "openbuddy-harness-state" }))).driver;
  }

  async read(): Promise<Record<string, number>> {
    const driver = await this.driver();
    const rows = driver.database.prepare(
      "SELECT session_id, last_seq FROM harness_session_cursors ORDER BY session_id",
    ).all() as unknown as Array<{ session_id: string; last_seq: number }>;
    return Object.fromEntries(rows.map((row) => [row.session_id, row.last_seq]));
  }

  async replace(cursors: Record<string, number>): Promise<Record<string, number>> {
    const driver = await this.driver();
    await driver.runExclusive((database) => {
      database.prepare("DELETE FROM harness_session_cursors").run();
      const statement = database.prepare(`
        INSERT INTO harness_session_cursors(session_id, last_seq, updated_at)
        VALUES (?, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const [sessionId, lastSeq] of Object.entries(cursors)) statement.run(sessionId, lastSeq, now);
    });
    return this.read();
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }
}
