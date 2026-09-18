/**
 * markdown-bridge — 渲染层(react-markdown)与编辑层(TipTap)之间的纯函数桥。
 *
 * 为什么要这一层:
 *   - 会话正文的渲染仍然走 `@openbuddy/ui-markdown`(react-markdown),
 *     它是只读、流式、不会产生 caret 抖动的权威渲染路径。
 *   - 编辑态走 TipTap(ProseMirror 文档模型),TipTap 的原生输入是 HTML。
 *   - 两者必须能无损往返,否则"打开编辑器 → 保存"会静默重写用户的文档。
 *
 * 设计约束:
 *   - 纯函数,零 DOM 依赖(markdown→HTML 方向),可在 node 环境单测。
 *   - 覆盖 TipTap schema 支持的最小子集:标题 / 段落 / 强调 / 删除线 /
 *     行内代码 / 围栏代码块 / 引用 / 三种列表 / 表格 / 分隔线 / 链接 /
 *     图片 / 行内与块级公式 / mermaid 代码块。
 *   - 未知语法降级为普通段落文本,**不**抛出 —— 编辑器永远不该因为
 *     一段陌生 markdown 而打不开。
 *   - 所有文本节点都做 HTML 转义,markdown 内容不会被当作 HTML 注入。
 */

/** 围栏代码块的语言标记:```mermaid 会被识别成图表而非代码。 */
const MERMAID_LANGUAGES = new Set(["mermaid", "mmd", "mermaidjs"]);

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 转义 HTML 特殊字符,保证 markdown 文本不会被浏览器当标签解析。 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** 反向:把 HTML 实体还原为文本(markdown 输出需要可读的字面字符)。 */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 把任意字符串编码进 HTML data-* 属性值。 */
function attr(value: string): string {
  return escapeHtml(value).replace(/\n/g, "&#10;");
}

// ---------------------------------------------------------------------------
// 行内解析
// ---------------------------------------------------------------------------

interface InlineRule {
  name: string;
  pattern: RegExp;
  render: (match: RegExpExecArray) => string;
}

/**
 * 行内规则表 —— 顺序即优先级。
 * `code` 必须排在最前,否则 `` `**a**` `` 会被误判成粗体。
 */
const INLINE_RULES: InlineRule[] = [
  {
    name: "code",
    pattern: /^`([^`\n]+)`/,
    render: (m) => `<code>${escapeHtml(m[1])}</code>`,
  },
  {
    name: "inlineMath",
    pattern: /^\$([^$\n]+)\$/,
    render: (m) => `<span data-type="inline-math" data-latex="${attr(m[1])}"></span>`,
  },
  {
    name: "image",
    pattern: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/,
    render: (m) => {
      const title = m[3] ? ` title="${attr(m[3])}"` : "";
      return `<img src="${attr(m[2])}" alt="${attr(m[1])}"${title}>`;
    },
  },
  {
    name: "link",
    pattern: /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/,
    render: (m) => {
      const title = m[3] ? ` title="${attr(m[3])}"` : "";
      return `<a href="${attr(m[2])}"${title}>${renderInline(m[1])}</a>`;
    },
  },
  {
    name: "autolink",
    pattern: /^<(https?:\/\/[^\s>]+)>/,
    render: (m) => `<a href="${attr(m[1])}">${escapeHtml(m[1])}</a>`,
  },
  {
    name: "strongStar",
    pattern: /^\*\*([^*]+)\*\*/,
    render: (m) => `<strong>${renderInline(m[1])}</strong>`,
  },
  {
    name: "strongUnderscore",
    pattern: /^__([^_]+)__/,
    render: (m) => `<strong>${renderInline(m[1])}</strong>`,
  },
  {
    name: "strike",
    pattern: /^~~([^~]+)~~/,
    render: (m) => `<s>${renderInline(m[1])}</s>`,
  },
  {
    name: "emStar",
    pattern: /^\*([^*\n]+)\*/,
    render: (m) => `<em>${renderInline(m[1])}</em>`,
  },
  {
    name: "emUnderscore",
    pattern: /^_([^_\n]+)_/,
    render: (m) => `<em>${renderInline(m[1])}</em>`,
  },
  {
    name: "hardBreak",
    pattern: /^ {2,}\n/,
    render: () => "<br>",
  },
  {
    name: "break",
    pattern: /^\n/,
    render: () => "\n",
  },
];

/** 行内 markdown → HTML。纯文本会被转义,不会产生标签注入。 */
export function renderInline(text: string): string {
  let rest = text;
  let out = "";
  while (rest.length > 0) {
    let matched = false;
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest);
      if (!match) continue;
      out += rule.render(match);
      rest = rest.slice(match[0].length);
      matched = true;
      break;
    }
    if (matched) continue;
    // 无规则命中:消费一个字符(转义后输出),保证 O(n) 前进。
    const ch = rest[0];
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
    rest = rest.slice(1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 块级解析
// ---------------------------------------------------------------------------

interface BlockParseState {
  lines: string[];
  index: number;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** `#` 标题;返回 null 表示不是标题行。 */
function parseHeading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: match[2].trim() };
}

/** 围栏开始行:`\`\`\`lang` 或 `~~~lang`。 */
function parseFenceStart(line: string): { marker: string; language: string } | null {
  const match = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line);
  if (!match) return null;
  return { marker: match[1][0].repeat(3), language: match[2].toLowerCase() };
}

function isHr(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseTaskMarker(text: string): { checked: boolean; text: string } | null {
  const match = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (!match) return null;
  return { checked: match[1].toLowerCase() === "x", text: match[2] };
}

function parseBullet(line: string): string | null {
  const match = /^\s{0,3}[-*+]\s+(.*)$/.exec(line);
  return match ? match[1] : null;
}

function parseOrdered(line: string): string | null {
  const match = /^\s{0,3}\d+[.)]\s+(.*)$/.exec(line);
  return match ? match[1] : null;
}

/** 一个列表项行的解析结果(带缩进宽度,用于判定嵌套层级)。 */
interface ListItemLine {
  /** 缩进宽度(空格数;tab 按 2 计)。 */
  indent: number;
  /** 有序列表项(`1.` / `1)`)还是无序(`-` / `*` / `+`)。 */
  ordered: boolean;
  /** 序号(仅有序项有意义,无序项为 null)。 */
  order: number | null;
  /** 去掉 marker 之后的正文(可能还带任务标记)。 */
  text: string;
}

function indentWidth(leading: string): number {
  let width = 0;
  for (const ch of leading) width += ch === "\t" ? 2 : 1;
  return width;
}

/**
 * 列表项行 —— 与 `parseBullet` / `parseOrdered` 的区别是**保留缩进**。
 *
 * `parseBullet` 允许 0–3 个前导空格并且把它们丢掉,所以
 * `- 一级` / `  - 二级` / `- 三级` 三行在旧实现里是"同层的三项",嵌套结构
 * 在打开编辑器时就被拍平了(用户的大纲变成平铺列表,保存后不可逆)。
 * 这里把缩进带出来,交给 `parseListBlock` 递归成真正的子列表。
 */
function parseListItemLine(line: string): ListItemLine | null {
  const match = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2];
  const ordered = /^\d/.test(marker);
  return {
    indent: indentWidth(match[1]),
    ordered,
    order: ordered ? Number.parseInt(marker, 10) : null,
    text: match[3],
  };
}

/**
 * 把同一缩进层级的连续列表项解析成 HTML,并递归处理缩进更深的子列表。
 *
 * 与旧实现的三点差异(都是"打开编辑器不再改写用户文档"的一部分):
 *   1. 缩进更深的项成为**子列表**,而不是被拍平成同级项;
 *   2. 有序 / 无序、任务 / 普通混在一起时**分段**输出 —— TipTap 的
 *      `taskList` 只接受 `taskItem` 子节点,把普通 `<li>` 塞进去会被 schema
 *      静默丢弃(内容消失);
 *   3. 有序列表起始序号 ≠ 1 时写上 `start`,不再把 `3.` 开头的列表改回 `1.`。
 */
function parseListBlock(
  lines: string[],
  start: number,
  baseIndent: number,
): { html: string; index: number } {
  const first = parseListItemLine(lines[start]);
  if (!first) return { html: "", index: start };

  const ordered = first.ordered;
  const groups: Array<{ task: boolean; start: number; items: string[] }> = [];
  let index = start;

  while (index < lines.length) {
    const item = parseListItemLine(lines[index]);
    // 更浅 → 本层列表结束(交给外层);更深 → 已由上一项的递归消费;
    // 类型换了(有序 ↔ 无序)→ 新的一个列表块。
    if (!item || item.indent !== baseIndent || item.ordered !== ordered) break;

    const task = parseTaskMarker(item.text);
    const body = task ? task.text : item.text;

    // 正文之后的**更深缩进**行属于这一项(子列表)。
    let childHtml = "";
    index += 1;
    while (index < lines.length) {
      const lookahead = lines[index];
      if (isBlank(lookahead)) break;
      const nested = parseListItemLine(lookahead);
      if (nested && nested.indent > baseIndent) {
        const sub = parseListBlock(lines, index, nested.indent);
        childHtml += sub.html;
        index = sub.index;
        continue;
      }
      break;
    }

    const textHtml = `<p>${renderInline(body)}</p>${childHtml}`;
    const marker = task
      ? `<li data-type="taskItem" data-checked="${task.checked}">`
      : "<li>";
    const groupStart = ordered ? item.order ?? 1 : 1;

    const previous = groups[groups.length - 1];
    if (previous && previous.task === (task !== null)) {
      previous.items.push(`${marker}${textHtml}</li>`);
    } else {
      groups.push({
        task: task !== null,
        start: groupStart,
        items: [`${marker}${textHtml}</li>`],
      });
    }
  }

  const html = groups
    .map((group) => {
      if (group.task) return `<ul data-type="taskList">${group.items.join("")}</ul>`;
      if (ordered) {
        const startAttr = group.start !== 1 ? ` start="${group.start}"` : "";
        return `<ol${startAttr}>${group.items.join("")}</ol>`;
      }
      return `<ul>${group.items.join("")}</ul>`;
    })
    .join("");

  return { html, index };
}

/**
 * markdown → TipTap 可加载的 HTML 片段。
 *
 * 该函数被设计成幂等且无异常:任何解析不了的行都会退化成段落中的一行。
 */
export function markdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const state: BlockParseState = { lines, index: 0 };
  const blocks: string[] = [];

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];

    if (isBlank(line)) {
      state.index += 1;
      continue;
    }

    // 块级公式 $$ ... $$(可单行也可多行)
    const trimmed = line.trim();
    if (trimmed.startsWith("$$")) {
      const rest = trimmed.slice(2);
      if (rest.endsWith("$$") && rest.length > 2) {
        blocks.push(
          `<div data-type="block-math" data-latex="${attr(rest.slice(0, -2).trim())}"></div>`,
        );
        state.index += 1;
        continue;
      }
      const collected: string[] = rest.length > 0 ? [rest] : [];
      state.index += 1;
      while (state.index < state.lines.length) {
        const current = state.lines[state.index];
        if (current.trim().endsWith("$$")) {
          const head = current.trim().slice(0, -2);
          if (head.trim().length > 0) collected.push(head);
          state.index += 1;
          break;
        }
        collected.push(current);
        state.index += 1;
      }
      blocks.push(
        `<div data-type="block-math" data-latex="${attr(collected.join("\n").trim())}"></div>`,
      );
      continue;
    }

    const fence = parseFenceStart(line);
    if (fence) {
      const body: string[] = [];
      state.index += 1;
      while (state.index < state.lines.length) {
        const current = state.lines[state.index];
        if (/^\s*(`{3,}|~{3,})\s*$/.test(current)) {
          state.index += 1;
          break;
        }
        body.push(current);
        state.index += 1;
      }
      const code = body.join("\n");
      if (MERMAID_LANGUAGES.has(fence.language)) {
        blocks.push(`<div data-type="mermaid" data-code="${attr(code)}"></div>`);
      } else {
        const languageClass = fence.language
          ? ` class="language-${attr(fence.language)}"`
          : "";
        blocks.push(`<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      blocks.push(`<h${heading.level}>${renderInline(heading.text)}</h${heading.level}>`);
      state.index += 1;
      continue;
    }

    if (isHr(line)) {
      blocks.push("<hr>");
      state.index += 1;
      continue;
    }

    // 表格:表头行 + 分隔行
    if (
      line.includes("|") &&
      state.index + 1 < state.lines.length &&
      isTableSeparator(state.lines[state.index + 1])
    ) {
      const header = splitTableRow(line);
      state.index += 2;
      const rows: string[][] = [];
      while (state.index < state.lines.length && state.lines[state.index].includes("|")) {
        rows.push(splitTableRow(state.lines[state.index]));
        state.index += 1;
      }
      const headHtml = header
        .map((cell) => `<th><p>${renderInline(cell)}</p></th>`)
        .join("");
      const bodyHtml = rows
        .map(
          (row) =>
            `<tr>${header
              .map((_, i) => `<td><p>${renderInline(row[i] ?? "")}</p></td>`)
              .join("")}</tr>`,
        )
        .join("");
      blocks.push(
        `<table><tbody><tr>${headHtml}</tr>${bodyHtml}</tbody></table>`,
      );
      continue;
    }

    // 引用:连续 `>` 行
    if (/^\s{0,3}>\s?/.test(line)) {
      const quoted: string[] = [];
      while (state.index < state.lines.length && /^\s{0,3}>\s?/.test(state.lines[state.index])) {
        quoted.push(state.lines[state.index].replace(/^\s{0,3}>\s?/, ""));
        state.index += 1;
      }
      blocks.push(`<blockquote><p>${renderInline(quoted.join("\n")).replace(/\n/g, "<br>")}</p></blockquote>`);
      continue;
    }

    // 列表:同一缩进层级的连续项
    const bullet = parseBullet(line);
    const ordered = bullet === null ? parseOrdered(line) : null;
    if (bullet !== null || ordered !== null) {
      const parsed = parseListBlock(state.lines, state.index, parseListItemLine(line)?.indent ?? 0);
      blocks.push(parsed.html);
      state.index = parsed.index;
      continue;
    }

    // 段落:吃到空行 / 下一个块级起始
    const paragraph: string[] = [];
    while (state.index < state.lines.length) {
      const current = state.lines[state.index];
      if (isBlank(current)) break;
      if (
        parseHeading(current) ||
        parseFenceStart(current) ||
        isHr(current) ||
        /^\s{0,3}>\s?/.test(current) ||
        parseBullet(current) !== null ||
        parseOrdered(current) !== null ||
        current.trim().startsWith("$$")
      ) {
        break;
      }
      paragraph.push(current);
      state.index += 1;
    }
    if (paragraph.length === 0) {
      // 防御:块起始判定与段落循环不一致时也必须前进。
      paragraph.push(line);
      state.index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  return blocks.join("");
}

// ---------------------------------------------------------------------------
// HTML → markdown
// ---------------------------------------------------------------------------

interface HtmlToMarkdownOptions {
  /** 注入 DOMParser 以便在非浏览器环境测试;默认使用全局 DOMParser。 */
  parser?: Pick<DOMParser, "parseFromString">;
}

function inlineChildrenToMarkdown(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    out += nodeToMarkdown(child, true);
  });
  return out;
}

/**
 * 列表 → markdown,支持嵌套(子列表每层缩进 2 空格)。
 *
 * 旧实现把 `<li>` 的内容整段当**行内**文本处理,于是
 * `<li><p>一级</p><ul><li><p>二级</p></li></ul></li>` 在保存时被拍平成
 * `- 一级\n- 二级` —— 嵌套层级不可逆地丢了。这里把嵌套的 `<ul>` / `<ol>`
 * 拆出来单独递归,用 depth 决定缩进。
 *
 * `start` 属性会被保留(编辑器里从 3 开始编号的有序列表不会被打回 1)。
 */
/** 最近的祖先 `<li>`(不含自身)—— 用来判定一个列表属于哪一层。 */
function nearestListItem(el: Element): Element | null {
  let node = el.parentElement;
  while (node) {
    if (node.tagName.toLowerCase() === "li") return node;
    node = node.parentElement;
  }
  return null;
}

function listToMarkdown(el: Element, depth: number): string {
  const ordered = el.tagName.toLowerCase() === "ol";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let counter = Number.parseInt(el.getAttribute("start") ?? "1", 10);
  if (!Number.isFinite(counter) || counter < 1) counter = 1;

  el.childNodes.forEach((child) => {
    if (child.nodeType !== 1) return;
    const item = child as Element;
    if (item.tagName.toLowerCase() !== "li") return;

    // 子列表未必是 <li> 的直接子节点:TipTap 的 taskItem 会渲染成
    // `<li><label/><div><p>正文</p><ul>子列表</ul></div></li>`,嵌套列表在
    // `<div>` 里面。所以按"最近的祖先 <li> 是不是当前项"来判定归属层级,
    // 更深层的子列表由递归处理。
    const nested: Element[] = [];
    item.querySelectorAll("ul, ol").forEach((candidate) => {
      if (nearestListItem(candidate) === item) nested.push(candidate);
    });

    const clone = item.cloneNode(true) as Element;
    clone.querySelectorAll("ul, ol").forEach((node) => node.remove());
    let text = inlineChildrenToMarkdown(clone).trim();
    // 多段正文压成单行(否则 bullet 行里出现空行,markdown 会把列表拆开)。
    text = text.replace(/\n{2,}/g, "\n").replace(/\n/g, " ");

    const isTask = item.getAttribute("data-type") === "taskItem";
    const checked = item.getAttribute("data-checked") === "true";
    if (isTask) {
      lines.push(`${indent}- [${checked ? "x" : " "}] ${text}`.trimEnd());
    } else if (ordered) {
      lines.push(`${indent}${counter}. ${text}`.trimEnd());
    } else {
      lines.push(`${indent}- ${text}`.trimEnd());
    }
    counter += 1;
    nested.forEach((node) => lines.push(listToMarkdown(node, depth + 1)));
  });

  return lines.join("\n");
}

function escapeMarkdownText(text: string): string {
  return text.replace(/([\\`*_~[\]])/g, "\\$1");
}

function nodeToMarkdown(node: Node, inline: boolean): string {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const text = node.textContent ?? "";
    return inline ? escapeMarkdownText(text) : text;
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const dataType = el.getAttribute("data-type");

  if (dataType === "inline-math") {
    return `$${el.getAttribute("data-latex") ?? ""}$`;
  }

  switch (tag) {
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${inlineChildrenToMarkdown(el)}**`;
    case "em":
    case "i":
      return `*${inlineChildrenToMarkdown(el)}*`;
    case "s":
    case "del":
    case "strike":
      return `~~${inlineChildrenToMarkdown(el)}~~`;
    case "code": {
      const parentTag = el.parentElement?.tagName.toLowerCase();
      if (parentTag === "pre") return inlineChildrenToMarkdown(el);
      return `\`${el.textContent ?? ""}\``;
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = inlineChildrenToMarkdown(el);
      return `[${text}](${href})`;
    }
    case "img": {
      const alt = el.getAttribute("alt") ?? "";
      const src = el.getAttribute("src") ?? "";
      return `![${alt}](${src})`;
    }
    default:
      break;
  }

  if (dataType === "mermaid") {
    const code = el.getAttribute("data-code") ?? el.textContent ?? "";
    return `\`\`\`mermaid\n${code}\n\`\`\``;
  }
  if (dataType === "block-math") {
    const latex = el.getAttribute("data-latex") ?? el.textContent ?? "";
    return `$$\n${latex}\n$$`;
  }

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `${"#".repeat(Number(tag[1]))} ${inlineChildrenToMarkdown(el)}`;
    case "p":
      return inlineChildrenToMarkdown(el);
    case "hr":
      return "---";
    case "pre": {
      const codeEl = el.querySelector("code");
      const raw = codeEl ?? el;
      const className = codeEl?.getAttribute("class") ?? "";
      const language = /language-([\w+#.-]+)/.exec(className)?.[1] ?? "";
      const code = (raw.textContent ?? "").replace(/\n$/, "");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "blockquote":
      return inlineChildrenToMarkdown(el)
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    case "ul":
    case "ol":
      return listToMarkdown(el, 0);
    case "table": {
      const rows: string[][] = [];
      el.querySelectorAll("tr").forEach((row) => {
        const cells: string[] = [];
        row.querySelectorAll("th,td").forEach((cell) => {
          cells.push(inlineChildrenToMarkdown(cell).trim());
        });
        rows.push(cells);
      });
      if (rows.length === 0) return "";
      const width = rows[0].length;
      const header = `| ${rows[0].join(" | ")} |`;
      const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
      const body = rows.slice(1).map((row) => `| ${row.join(" | ")} |`);
      return [header, separator, ...body].join("\n");
    }
    case "div":
    case "body":
      return blockChildrenToMarkdown(el);
    default:
      return inline ? inlineChildrenToMarkdown(el) : el.textContent ?? "";
  }
}

function blockChildrenToMarkdown(node: Node): string {
  const blocks: string[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const text = (child.textContent ?? "").trim();
      if (text.length > 0) blocks.push(text);
      return;
    }
    if (child.nodeType !== 1) return;
    const md = nodeToMarkdown(child, false);
    if (md.length > 0) blocks.push(md);
  });
  return blocks.join("\n\n");
}

/** TipTap HTML → markdown。用于"编辑器保存"把文档写回 .md。 */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
  const parser =
    options.parser ?? (typeof DOMParser !== "undefined" ? new DOMParser() : null);
  if (!parser) {
    // 无 DOM 环境:退化为去标签的纯文本,至少不丢内容。
    return html.replace(/<[^>]*>/g, "").trim();
  }
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  return blockChildrenToMarkdown(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// 流式拼接
// ---------------------------------------------------------------------------

/**
 * 流式写入器 —— agent 一边生成一边把增量喂给编辑器。
 *
 * 关键行为(对齐 Phase C 测试计划里的"流式 paste 长 markdown 不抖动"):
 *   1. 只在末尾追加,绝不重排已有内容 —— caret 与滚动位置天然稳定;
 *   2. 未闭合的围栏代码块不会被当成"新块",避免每次 chunk 都重建文档;
 *   3. `reset()` 是唯一的清空入口,由宿主在"新一轮生成"开始时显式调用。
 */
export class MarkdownStreamBuffer {
  private buffer = "";

  constructor(initial = "") {
    this.buffer = initial;
  }

  /** 追加增量,返回完整累积文本。 */
  append(chunk: string): string {
    this.buffer += chunk;
    return this.buffer;
  }

  /** 当前累积文本。 */
  value(): string {
    return this.buffer;
  }

  /** 是否处于未闭合的围栏代码块中(用于决定是否继续流式追加)。 */
  hasOpenFence(): boolean {
    const fences = this.buffer.match(/^\s*(`{3,}|~{3,})/gm);
    return Boolean(fences && fences.length % 2 === 1);
  }

  reset(next = ""): void {
    this.buffer = next;
  }
}

/**
 * 判断一次外部 `value` 变更是否可以安全写回编辑器。
 *
 * 编辑器正在聚焦 / 用户正在 composing(中文输入法)时写回会导致 caret
 * 跳动;只有宿主显式要求同步(如"重新打开文档")时才允许。
 */
export function shouldSyncExternalValue(params: {
  focused: boolean;
  composing: boolean;
  /** 宿主最近一次已知的编辑器输出;等于 newValue 说明是回声。 */
  lastEmitted: string;
  newValue: string;
  force?: boolean;
}): boolean {
  if (params.newValue === params.lastEmitted) return false;
  if (params.force) return true;
  return !params.focused && !params.composing;
}
