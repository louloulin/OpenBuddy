/**
 * DraftEditor —— R70 「📝 新草稿」入口的默认实现。
 *
 * 用法:宿主通过 `useSlotComponents("editor.draft")` 拿到本组件;把
 * `open` / `onClose` / `onApply` 传进来,即可在任意 overlay / modal / 抽屉
 * 容器里复用同一份 Tiptap 草稿编辑 UI。
 *
 * 为什么单独抽一个外壳而不是让宿主直接用 TiptapEditor:
 *   1) 草稿场景有固定动作面(`应用到会话` / `复制 markdown` / `取消`),
 *      每个宿主都重写一遍会重复;且容易让「draft」的语义在产品中发散。
 *   2) 草稿 = "Markdown in / Markdown out",与 ui-markdown 渲染层完全兼容;
 *      `onApply` 返回 markdown 字符串,父级按需写入 composer / 文件 / 远端。
 *   3) 通过 slot 注册让 `editor.draft` 成为可整体替换的扩展点 —— 第三方
 *      插件可以提供 Notion-style / Obsidian-style / WYSIWYG-only 草稿,
 *      内置组件保持向后兼容。
 */
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@openbuddy/ui-primitives";
import { TiptapEditor } from "./TiptapEditor";
import { htmlToMarkdown } from "../lib/markdown-bridge";

export interface DraftEditorProps {
  open: boolean;
  onClose?: () => void;
  /** 把当前草稿(markdown)交给宿主;父级按需写入 composer / 文件 / 远端。 */
  onApply?: (markdown: string) => void;
  /** 把当前草稿复制到剪贴板;若未提供则不渲染该按钮。 */
  onCopy?: (markdown: string) => void;
  /** 初始内容(markdown),便于「从上一条复制而来」场景。 */
  initialMarkdown?: string;
  /** 模态标题,默认 "📝 新草稿"。 */
  title?: string;
}

export function DraftEditor({
  open,
  onClose,
  onApply,
  onCopy,
  initialMarkdown = "",
  title = "📝 新草稿",
}: DraftEditorProps) {
  const [html, setHtml] = useState<string>("");

  // 把 markdown 初始值转成 html(Tiptap 内部存 html)。
  useEffect(() => {
    if (!open) {
      setHtml("");
      return;
    }
    if (!initialMarkdown) {
      setHtml("<p></p>");
      return;
    }
    // 懒加载 markdown 桥(已经过测试,失败也会兜底空段落)。
    let cancelled = false;
    void import("../lib/markdown-bridge").then(({ markdownToHtml }) => {
      if (cancelled) return;
      setHtml(markdownToHtml(initialMarkdown));
    });
    return () => {
      cancelled = true;
    };
  }, [open, initialMarkdown]);

  const handleApply = useCallback(() => {
    if (!onApply) return;
    onApply(htmlToMarkdown(html));
  }, [html, onApply]);

  const handleCopy = useCallback(() => {
    if (!onCopy) return;
    onCopy(htmlToMarkdown(html));
  }, [html, onCopy]);

  const footer = (
    <>
      <button
        type="button"
        data-testid="draft-editor-cancel"
        onClick={onClose}
        style={{ padding: "6px 12px" }}
      >
        取消
      </button>
      {onCopy ? (
        <button
          type="button"
          data-testid="draft-editor-copy"
          onClick={handleCopy}
          style={{ padding: "6px 12px" }}
        >
          复制 markdown
        </button>
      ) : null}
      {onApply ? (
        <button
          type="button"
          data-testid="draft-editor-apply"
          onClick={handleApply}
          style={{ padding: "6px 12px", fontWeight: 600 }}
        >
          应用到会话
        </button>
      ) : null}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer}>
      <div
        data-testid="draft-editor-body"
        style={{ minHeight: 360, maxHeight: "60vh", overflow: "auto" }}
      >
        {open ? (
          <TiptapEditor
            value={html}
            format="html"
            editable
            placeholder="在这里撰写草稿…输入 / 调出命令"
            onChange={(next) => setHtml(next)}
          />
        ) : null}
      </div>
    </Modal>
  );
}
