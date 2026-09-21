/**
 * composer/send — Composer send / enqueue logic.
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The send and enqueue
 * functions used to live inline in `Composer.tsx` (~88 lines together).
 * Extracting them here keeps the orchestrator file under the 800-line cap
 * while leaving every dependency explicit (no module-level state shared
 * with the caller).
 */
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";

import { pushHistory, type InputHistory } from "@/lib/ui/input-history";
import {
  NATIVE_PI_COMMANDS,
  matchPluginSlashCommand,
  runPluginCommand,
  type PluginCommandPayload,
} from "@openbuddy/ui-workbench";

import type { ImageAttachment } from "./types";

/** Content-part union for the content-based IPC (text + image + file). */
export type SendContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string }
  | { type: "file"; mediaType: string; data: string; name?: string };

export interface SendDeps {
  text: string;
  attachments: string[];
  images: ImageAttachment[];
  // `sceneTag` may be `null` (no tag), `undefined` (prop not passed), or the tag.
  sceneTag: { label: string; icon: LucideIcon } | null | undefined;
  // `pluginCommands` is `readonly` because the underlying hook
  // (`useSlotPayloads<PluginCommandPayload>("plugin.command")`) returns a
  // frozen tuple; we don't mutate it, just pass it to the matcher.
  pluginCommands: readonly PluginCommandPayload[];
  streaming: boolean;
  disabled?: boolean;
  apiReady: boolean;
  onSend: (text: string) => void;
  onSendContent?: (content: SendContentPart[]) => void | Promise<void>;
  onEnqueue?: (text: string) => void;
  onClearSceneTag?: () => void;
  onToast?: (msg: string) => void;
  // The setters below accept either a value OR an updater function (React's
  // `Dispatch<SetStateAction<T>>` shape). We mirror the actual ComposerInner
  // state setters exactly so the send/enqueue wrappers can call them
  // directly without an adapter.
  setAttachments: Dispatch<SetStateAction<string[]>>;
  setImages: Dispatch<SetStateAction<ImageAttachment[]>>;
  setCursorPos: Dispatch<SetStateAction<number>>;
  updateText: (next: string | ((prev: string) => string)) => void;
  histRef: MutableRefObject<InputHistory>;
  histCursorRef: MutableRefObject<number>;
  draftRef: MutableRefObject<string>;
}

/**
 * Send the current Composer content to the agent.
 *
 * Behavioural contract:
 *  - Plugin commands (`/foo`) win when no attachments/images are present
 *    and the typed text starts with `/`. Native Pi commands always win.
 *  - Path attachments are appended as a markdown bullet list under
 *    `相关文件:` so the existing `read_file` tool keeps working.
 *  - `sceneTag` is prepended as `【label】` so the agent receives context.
 *  - Inline image attachments route through `onSendContent` (so the model
 *    receives the actual bytes); path-only attachments still go through
 *    `onSend(text)` with the markdown list prefix.
 *  - The sent body is pushed to the input history; the textarea is cleared
 *    (which also clears the draft).
 */
export function send(deps: SendDeps): void {
  const t = deps.text.trim();
  if (deps.streaming || deps.disabled || !deps.apiReady) return;

  // Plugin command priority: it is a renderer-side action; sending
  // "/greet Alice" as a prompt would only get a model-fabricated reply.
  // Native Pi command names always take precedence even when a plugin
  // registers the same name.
  if (deps.attachments.length === 0 && deps.images.length === 0 && t.startsWith("/")) {
    const hit = matchPluginSlashCommand(
      t,
      deps.pluginCommands,
      NATIVE_PI_COMMANDS.map((command) => command.name),
    );
    if (hit) {
      runPluginCommand(hit.command, hit.args, (error) =>
        deps.onToast?.(
          `插件命令 /${hit.command.id} 执行失败:${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      deps.updateText("");
      deps.setCursorPos(0);
      return;
    }
  }

  // Append attachment paths to the prompt text so pi's read_file tool can
  // pick them up. ACP image/audio needs agent-declared capabilities we
  // don't model yet; ResourceLink behavior is unverified — text is safest.
  let body = t;
  if (deps.attachments.length > 0) {
    const fileList = deps.attachments.map((p) => `- ${p}`).join("\n");
    body = body
      ? `${body}\n\n相关文件:\n${fileList}`
      : `请查看以下文件:\n${fileList}`;
  }
  // 把"操作类型"标签作为上下文前缀一并发出(后端正文仍是可运行的 prompt)。
  if (deps.sceneTag) {
    body = body ? `【${deps.sceneTag.label}】${body}` : `【${deps.sceneTag.label}】`;
  }

  // R1 — when there are inline image attachments, prefer the content-based
  // IPC so the model receives the actual image bytes instead of a path
  // string. Path-only attachments still flow through onSend(text) with the
  // existing "相关文件" prefix so the existing tools/read_file path keeps
  // working.
  const inlineAttachments = deps.images;
  if (inlineAttachments.length > 0 && deps.onSendContent) {
    const textPart = body || "请查看以下附件";
    const content: SendContentPart[] = [{ type: "text", text: textPart }];
    for (const att of inlineAttachments) {
      if (att.kind === "file") {
        content.push({
          type: "file",
          mediaType: att.mediaType,
          data: att.data,
          ...(att.name ? { name: att.name } : {}),
        });
      } else {
        content.push({
          type: "image",
          mediaType: att.mediaType,
          data: att.data,
          ...(att.name ? { name: att.name } : {}),
        });
      }
    }
    // Path attachments get appended as text the agent can resolve.
    if (deps.attachments.length > 0) {
      const fileList = deps.attachments.map((p) => `- ${p}`).join("\n");
      content[0] = { type: "text", text: `${textPart}\n\n相关文件:\n${fileList}` };
    }
    void Promise.resolve(deps.onSendContent(content)).catch((e) => {
      console.error("onSendContent failed", e);
      deps.onToast?.(`发送失败:${e instanceof Error ? e.message : String(e)}`);
    });
  } else {
    deps.onSend(body || "你好");
  }

  // 记入输入历史(arrow-key recall)。
  if (body && body.trim()) {
    deps.histRef.current = pushHistory(deps.histRef.current, body);
    deps.histCursorRef.current = deps.histRef.current.items.length;
    deps.draftRef.current = "";
  }
  deps.updateText(""); // 发送后清空输入框,同时把草稿也清掉(否则切回还会带回来)。
  deps.setAttachments([]);
  deps.setImages([]);
  deps.onClearSceneTag?.();
}

/**
 * Enqueue the current text while streaming is in progress
 * (WorkBuddy message-queue parity). Only fires when there's actual text.
 */
export function enqueue(deps: SendDeps): void {
  const t = deps.text.trim();
  if (!t || deps.disabled || !deps.apiReady) return;
  let body = t;
  if (deps.sceneTag) body = body ? `【${deps.sceneTag.label}】${body}` : `【${deps.sceneTag.label}】`;
  deps.onEnqueue?.(body);
  deps.updateText("");
  deps.setAttachments([]);
  deps.onClearSceneTag?.();
}