// The only memory command still deferred (pii §3.3: memory_flush is not planned — memory is
// plain files on disk, nothing to flush). Kept so existing importers keep compiling.
import { invoke } from "../../ipc";

/** Flush in-flight memory writes to disk. Not implemented by any host (pii §3.3). */
export async function memoryFlush(): Promise<void> {
  await invoke<void>("memory_flush");
}
