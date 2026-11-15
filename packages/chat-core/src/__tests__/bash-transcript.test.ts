import { describe, expect, it } from "vitest";
import { empty, reduce, transcriptFromMessages } from "../transcript-reducer";

describe("`!command` rows (W1.2)", () => {
  it("streams one row per run: start → output → end", () => {
    let t = empty();
    t = reduce(t, { type: "bash_execution_start", id: "r1", command: "echo hi", excludeFromContext: false });
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ role: "notice", complete: false, meta: { notice: "bash", bash: { id: "r1", command: "echo hi", running: true } } });
    t = reduce(t, { type: "bash_execution_update", id: "r1", delta: "h" });
    t = reduce(t, { type: "bash_execution_update", id: "r1", delta: "i\n" });
    expect(t.messages[0].parts).toEqual([{ kind: "text", text: "hi\n" }]);
    // Other runs and events leave the row alone.
    const same = reduce(t, { type: "bash_execution_update", id: "other", delta: "x" });
    expect(same).toBe(t);
    t = reduce(t, { type: "bash_execution_end", id: "r1", command: "echo hi", exitCode: 0, cancelled: false, truncated: false, output: "hi", excludeFromContext: false });
    expect(t.messages[0]).toMatchObject({ complete: true, parts: [{ kind: "text", text: "hi" }], meta: { bash: { running: false, exitCode: 0 } } });
    expect(t.busy).toBe(false);
  });

  it("marks `!!` runs and stopped runs", () => {
    let t = reduce(empty(), { type: "bash_execution_start", id: "r2", command: "sleep 9", excludeFromContext: true });
    t = reduce(t, { type: "bash_execution_end", id: "r2", command: "sleep 9", cancelled: true, truncated: false, output: "", excludeFromContext: true });
    expect(t.messages[0].meta?.bash).toMatchObject({ excluded: true, cancelled: true, running: false });
    expect(t.messages[0].parts).toEqual([]);
  });

  it("replayed history shows the same row from Pi's bashExecution message", () => {
    const t = transcriptFromMessages([
      { role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 },
      { role: "bashExecution", content: "", command: "ls", output: "a.txt\n", exitCode: 0, excludeFromContext: true, timestamp: 2 } as never,
    ]);
    expect(t.messages[1]).toMatchObject({ role: "notice", parts: [{ kind: "text", text: "a.txt" }], meta: { notice: "bash", bash: { command: "ls", exitCode: 0, excluded: true } } });
  });
});
