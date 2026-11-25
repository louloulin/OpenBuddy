import { useEffect, useState } from "react";
import { readFileBase64, readTextFile } from "@openbuddy/client/api/files";

/**
 * 「我的文件」里的轻量就地预览 (G3-6)。
 *
 * 这里只做最基本的呈现：图片直出、文本/代码原样显示、其他类型说明用什么应用打开。
 * 完整的渲染（Markdown、Office、PDF、图表）在产物工作台里，那边有专门的适配器；
 * 这个面板刻意保持小，不跨 feature 依赖 workbench。
 */
const TEXT_LIMIT = 512 * 1024;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
};
const TEXT_EXT = new Set([
  "md", "markdown", "txt", "log", "json", "jsonl", "csv", "tsv", "yml", "yaml", "toml", "ini", "conf", "env",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb",
  "php", "swift", "sh", "bash", "zsh", "css", "scss", "less", "sql", "xml", "html", "htm", "vue", "svelte", "mmd",
]);

export function FileQuickPreview({ path }: { path: string }) {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const isImage = IMAGE_EXT.has(ext);
  const isText = TEXT_EXT.has(ext);
  const [content, setContent] = useState<{ text?: string; base64?: string; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setContent(null);
    if (!isImage && !isText) return;
    const request = isImage
      ? readFileBase64(path, 12 * 1024 * 1024).then((base64) => ({ base64 }))
      : readTextFile(path, TEXT_LIMIT).then((text) => ({ text }));
    request.then(
      (value) => alive && setContent(value),
      (error) => alive && setContent({ error: String(error).replace(/^Error:\s*/, "") }),
    );
    return () => {
      alive = false;
    };
  }, [path, isImage, isText]);

  if (!isImage && !isText) {
    return <div className="myfiles-preview__empty">这类文件不适合就地预览，用上面的「用系统应用打开」查看。</div>;
  }
  if (!content) return <div className="myfiles-preview__empty">加载中…</div>;
  if (content.error) return <div className="myfiles-preview__empty">无法读取：{content.error}</div>;

  if (isImage && content.base64) {
    return (
      <div className="myfiles-preview__image">
        <img src={`data:${MIME[ext] ?? "application/octet-stream"};base64,${content.base64}`} alt={path.split(/[\\/]/).pop()} />
      </div>
    );
  }
  return <pre className="myfiles-preview__text">{content.text ?? ""}</pre>;
}
