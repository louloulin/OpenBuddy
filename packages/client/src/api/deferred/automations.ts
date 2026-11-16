// The automations_* commands are implemented (20261116-pii W4.1–W4.3, host module `automation`).
// The typed wrappers moved to `api/automations.ts`; re-exported here so existing importers keep working.
export {
  automationsSnapshot,
  automationsSave,
  automationsDelete,
  automationsSetStatus,
  automationsRun,
  automationRecordsArchive,
  automationRecordsDelete,
  automationTick,
} from "../automations";
