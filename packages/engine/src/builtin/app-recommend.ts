import type { ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { appEnabled } from "@openbuddy/services/apps/catalog";
import { recommendApps, type AppRecommendation } from "@openbuddy/services/apps/recommend";
import type { EngineContext } from "../engine-context.js";

/**
 * 会话内应用推荐 built-in (20261126-upup UP-6.1 / 20261127-upup U5)。
 *
 * `ob_app_recommend` 只读：在**已安装**的应用（与 `apps_list` 同一份 `collectApps()`）里，
 * 按用户的说法挑 ≤3 个更合适的应用。结果放在工具 `details.recommendations` 里，聊天界面据此
 * 渲染推荐卡（启用 / 切换 / 不用了）。卡片跟着会话记录走：重新打开、分叉后仍在，不需要
 * 额外的事件通道。被用户「不用了」的应用（设置 `dismissedAppRecommendations`）不再出现。
 */
export const APP_RECOMMEND_TOOL = "ob_app_recommend";

const PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "The user's request or topic, in the user's own words (e.g. 查一下北向资金今天的流向)." },
  },
  required: ["query"],
  additionalProperties: false,
} as unknown as ToolDefinition["parameters"];

export interface AppRecommendDetails {
  query: string;
  recommendations: AppRecommendation[];
}

export function createAppRecommendExtension({ engine, cwd }: { engine: EngineContext; cwd: string }): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: APP_RECOMMEND_TOOL,
      label: "推荐应用",
      description:
        "Look up which installed OpenBuddy app (for example UpUp for stock quotes, financials and investment research) fits the user's request better than the current app. Read-only: it never installs, enables or switches anything; the user decides on the card shown in the chat.",
      promptSnippet: "Suggest an installed app that fits the user's request (shown as a card the user can accept or dismiss)",
      promptGuidelines: [
        "Call ob_app_recommend at most once per task, only when the request clearly belongs to a specialised domain (stocks, funds, financial reports, …) and you lack the tools for it in the current app.",
        "Do not call it for general chat, and never call it again after the user dismissed a suggestion.",
      ],
      parameters: PARAMETERS,
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        const query = typeof (params as { query?: unknown })?.query === "string" ? (params as { query: string }).query.trim() : "";
        const { apps, packages } = engine.appCatalog(cwd);
        const config = engine.settings.config.read();
        const recommendations = recommendApps(apps, query, {
          currentAppId: config.currentAppId,
          dismissed: config.dismissedAppRecommendations,
          enabled: (app) => appEnabled(app, packages),
        });
        const details: AppRecommendDetails = { query, recommendations };
        const text = recommendations.length
          ? `可以推荐给用户的已安装应用：${recommendations.map((item) => `${item.name}${item.tagline ? `（${item.tagline}）` : ""}${item.enabled ? "" : "，当前已停用"}`).join("；")}。界面已经展示推荐卡，由用户决定是否切换；你继续用现有能力回答，不要假装已经切换。`
          : "没有更合适的已安装应用；继续用现有能力完成任务。";
        return { content: [{ type: "text" as const, text }], details };
      },
    });
  };
}

/** Registered in `BUILTIN_EXTENSIONS` (builtin/index.ts). */
export const appRecommendBuiltin = {
  id: "app-recommend",
  label: "应用推荐",
  description: "用户的需求更适合某个已安装应用时，在对话里推荐它（只读；切换与启用由用户在卡片上决定）",
  tools: [APP_RECOMMEND_TOOL] as readonly string[],
  create: (ctx: { engine: EngineContext; sessionId: string; cwd: string }): ExtensionFactory => createAppRecommendExtension(ctx),
};
