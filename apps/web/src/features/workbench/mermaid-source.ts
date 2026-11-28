/**
 * 渲染前整理 mermaid 源码，让工作台预览与 PPTX 导出（packages/services/src/office）读出同一组数。
 *
 * 只处理 `sankey-beta`：mermaid 用 parseFloat 读数值，`"1,000"` 会画成 1、`12abc` 会画成 12；
 * PPTX 导出把标准千分位读成 1000，其他写法退回数据表。这里把标准千分位改写成纯数字，
 * 其他读不成数的值直接报错，不画一张数值错了的图。
 */

const PLAIN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/** CSV 字段：解出的值与原文（含引号），用于原样拼回。 */
const csvFields = (line: string): { value: string; raw: string }[] => {
  const fields: { value: string; raw: string }[] = [];
  let value = "";
  let start = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push({ value, raw: line.slice(start, index) });
      value = "";
      start = index + 1;
    } else value += char;
  }
  fields.push({ value, raw: line.slice(start) });
  return fields;
};

export function mermaidSourceForRender(source: string): { source: string } | { error: string } {
  const lines = source.split("\n");
  const head = lines.findIndex((line) => line.trim() && !line.trim().startsWith("%%"));
  if (head < 0 || !lines[head]!.trim().toLowerCase().startsWith("sankey")) return { source };
  const out = [...lines];
  for (let index = head + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim() || line.trim().startsWith("%%")) continue;
    const fields = csvFields(line);
    if (fields.length !== 3) continue; // 列数不对 mermaid 自己会报错。
    const value = fields[2]!.value.trim();
    if (PLAIN.test(value)) {
      if (fields[2]!.raw.trim() !== value) out[index] = `${fields[0]!.raw},${fields[1]!.raw},${value}`;
      continue;
    }
    if (GROUPED.test(value)) {
      out[index] = `${fields[0]!.raw},${fields[1]!.raw},${value.replace(/,/g, "")}`;
      continue;
    }
    return { error: `桑基图第 ${index + 1} 行的数值「${fields[2]!.value}」不是数字（千分位只认 1,000 这种三位一组的写法）` };
  }
  return { source: out.join("\n") };
}
