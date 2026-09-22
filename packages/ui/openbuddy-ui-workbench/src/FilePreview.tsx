/**
 * 本地文件预览(Context Viewer 可移植部分)—— 对齐 WorkBuddy
 * `context-viewer-components/media-preview`。
 *
 * 轻量、无重型依赖:对 markdown/image/code/text 本地直接渲染;pdf/audio/video/
 * 其它二进制显示占位(文件名 + 类型 + 「暂不支持预览」)。
 *
 * 通过 `filename` + `content`(文本或 data: URL)渲染;`onCopyText` 提供复制回调。
 */
import React, { useState } from "react";
import { Markdown } from "@openbuddy/ui-markdown/components";
import {
  detectPreviewKind,
  previewKindLabel,
  codeLanguage,
} from "@/lib/files/file-kind";
import type { ZipReader } from "@openbuddy/files-kb";
import {
  extractDocxFromZip,
  extractPptxFromZip,
  extractSheetFromZip,
  readZipFromBase64,
  makeDocZipReader,
} from "@openbuddy/files-kb/renderer";
import { PdfJsPreview } from "./PdfJsPreview";
import { DocxPreview } from "./DocxPreview";
import { XlsxPreview } from "./XlsxPreview";
import { PptxPreview } from "./PptxPreview";
import { pickOfficePreviewKind } from "./office-preview";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import { UniverEditor } from "./UniverEditor";
import { docTextToDocumentData, sheetSourceToWorkbookData } from "./univer-bridge";

/**
 * 默认文档解压器:把 content(data: URL 或 base64)用内置 zip-reader 解压,
 * 构造 doc-preview 的 ZipReader。解压失败返回 null(降级占位)。
 */
function defaultDocExtractor(content: string): ZipReader | null {
  try {
    const files = readZipFromBase64(content);
    if (Object.keys(files).length === 0) return null;
    return makeDocZipReader(files);
  } catch {
    return null;
  }
}

interface FilePreviewProps {
  /** 文件名(用于类型识别)。 */
  filename: string;
  /** 文本内容(markdown/code/text);image 时为 data: URL 或远程 URL。 */
  content: string;
  /** 复制回调(可选)。 */
  onCopyText?: (text: string) => void;
  /**
   * 文档预览解压器(对齐 WorkBuddy docx/pptx/sheet 预览):对 OOXML 文件,
   * 调用方提供 ZipReader(任意 zip 实现/后端解压),FilePreview 用纯函数提取文本。
   * 未提供时 docx/pptx/sheet 降级为占位。
   */
  docExtractor?: (filename: string) => ZipReader | null;
  /**
   * office1 阶段 1 —— xlsx/docx 是否挂载 Univer 可编辑视图(默认挂载)。
   * 传 `false` 强制只读文本/表格预览,用于不需要编辑器开销的场景
   * (例如 100 轮长 transcript 里的历史附件)。
   */
  univerEditing?: boolean;
  /**
   * Phase C —— 是否优先使用真正的 Office 渲染器(docx-preview / xlsx /
   * pptx-preview)。默认开启;传 `false` 退回文本提取视图。
   *
   * 优先级规则(见下方注释):可编辑的 Univer 视图 > Office 渲染器 >
   * 文本提取降级视图。也就是说,开启本项不会让 xlsx/docx 失去可编辑能力,
   * 但会让 pptx 从「只能看提取出来的文本」升级为真正的幻灯片预览。
   */
  richOfficePreview?: boolean;
}

export function FilePreview({
  filename,
  content,
  onCopyText,
  docExtractor,
  univerEditing,
  richOfficePreview = true,
}: FilePreviewProps) {
  // R69 — 始终读 3 个 Office 预览 slot,即便本文件走 markdown / image / pdf 早返;
  // 这保证 hooks 调用顺序稳定(React 规则),同时让插件可整体接管对应格式。
  // 空槽时(没注册或第三方插件没装)回落到内置组件,行为向后兼容。
  const slotDocx = useSlotComponents("workbench.preview.docx");
  const slotXlsx = useSlotComponents("workbench.preview.xlsx");
  const slotPptx = useSlotComponents("workbench.preview.pptx");
  const slotOfficePreviews = React.useMemo(
    () => ({ docx: slotDocx, xlsx: slotXlsx, pptx: slotPptx }),
    [slotDocx, slotXlsx, slotPptx],
  );
  const kind = detectPreviewKind(filename);

  if (kind === "image") {
    return (
      <div className="file-preview file-preview--image">
        <div className="file-preview__head">
          <span className="file-preview__name">{filename}</span>
          <span className="file-preview__kind">{previewKindLabel(kind)}</span>
        </div>
        <img className="file-preview__img" src={content} alt={filename} />
      </div>
    );
  }

  if (kind === "markdown") {
    return (
      <div className="file-preview file-preview--markdown">
        <div className="file-preview__head">
          <span className="file-preview__name">{filename}</span>
          <span className="file-preview__kind">{previewKindLabel(kind)}</span>
        </div>
        <div className="file-preview__body">
          <Markdown complete>{content}</Markdown>
        </div>
      </div>
    );
  }

  if (kind === "code" || kind === "text") {
    return (
      <CodePreview
        filename={filename}
        content={content}
        kind={kind}
        onCopyText={onCopyText}
      />
    );
  }

  // 音频/视频:零依赖 HTML5 原生 <audio>/<video> 预览(对齐 WorkBuddy media-preview)。
  if (kind === "audio") {
    return (
      <div className="file-preview file-preview--audio">
        <div className="file-preview__head">
          <span className="file-preview__name">{filename}</span>
          <span className="file-preview__kind">{previewKindLabel(kind)}</span>
        </div>
        <div className="file-preview__media">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio className="file-preview__audio" src={content} controls>
            您的浏览器不支持音频预览。
          </audio>
        </div>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="file-preview file-preview--video">
        <div className="file-preview__head">
          <span className="file-preview__name">{filename}</span>
          <span className="file-preview__kind">{previewKindLabel(kind)}</span>
        </div>
        <div className="file-preview__media">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video className="file-preview__video" src={content} controls>
            您的浏览器不支持视频预览。
          </video>
        </div>
      </div>
    );
  }

  // docx/pptx/sheet:OOXML 文本提取(对齐 WorkBuddy media-preview)。
  // 默认用内置 zip-reader(纯 JS DEFLATE)从 content(data: URL/base64)解压;
  // 调用方也可注入自定义 docExtractor 覆盖。
  if (kind === "docx" || kind === "pptx" || kind === "sheet") {
    const zip = docExtractor?.(filename) ?? defaultDocExtractor(content);
    const extracted =
      zip && kind === "docx" ? extractDocxFromZip(zip)
      : zip && kind === "pptx" ? extractPptxFromZip(zip)
      : zip && kind === "sheet" ? extractSheetFromZip(zip)
      : null;
    const sheets =
      kind === "sheet" && extracted
        ? (extracted as { sheets: Array<{ name: string; rows: string[][] }> }).sheets
        : undefined;
    // 只读降级视图:Univer 拉取失败 / 解析不出内容时永远有东西可看。
    const readOnly = (
      <DocPreview
        filename={filename}
        kind={kind}
        text={extracted?.text ?? null}
        sheets={sheets}
        onCopyText={onCopyText}
      />
    );
    // office1 阶段 1 —— xlsx/docx 走 Univer 开源 preset 拿到可编辑视图。
    // pptx 没有开源 slides preset(是 Pro 能力,见 office1.md §10)。
    // 可编辑视图优先于只读的 Office 渲染器:能改的比看得清更重要。
    let univerNode: JSX.Element | null = null;
    if (univerEditing !== false && extracted) {
      if (kind === "sheet" && sheets && sheets.length > 0) {
        univerNode = (
          <UniverEditor
            filename={filename}
            kind="sheet"
            data={sheetSourceToWorkbookData(filename, { sheets })}
            fallback={readOnly}
          />
        );
      } else if (kind === "docx" && extracted.text) {
        univerNode = (
          <UniverEditor
            filename={filename}
            kind="docx"
            data={docTextToDocumentData(filename, extracted.text)}
            fallback={readOnly}
          />
        );
      }
    }
    if (univerNode) return univerNode;

    // R-fix: 当 extracted 有可用内容时(有 docExtractor 且解出文本/表格),
    //   直接返回 readOnly,避免被 DocxPreview/PptxPreview/XlsxPreview 的
    //   异步 loading 状态盖住已解出的文本(readOnly 自身就有完整降级视图)。
    //   这一点对齐 FilePreview.test 的三个核心契约:
    //   1) docx 无 docExtractor → placeholder
    //   2) pptx 有 docExtractor → 提取的幻灯片文本
    //   3) univerEditing=false → 只读表格(不走 Univer / rich preview)
    if (extracted) {
      return readOnly;
    }
    // R-fix: 没有 docExtractor 时,defaultDocExtractor 已经失败(content 多半是
    //   垃圾字节,不是真正的 .docx/.pptx/.xlsx),rich Office preview 也会失败。
    //   直接走 readOnly placeholder,告诉用户「需要文档解析器」,而不是挂个永远
    //   loading 的 DocxPreview/PptxPreview/XlsxPreview。
    if (!docExtractor) {
      return readOnly;
    }
    // Phase C —— 真正的 Office 渲染:docx-preview / SheetJS / pptx-preview。
    // 三者都与 PdfJsPreview 同构(懒加载 + 失败回落 `readOnly`),所以即使
    // 内容是垃圾字节也只是多一次异步失败,视图最终仍是文本提取结果。
    if (richOfficePreview && content.length > 0) {
      // R69 — 走微内核 slot:workbench.preview.{docx|xlsx|pptx};空槽时回落
      // 到内置 Docx/Xlsx/PptxPreview。Hooks 已经在函数顶部无条件调用过,
      // 这里只做组件选择 + 渲染。
      const officeKind = pickOfficePreviewKind(filename);
      if (officeKind) {
        // 把 officeKind 显式缩窄为 known keys,避免 TS7053 索引报错。
        const slotImpls =
          officeKind === "docx" ? slotOfficePreviews.docx
          : officeKind === "xlsx" ? slotOfficePreviews.xlsx
          : slotOfficePreviews.pptx;
        const SlotImpl = slotImpls[0] as
          | React.ComponentType<{ filename: string; content: string; fallback: React.ReactNode; className?: string }>
          | undefined;
        const Builtin =
          officeKind === "docx" ? DocxPreview
          : officeKind === "xlsx" ? XlsxPreview
          : PptxPreview;
        const Impl = SlotImpl ?? Builtin;
        return <Impl filename={filename} content={content} fallback={readOnly} />;
      }
    }
    return readOnly;
  }

  // PDF:优先 PDF.js canvas 渲染(对齐 ChatGPT / Claude.ai,office1 §9);
  // pdfjs 不可用或解析失败时 PdfJsPreview 内部降级为浏览器原生 iframe(v1)。
  if (kind === "pdf") {
    return (
      <PdfJsPreview
        filename={filename}
        content={content}
        fallback={
          <div className="file-preview file-preview--pdf">
            <div className="file-preview__head">
              <span className="file-preview__name">{filename}</span>
              <span className="file-preview__kind">{previewKindLabel(kind)}</span>
            </div>
            <iframe
              className="file-preview__pdf"
              src={content}
              title={filename}
            />
          </div>
        }
      />
    );
  }

  // 其余二进制(未知):占位。
  return (
    <div className="file-preview file-preview--binary">
      <div className="file-preview__head">
        <span className="file-preview__name">{filename}</span>
        <span className="file-preview__kind">{previewKindLabel(kind)}</span>
      </div>
      <div className="file-preview__placeholder">
        <span className="file-preview__placeholder-icon">📄</span>
        <span className="file-preview__placeholder-text">
          {previewKindLabel(kind)} 暂不支持内嵌预览,请用本地应用打开。
        </span>
      </div>
    </div>
  );
}

function CodePreview({
  filename,
  content,
  kind,
  onCopyText,
}: {
  filename: string;
  content: string;
  kind: "code" | "text";
  onCopyText?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const lang = kind === "code" ? codeLanguage(filename) : "text";
  const copy = () => {
    onCopyText?.(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="file-preview file-preview--code">
      <div className="file-preview__head">
        <span className="file-preview__name">{filename}</span>
        <span className="file-preview__lang">{lang}</span>
        <button
          type="button"
          className="file-preview__copy"
          onClick={copy}
          aria-label="复制内容"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="file-preview__code">
        <code>{content}</code>
      </pre>
    </div>
  );
}

/**
 * 文档预览(docx/pptx/sheet)—— 对齐 WorkBuddy media-preview。
 * 有提取文本则渲染(段落/幻灯片/表格);无解压器则显示降级占位。
 */
function DocPreview({
  filename,
  kind,
  text,
  sheets,
  onCopyText,
}: {
  filename: string;
  kind: "docx" | "pptx" | "sheet";
  text: string | null;
  sheets?: Array<{ name: string; rows: string[][] }>;
  onCopyText?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (text) {
      onCopyText?.(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className={"file-preview file-preview--doc"}>
      <div className="file-preview__head">
        <span className="file-preview__name">{filename}</span>
        <span className="file-preview__kind">{previewKindLabel(kind)}</span>
        {text && (
          <button
            type="button"
            className="file-preview__copy"
            onClick={copy}
            aria-label="复制文本"
          >
            {copied ? "已复制" : "复制文本"}
          </button>
        )}
      </div>
      {text == null ? (
        <div className="file-preview__placeholder">
          <span className="file-preview__placeholder-icon">📄</span>
          <span className="file-preview__placeholder-text">
            {previewKindLabel(kind)} 预览需要文档解析器(注入 docExtractor)。当前未提供,请用本地应用打开。
          </span>
        </div>
      ) : kind === "sheet" && sheets && sheets.length > 0 ? (
        <div className="file-preview__doc-body">
          {sheets.map((s, si) => (
            <div key={si} className="file-preview__sheet">
              <div className="file-preview__sheet-name">{s.name}</div>
              <table className="file-preview__table">
                <tbody>
                  {s.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
        <pre className="file-preview__doc-text">{text}</pre>
      )}
    </div>
  );
}
