/** 计划 2.1 — 附件按会话暂存:切走收起、切回恢复、不串到别的会话。 */
import { describe, expect, it } from "vitest";

import { stashAttachments, takeStashedAttachments } from "../use-composer-attachments";

describe("附件按会话暂存", () => {
  it("切走收起、切回恢复,且只恢复一次", () => {
    stashAttachments("a", ["/tmp/a.txt"], []);
    expect(takeStashedAttachments("b")).toBeUndefined();
    expect(takeStashedAttachments("a")).toEqual({ attachments: ["/tmp/a.txt"], images: [] });
    expect(takeStashedAttachments("a")).toBeUndefined();
  });

  it("切走时没有附件:清掉该会话旧的暂存", () => {
    stashAttachments("c", ["/tmp/old.txt"], []);
    stashAttachments("c", [], []);
    expect(takeStashedAttachments("c")).toBeUndefined();
  });
});
