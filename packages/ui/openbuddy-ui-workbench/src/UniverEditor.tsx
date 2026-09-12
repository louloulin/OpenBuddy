/**
 * Univer 编辑器挂载点 —— office1 阶段 1。
 *
 * 生命周期严格按官方 React 最佳实践:在 effect 里 createUniver,
 * 卸载时 dispose,避免 Univer 实例泄漏(每个实例带渲染引擎和 worker,
 * 泄漏一个就是几十 MB)。
 *
 * 任何一步失败(chunk 拉取失败、preset 版本不匹配、容器尺寸为 0)都
 * 渲染 `fallback` —— 即已有的只读文本/表格预览。用户永远看得到内容,
 * 编辑能力是增益而不是前置条件。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadUniverDoc, loadUniverSheet, type UniverHandle } from "./univer-loader";

export function UniverEditor({
  filename,
  kind,
  data,
  fallback,
}: {
  filename: string;
  /** sheet → spreadsheet preset;docx → document preset。 */
  kind: "sheet" | "docx";
  /** 已由 univer-bridge 转好的 workbook / document 数据。 */
  data: unknown;
  /** Univer 不可用时的降级视图(只读预览)。 */
  fallback: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let handle: UniverHandle | null = null;

    (async () => {
      try {
        const runtime = kind === "sheet" ? await loadUniverSheet() : await loadUniverDoc();
        const container = hostRef.current;
        if (cancelled || !container) return;
        handle = runtime.create(container, data);
        if (cancelled) {
          handle.univer.dispose();
          handle = null;
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        handle?.univer.dispose();
      } catch {
        // dispose 抛错不该影响卸载路径。
      }
    };
  }, [kind, data]);

  if (failed) return <>{fallback}</>;

  return (
    <div className="file-preview file-preview--univer">
      <div className="file-preview__head">
        <span className="file-preview__name">{filename}</span>
        <span className="file-preview__kind">
          {kind === "sheet" ? "表格" : "文档"}
        </span>
        <span className="file-preview__univer-badge">可编辑</span>
      </div>
      <div className="file-preview__univer-host" ref={hostRef}>
        {!ready && <div className="file-preview__univer-loading">编辑器加载中…</div>}
      </div>
    </div>
  );
}
