/**
 * 本地文件预览(Context Viewer 可移植部分)—— 对齐 WorkBuddy
 * `context-viewer-components/media-preview`。
 *
 * 轻量、无重型依赖:对 markdown/image/code/text 本地直接渲染;pdf/audio/video/
 * 其它二进制显示占位(文件名 + 类型 + 「暂不支持预览」)。
 *
 * 通过 `filename` + `content`(文本或 data: URL)渲染;`onCopyText` 提供复制回调。
 */
import { useState } from "react";
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
} from "@openbuddy/files-kb";
import { readZipFromBase64, makeDocZipReader } from "@openbuddy/files-kb";

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
}

export function FilePreview({ filename, content, onCopyText, docExtractor }: FilePreviewProps) {
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
    return (
      <DocPreview
        filename={filename}
        kind={kind}
        text={extracted?.text ?? null}
        sheets={kind === "sheet" && extracted ? (extracted as { sheets: Array<{ name: string; rows: string[][] }> }).sheets : undefined}
        onCopyText={onCopyText}
      />
    );
  }

  // PDF:浏览器原生 <iframe> 内嵌预览(零依赖,大多数 WebView2/WKWebView 自带 PDF 渲染)。
  if (kind === "pdf") {
    return (
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
