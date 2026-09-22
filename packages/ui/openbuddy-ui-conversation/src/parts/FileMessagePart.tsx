/**
 * FileMessagePart — 消息中的附件文件预览部件。
 *
 * 与 `MessageItem.tsx:467-475` 改造前分支保持一致:
 *   - 把 base64 / data URL 透传给 `FilePreview`
 *   - 文件名缺失时回退 `attachment`
 *
 * Phase B 中可以扩展为带 inline preview toggle、copy 按钮、长度提示。
 */
import { FilePreview } from "@openbuddy/ui-workbench";
import type { MessagePartRenderProps } from "./registry-defaults";

function toPreviewDataUrl(mediaType: string, data: string): string {
  if (data.startsWith("data:")) return data;
  return `data:${mediaType || "application/octet-stream"};base64,${data}`;
}

export function FileMessagePart(props: MessagePartRenderProps) {
  if (props.part.kind !== "file") return null;
  const p = props.part;
  return (
    <FilePreview
      filename={p.name || "attachment"}
      content={toPreviewDataUrl(p.mediaType, p.data)}
    />
  );
}
