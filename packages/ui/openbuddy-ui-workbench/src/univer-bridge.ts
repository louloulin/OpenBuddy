/**
 * OOXML → Univer 数据桥 —— office1 阶段 1。
 *
 * ## 为什么需要这一层
 *
 * Univer 的**原生 xlsx/docx/pptx 二进制导入导出是 Pro 商业能力**
 * (`@univerjs-pro/*-exchange-client`),而且要求部署 Univer Server
 * (见 office1.md §10)。OpenBuddy 是 BYOK 桌面应用,没有后端服务,
 * 也不能替用户做商业授权决策。
 *
 * 所以这里不走 Pro exchange:用仓库已有的 `@openbuddy/files-kb`
 * ZIP/XML 提取器把 OOXML 解析成纯数据,再喂给 Univer **开源**的
 * `createWorkbook(Partial<IWorkbookData>)` /
 * `createUniverDoc(Partial<IDocumentData>)`。得到的是可编辑的真实
 * Univer 实例,零 Pro 依赖、零服务端。
 *
 * 代价:只还原值和段落文本,不还原原始样式/公式/图表。这是记录在
 * office1.md §10 的已知取舍。
 *
 * 本模块是纯函数,不 import 任何 Univer 运行时,便于单测。
 */

/** Univer `ICellData` 的最小子集(只用值)。 */
interface BridgeCellData {
  v: string;
}

/** Univer `IObjectMatrixPrimitiveType<ICellData>`:行 → 列 → 单元格。 */
interface BridgeCellMatrix {
  [row: number]: { [col: number]: BridgeCellData };
}

/** `createWorkbook()` 接受的数据形状(只填我们能从 OOXML 还原的字段)。 */
export interface BridgeWorkbookData {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<
    string,
    {
      id: string;
      name: string;
      cellData: BridgeCellMatrix;
      rowCount: number;
      columnCount: number;
    }
  >;
}

/** `createUniverDoc()` 接受的数据形状。 */
export interface BridgeDocumentData {
  id: string;
  title: string;
  body: { dataStream: string; paragraphs: Array<{ startIndex: number }> };
  documentStyle: Record<string, never>;
}

/** files-kb `extractSheetFromZip()` 的输出形状。 */
export interface SheetSource {
  sheets: Array<{ name: string; rows: string[][] }>;
}

/** Univer 网格的最小尺寸,让空表也有可编辑区域。 */
const MIN_ROWS = 20;
const MIN_COLS = 10;

/**
 * 把 files-kb 抽出的二维表转成 Univer workbook 数据。
 *
 * - 空单元格不写进 cellData(Univer 用稀疏矩阵,省内存)
 * - sheet id 稳定派生自序号,便于 sheetOrder 对齐
 * - 行列数至少 MIN_ROWS × MIN_COLS,保证编辑器有留白可输入
 */
export function sheetSourceToWorkbookData(
  filename: string,
  source: SheetSource,
): BridgeWorkbookData {
  const sheets: BridgeWorkbookData["sheets"] = {};
  const sheetOrder: string[] = [];

  source.sheets.forEach((sheet, index) => {
    const id = `sheet-${index + 1}`;
    const cellData: BridgeCellMatrix = {};
    let maxCols = 0;

    sheet.rows.forEach((row, r) => {
      if (row.length > maxCols) maxCols = row.length;
      row.forEach((cell, c) => {
        if (cell === "") return;
        (cellData[r] ??= {})[c] = { v: cell };
      });
    });

    sheets[id] = {
      id,
      name: sheet.name || `Sheet${index + 1}`,
      cellData,
      rowCount: Math.max(sheet.rows.length, MIN_ROWS),
      columnCount: Math.max(maxCols, MIN_COLS),
    };
    sheetOrder.push(id);
  });

  return { id: filename || "workbook", name: filename || "workbook", sheetOrder, sheets };
}

/**
 * 把提取出的 docx 正文转成 Univer document 数据。
 *
 * Univer 的 `dataStream` 用 `\r` 表示段落结束,`\n` 表示节结束,
 * 且每个段落要在 `paragraphs` 里登记它的 `\r` 位置(startIndex)。
 */
export function docTextToDocumentData(
  filename: string,
  text: string,
): BridgeDocumentData {
  const lines = text.split("\n");
  const paragraphs: Array<{ startIndex: number }> = [];
  let dataStream = "";

  for (const line of lines) {
    dataStream += line;
    paragraphs.push({ startIndex: dataStream.length });
    dataStream += "\r";
  }
  // 结尾的节标记:Univer 要求 dataStream 以 `\r\n` 收束。
  dataStream += "\n";

  return {
    id: filename || "document",
    title: filename || "document",
    body: { dataStream, paragraphs },
    documentStyle: {},
  };
}
