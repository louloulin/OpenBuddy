// §5.3 `automation` module (pii W4.1–W4.3): the local scheduler and its run history.
import type { Automation, AutomationSnapshot, AutomationStatus } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

/** Full snapshot: automations (next runs recomputed) + run records. */
export async function automationsSnapshot(): Promise<AutomationSnapshot> {
  return invoke<AutomationSnapshot>("automations_snapshot");
}

/** Create or update an automation (the host validates name / prompt / cwds and recomputes the next run). */
export async function automationsSave(automation: Automation): Promise<Automation> {
  return invoke<Automation>("automations_save", { automation });
}

export async function automationsDelete(id: string): Promise<void> {
  await invoke<void>("automations_delete", { id });
}

export async function automationsSetStatus(id: string, status: AutomationStatus): Promise<void> {
  await invoke<void>("automations_set_status", { id, status });
}

/** Run now, opening a background session (the call resolves when the turn settles). */
export async function automationsRun(id: string): Promise<{ recordId: string; sessionId?: string; ok: boolean }> {
  return invoke<{ recordId: string; sessionId?: string; ok: boolean }>("automations_run", { id });
}

export async function automationRecordsArchive(id: string, archived: boolean): Promise<void> {
  await invoke<void>("automation_records_archive", { id, archived });
}

export async function automationRecordsDelete(id: string): Promise<void> {
  await invoke<void>("automation_records_delete", { id });
}

/** One scheduler pass now (tests / debugging); returns how many tasks fired. */
export async function automationTick(): Promise<{ fired: number }> {
  return invoke<{ fired: number }>("automation_tick");
}
