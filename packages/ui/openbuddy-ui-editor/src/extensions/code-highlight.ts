/**
 * code-highlight —— 代码块语法高亮(基于 lowlight + ProseMirror 装饰)。
 *
 * 为什么不用 `@tiptap/extension-code-block-lowlight`:
 *   它从自己的包目录 import `highlight.js/lib/core`,在 pnpm 的严格隔离下
 *   会解析到仓库根部的 highlight.js 10.x(没有 `exports` 子路径映射),
 *   Node ESM 无法解析无扩展名子路径 → 直接报 "Cannot find module"。
 *   改成自己写装饰插件后,依赖只剩 `lowlight`(它内部解析到自己的
 *   highlight.js 11.x),既没有额外的传递依赖,也少一层包耦合。
 *
 * 只做"装饰"不做"节点":代码块节点仍由 StarterKit 提供,因此关掉高亮时
 * 只是少了 class,不会影响 markdown round-trip。
 */
import { Extension, findChildren } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createLowlight, common } from "lowlight";

/** lowlight 3.x 没有导出 `Lowlight` 类型,用它自己的工厂返回值描述。 */
type Lowlight = ReturnType<typeof createLowlight>;

export const CODE_HIGHLIGHT_PLUGIN_KEY = new PluginKey("obCodeHighlight");

/** lowlight hast 的节点子集(只用到这两种)。 */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function toClassNames(properties: HastNode["properties"]): string[] {
  const raw = properties?.className;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [String(raw)];
}

/**
 * 把 hast 树拍成 ProseMirror 装饰。
 * `offset` 是当前文本在文档中的绝对位置,递归时随文本长度推进。
 */
function parseNodes(nodes: HastNode[], offset: number, decorations: Decoration[]): number {
  let position = offset;
  for (const node of nodes) {
    if (node.type === "text") {
      position += (node.value ?? "").length;
      continue;
    }
    if (node.type !== "element") continue;
    const classes = toClassNames(node.properties);
    const children = node.children ?? [];
    const length = children.reduce(
      (sum, child) => sum + (child.type === "text" ? (child.value ?? "").length : 0),
      0,
    );
    if (classes.length > 0 && length > 0) {
      decorations.push(Decoration.inline(position, position + length, { class: classes.join(" ") }));
    }
    position = parseNodes(children, position, decorations);
  }
  return position;
}

/** 为文档里所有 codeBlock 节点生成高亮装饰集。 */
export function buildCodeDecorations(
  doc: ProseMirrorNode,
  lowlight: Lowlight,
  nodeName = "codeBlock",
): DecorationSet {
  const decorations: Decoration[] = [];
  findChildren(doc, (node) => node.type.name === nodeName).forEach((block) => {
    const language = (block.node.attrs.language as string | null) ?? null;
    if (!language || !lowlight.registered(language)) return;
    const from = block.pos + 1;
    try {
      const tree = lowlight.highlight(language, block.node.textContent) as unknown as HastNode;
      parseNodes(tree.children ?? [], from, decorations);
    } catch {
      // 单块高亮失败(畸形代码 / 语言包异常)不影响整篇文档。
    }
  });
  return DecorationSet.create(doc, decorations);
}

export interface CodeHighlightOptions {
  lowlight: Lowlight;
  /** 需要高亮的节点名,默认 codeBlock。 */
  nodeName: string;
}

export const CodeHighlight = Extension.create<CodeHighlightOptions>({
  name: "obCodeHighlight",

  addOptions() {
    return { lowlight: createLowlight(common), nodeName: "codeBlock" };
  },

  addProseMirrorPlugins() {
    const { lowlight, nodeName } = this.options;
    return [
      new Plugin({
        key: CODE_HIGHLIGHT_PLUGIN_KEY,
        state: {
          init: (_config, state) => buildCodeDecorations(state.doc, lowlight, nodeName),
          apply: (transaction, oldValue) =>
            transaction.docChanged
              ? buildCodeDecorations(transaction.doc, lowlight, nodeName)
              : oldValue,
        },
        props: {
          decorations(state) {
            return CODE_HIGHLIGHT_PLUGIN_KEY.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
