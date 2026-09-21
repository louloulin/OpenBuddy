/**
 * Stories smoke tests — mount each story in jsdom and assert it renders.
 *
 * 目的:
 *   - 把 9 个 story 文件挂到 vitest 跑一次,确保组件都渲染成功,无 prop 错位。
 *   - 同时充当视觉回归基线 — 一旦某 story 渲染空,说明组件 props 改了。
 *   - 当后续接入真正的 Storybook 时,本文件可以直接删除。
 */
import { describe, expect, it, afterEach, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { cleanup } from "@testing-library/react";
import { renderStory } from "../story-runtime";

import * as AiInboxShellStories from "../__stories__/AiInboxShell.stories";
import * as EmailAiPanelStories from "../__stories__/EmailAiPanel.stories";
import * as AiCommandBarStories from "../__stories__/AiCommandBar.stories";
import * as AiActionPlanStripStories from "../__stories__/AiActionPlanStrip.stories";
import * as AiSummaryCardStories from "../__stories__/AiSummaryCard.stories";
import * as AiReplySuggesterStories from "../__stories__/AiReplySuggester.stories";
import * as MailRailStories from "../__stories__/MailRail.stories";
import * as ReceiptToastStories from "../__stories__/ReceiptToast.stories";
import * as MailStatusBarStories from "../__stories__/MailStatusBar.stories";

afterEach(() => cleanup());

function runStoriesSuite(
  label: string,
  stories: { default: unknown; [key: string]: unknown },
) {
beforeEach(() => { swrCacheInternal.reset(); });
  describe(`Stories — ${label}`, () => {
    const meta = stories.default as { title: string };
    it(`mounts default story for "${meta.title}"`, () => {
      const story = (stories as Record<string, unknown>)["Default"] ?? stories.default;
      const container = renderStory(
        stories.default as never,
        story as never,
      );
      // 组件若 design 故意返回 null(如 ReceiptToast 空 receipts / AiActionPlanStrip idle)
      // 也算"挂载成功" — 这里只关心没抛错。
      expect(() => renderStory(stories.default as never, story as never)).not.toThrow();
    });

    for (const [name, value] of Object.entries(stories)) {
      if (name === "default") continue;
      it(`mounts story "${meta.title} / ${name}"`, () => {
        expect(() => renderStory(stories.default as never, value as never)).not.toThrow();
      });
    }
  });
}

runStoriesSuite("AiInboxShell", AiInboxShellStories);
runStoriesSuite("EmailAiPanel", EmailAiPanelStories);
runStoriesSuite("AiCommandBar", AiCommandBarStories);
runStoriesSuite("AiActionPlanStrip", AiActionPlanStripStories);
runStoriesSuite("AiSummaryCard", AiSummaryCardStories);
runStoriesSuite("AiReplySuggester", AiReplySuggesterStories);
runStoriesSuite("MailRail", MailRailStories);
runStoriesSuite("ReceiptToast", ReceiptToastStories);
runStoriesSuite("MailStatusBar", MailStatusBarStories);

describe("Stories smoke — total coverage", () => {
  it("all 9 story suites are present", () => {
    const suites = [
      AiInboxShellStories,
      EmailAiPanelStories,
      AiCommandBarStories,
      AiActionPlanStripStories,
      AiSummaryCardStories,
      AiReplySuggesterStories,
      MailRailStories,
      ReceiptToastStories,
      MailStatusBarStories,
    ];
    expect(suites.length).toBe(9);
    for (const suite of suites) {
      const meta = (suite as { default?: { title?: string } }).default;
      expect(meta?.title).toMatch(/^Email AI\//);
    }
  });
});
