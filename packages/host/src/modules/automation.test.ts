// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { automationModule } from "./automation";
import type { HostContext } from "../module";
import type { Automation } from "@openbuddy/protocol/dto";

/**
 * 自动化保存的工作空间缺省 (fix: invalid_payload: cwds).
 *
 * 界面上「工作空间（可选）」—— 留空是合法的, 但服务层要求 `cwds` 非空,
 * 于是留空保存会被打回 `invalid_payload: cwds`（界面上只弹一条看不懂的错）。
 * 宿主在边界上补齐: 留空 = 应用默认空间, 任务存得进也跑得动。
 */
function context(inbox: string) {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-automation-"));
  return {
    options: { automationTickMs: 0 },
    settings: { dir },
    emit: () => {},
    engine: { inbox },
  } as unknown as HostContext;
}

function save(ctx: HostContext, automation: Partial<Automation>): Automation {
  const { commands } = automationModule(ctx);
  return commands.automations_save({ automation }) as Automation;
}

describe("automation module · 工作空间缺省", () => {
  it("留空工作空间时落到默认空间", () => {
    const saved = save(context("/default/space"), { name: "每日 5 个英语单词", prompt: "背单词" });
    expect(saved.cwds).toBe("/default/space");
  });

  it("空白工作空间同样落到默认空间", () => {
    const saved = save(context("/default/space"), { name: "每日周报", prompt: "写周报", cwds: "   " });
    expect(saved.cwds).toBe("/default/space");
  });

  it("显式给出的工作空间原样保留", () => {
    const saved = save(context("/default/space"), { name: "巡检", prompt: "检查 CI", cwds: "/ws" });
    expect(saved.cwds).toBe("/ws");
  });

  it("缺省后快照里也带着默认空间（下次运行拿得到交付目标）", () => {
    const ctx = context("/default/space");
    save(ctx, { name: "每日周报", prompt: "写周报" });
    const { commands } = automationModule(ctx);
    const snapshot = commands.automations_snapshot() as { automations: Automation[] };
    expect(snapshot.automations[0]?.cwds).toBe("/default/space");
  });
});
