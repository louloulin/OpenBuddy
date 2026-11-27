import { memo, useState } from "react";
import { Blocks } from "lucide-react";
import { appsRecommendDismiss, appsSetEnabled } from "@openbuddy/client/api/files";
import { describeAppInstallError } from "@openbuddy/protocol/apps";
import { useAppsStore } from "@/features/apps";
import type { ToolCallView } from "@/features/chat/state/session-store";

/** `ob_app_recommend` 的 `details`（engine/builtin/app-recommend.ts）。 */
interface Recommendation {
  appId: string;
  name: string;
  tagline?: string;
  packageSource?: string;
  enabled: boolean;
  matched: string[];
  scene?: { name: string; prompt: string };
}

export const APP_RECOMMEND_TOOL = "ob_app_recommend";

/** 一轮里最后一次成功的推荐（只取第一个候选：WorkBuddy 也是单卡）。 */
export function recommendationOf(toolCalls: ToolCallView[]): { toolCallId: string; rec: Recommendation } | null {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const tc = toolCalls[i]!;
    if (tc.kind !== APP_RECOMMEND_TOOL || tc.status !== "completed") continue;
    const list = (tc.details as { recommendations?: Recommendation[] } | undefined)?.recommendations;
    if (Array.isArray(list) && list[0]?.appId) return { toolCallId: tc.toolCallId, rec: list[0] };
  }
  return null;
}

/**
 * 会话内推荐卡 (20261126-upup UP-6.2 / 20261127-upup U5)：单卡 + 切换（停用的先启用）/ 试试场景 / 不用了。
 * 「不用了」写进宿主设置，`ob_app_recommend` 之后不再推荐这个应用；本卡也立即收起。
 */
export const AppRecommendCard = memo(function AppRecommendCard({
  rec,
  onInsertPrompt,
  onToast,
}: {
  rec: Recommendation;
  onInsertPrompt?: (text: string) => void;
  onToast?: (message: string) => void;
}) {
  const currentAppId = useAppsStore((s) => s.currentAppId);
  const setCurrentApp = useAppsStore((s) => s.setCurrentApp);
  const dismissed = useAppsStore((s) => s.dismissedRecommendations.includes(rec.appId));
  const remember = useAppsStore((s) => s.dismissRecommendation);
  const [state, setState] = useState<"idle" | "busy">("idle");
  if (dismissed) return null;
  const current = currentAppId === rec.appId;

  const accept = async () => {
    setState("busy");
    try {
      if (!rec.enabled && rec.packageSource) await appsSetEnabled(rec.packageSource, true);
      setCurrentApp(rec.appId);
      onToast?.(`已切换到 ${rec.name}；新建任务即按该应用工作`);
      setState("idle");
    } catch (error) {
      onToast?.(describeAppInstallError(error));
      setState("idle");
    }
  };
  const dismiss = async () => {
    setState("busy");
    try {
      await appsRecommendDismiss(rec.appId);
      remember(rec.appId);
      setState("idle");
      onToast?.(`不再推荐 ${rec.name}`);
    } catch (error) {
      onToast?.(String(error).replace(/^Error:\s*/, ""));
      setState("idle");
    }
  };

  return (
    <aside className="app-rec" aria-label={`推荐应用 ${rec.name}`}>
      <span className="app-rec__icon" aria-hidden><Blocks size={16} /></span>
      <div className="app-rec__text">
        <strong className="app-rec__name">{rec.name}</strong>
        {rec.tagline && <span className="app-rec__tagline">{rec.tagline}</span>}
        {rec.matched.length > 0 && <span className="app-rec__why">与「{rec.matched.slice(0, 3).join("、")}」相关</span>}
      </div>
      <div className="app-rec__actions">
        <button type="button" className="app-rec__btn app-rec__btn--primary" disabled={state === "busy" || current} onClick={() => void accept()}>
          {current ? "当前应用" : rec.enabled ? `切换到 ${rec.name}` : "启用并切换"}
        </button>
        {rec.scene && onInsertPrompt && (
          <button type="button" className="app-rec__btn" disabled={state === "busy"} onClick={() => onInsertPrompt(rec.scene!.prompt)}>
            试试：{rec.scene.name}
          </button>
        )}
        <button type="button" className="app-rec__btn app-rec__btn--ghost" disabled={state === "busy"} onClick={() => void dismiss()}>
          不用了
        </button>
      </div>
    </aside>
  );
});
