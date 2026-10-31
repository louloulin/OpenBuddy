// @vitest-environment node
/**
 * 20261031 — 完成事件不能越过排队中的增量。
 *
 * 流式增量经 rAF 合并器(createUpdateCoalescer)批量落库;窗口在后台 / 最小化 /
 * 繁忙时 rAF 被节流,`pi://complete` 会先于剩余增量到达。若 onComplete 不先
 * flush 合并器,半截回答被标记完成,尾巴再开一个新气泡(真机截图:代码块被
 * 拦腰截断、操作栏夹在回答中间)。这里钉住「先 flush 再收尾」的顺序。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "..", "useAgentSession.ts"), "utf8");

function handlerBody(name: string): string {
  const start = src.indexOf(`${name}: (`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, start + 8000);
}

describe("useAgentSession completion ordering", () => {
  it("onComplete flushes the update coalescer before finalising the bubble", () => {
    const body = handlerBody("onComplete");
    const flush = body.indexOf("updateCoalescerRef.current?.flush()");
    expect(flush).toBeGreaterThan(-1);
    expect(flush).toBeLessThan(body.indexOf("finishStreamingMessage"));
    expect(flush).toBeLessThan(body.indexOf("settleUserStop"));
  });

  it("onTurnError flushes the update coalescer before abandoning the turn", () => {
    const body = handlerBody("onTurnError");
    const flush = body.indexOf("updateCoalescerRef.current?.flush()");
    expect(flush).toBeGreaterThan(-1);
    expect(flush).toBeLessThan(body.indexOf("settleUserStop"));
  });
});
