/**
 * mermaid-block —— 块级 Mermaid 图表节点。
 *
 * TipTap 官方没有 Mermaid 节点,而 OpenBuddy 的 markdown 渲染层
 * (`MarkdownPreMermaid`)已经支持 ```mermaid 围栏。为了让"渲染态 ↔
 * 编辑态"对齐,这里补一个原子块节点:
 *   - 属性 `code` 承载原始 Mermaid 源码,round-trip 时不丢格式;
 *   - DOM 形状与 `markdown-bridge` 输出的 `div[data-type="mermaid"]`
 *     完全一致,因此 markdown → HTML → 文档 → HTML → markdown 是无损的;
 *   - 渲染由 `MermaidNodeView` 负责(懒加载 mermaid,失败降级为代码块)。
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidNodeView } from "../components/MermaidNodeView";

export interface MermaidBlockOptions {
  /** 透传到外层 div 的属性。 */
  HTMLAttributes: Record<string, unknown>;
  /** 新插入图表时的默认源码。 */
  defaultCode: string;
}

export const DEFAULT_MERMAID_CODE = "graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaidBlock: {
      /** 在当前位置插入一个 Mermaid 图表块。 */
      setMermaidBlock: (code?: string) => ReturnType;
      /** 更新最近一个 Mermaid 图表块的源码。 */
      updateMermaidBlock: (code: string) => ReturnType;
    };
  }
}

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: "mermaidBlock",

  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {}, defaultCode: DEFAULT_MERMAID_CODE };
  },

  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-code") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-code": attributes.code }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mermaid",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },

  addCommands() {
    return {
      setMermaidBlock:
        (code) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { code: code ?? this.options.defaultCode },
          }),
      updateMermaidBlock:
        (code) =>
        ({ tr, state, dispatch }) => {
          const { from } = state.selection;
          const node = state.doc.nodeAt(from);
          if (!node || node.type.name !== this.name) return false;
          if (dispatch) tr.setNodeMarkup(from, this.type, { ...node.attrs, code });
          return true;
        },
    };
  },
});
