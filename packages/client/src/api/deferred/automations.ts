// Deferred (20261115-md Appendix B, 自动化): automations_* / automation_records_* commands. Not in the protocol COMMANDS list.
import type { Automation, AutomationSnapshot, AutomationStatus } from "@openbuddy/protocol/dto";
import { invoke } from "../../ipc";

// ---------- automations (local scheduler, WorkBuddy 1:1) ----------

/** Full snapshot: automations (next runs recomputed) + run records. */
export async function automationsSnapshot(): Promise<AutomationSnapshot> {
  return invoke<AutomationSnapshot>("automations_snapshot");
}

/** Create or update an automation. */
export async function automationsSave(automation: Automation): Promise<Automation> {
  return invoke<Automation>("automations_save", { automation });
}

/** Delete an automation by id. */
export async function automationsDelete(id: string): Promise<void> {
  await invoke<void>("automations_delete", { id });
}

/** Set an automation's status ("ACTIVE" | "PAUSED"). */
export async function automationsSetStatus(id: string, status: AutomationStatus): Promise<void> {
  await invoke<void>("automations_set_status", { id, status });
}


export async function automationsRun(id: string): Promise<void> {
  await invoke<void>("automations_run", { id });
}

/** Archive / unarchive a run record. */
export async function automationRecordsArchive(id: string, archived: boolean): Promise<void> {
  await invoke<void>("automation_records_archive", { id, archived });
}

/** Delete a run record. */
export async function automationRecordsDelete(id: string): Promise<void> {
  await invoke<void>("automation_records_delete", { id });
}
