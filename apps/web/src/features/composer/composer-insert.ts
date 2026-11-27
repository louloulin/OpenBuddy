/**
 * 把一段文本并入输入框（Composer 里的三个入口共用：应用场景、引用文件、技能）。
 * `block` 为 true 时另起一行（场景 prompt），否则按空格接在同一条里。
 */
export const mergeComposerText = (prev: string, text: string, block = true): string =>
  block ? (prev.trim() ? `${prev.trimEnd()}\n${text}` : text) : `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${text}`;
