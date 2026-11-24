import { create } from "zustand";
import type { HomeModeId } from "@/shared/content/scenes";

/**
 * 状态 chip 的取值 (G1-17): WorkBuddy 的 `input.wbStatusChips.*`。
 *
 * - 设计风格: 回答的语气（WorkBuddy 的 `settings.personalization.style.*`，八项原样搬过来）。
 * - 补图方式: 素材不足时是「色块占位」还是「AI 生图」。
 *
 * OpenBuddy 没有 WorkBuddy 的请求字段（designStyleId / imageMode），所以取值以提示词前缀
 * 的形式写进发送内容，行为对模型可见、对话里也留得下痕迹。
 */
export type DesignStyleId =
  | "default"
  | "professional"
  | "friendly"
  | "straightforward"
  | "creative"
  | "efficient"
  | "sarcastic"
  | "socratic";

export type ImageModeId = "placeholder" | "ai";

export const DESIGN_STYLES: ReadonlyArray<{ id: DesignStyleId; label: string; hint: string }> = [
  { id: "default", label: "默认", hint: "不设定特定风格。" },
  { id: "professional", label: "专业严谨", hint: "清晰、准确、值得信赖。" },
  { id: "friendly", label: "亲和友善", hint: "温暖、平易近人、鼓励支持。" },
  { id: "straightforward", label: "直言不讳", hint: "简明扼要、不废话、直击要点。" },
  { id: "creative", label: "天马行空", hint: "富有想象力、善用比喻类比。" },
  { id: "efficient", label: "高效务实", hint: "最少文字、最大信息量。" },
  { id: "sarcastic", label: "毒舌吐槽", hint: "犀利吐槽、但绝不伤人。" },
  { id: "socratic", label: "启发引导", hint: "用提问引导思考、授人以渔。" },
];

export const IMAGE_MODES: ReadonlyArray<{ id: ImageModeId; label: string; hint: string }> = [
  { id: "placeholder", label: "色块占位", hint: "生成色块占位，方便后续替换。" },
  { id: "ai", label: "AI 生图", hint: "根据使用场景，自动生成图片，效果更佳。" },
];

export const designStyleLabel = (id: DesignStyleId) =>
  DESIGN_STYLES.find((style) => style.id === id)?.label ?? "默认";
export const imageModeLabel = (id: ImageModeId) =>
  IMAGE_MODES.find((mode) => mode.id === id)?.label ?? "默认";

interface StatusState {
  /** 任务开始时的场景；WorkBuddy 的设计 tab 会带着状态 chip 进入对话。 */
  scene: HomeModeId | null;
  designStyle: DesignStyleId;
  /** null = 默认（不补图）。 */
  imageMode: ImageModeId | null;
  setScene: (scene: HomeModeId) => void;
  setDesignStyle: (style: DesignStyleId) => void;
  setImageMode: (mode: ImageModeId | null) => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  scene: null,
  designStyle: "default",
  imageMode: null,
  setScene: (scene) => set({ scene }),
  setDesignStyle: (designStyle) => set({ designStyle }),
  setImageMode: (imageMode) => set({ imageMode }),
}));

/**
 * The prompt prefix the chips contribute (G1-17): the same `【…】` shape the scene tag uses,
 * so the transcript shows what the task was asked for.
 */
export function statusPrefix(designStyle: DesignStyleId, imageMode: ImageModeId | null): string {
  const parts: string[] = [];
  if (designStyle !== "default") parts.push(`风格：${designStyleLabel(designStyle)}`);
  if (imageMode) parts.push(`补图：${imageModeLabel(imageMode)}`);
  return parts.length ? `【${parts.join(" · ")}】` : "";
}
