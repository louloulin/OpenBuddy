/**
 * 嵌入式网页预览 —— 对齐 WorkBuddy `context-viewer-components/browser-preview`。
 *
 * 输入 URL,经安全校验后在 sandbox iframe 中预览。无效/不安全 URL 显示提示。
 * 纯展示组件,核心校验逻辑在 lib/browser-preview(已测)。
 *
 * 增强(对齐 WorkBuddy Toolbar)：后退/前进/刷新 + URL 历史 + 外部浏览器打开。
 * 由于浏览器 iframe 无法直接拦截目标页导航,这里维护一个「已访问 URL 栈」,
 * 回退/前进在栈内移动,刷新用 key 强制 iframe 重载。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  normalizePreviewUrl,
  previewTitle,
  PREVIEW_SANDBOX,
} from "@/lib/platform/browser-preview";
import { invoke } from "@/lib/platform/electron-api";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  OpenExternalIcon,
} from "@openbuddy/ui-primitives/icons";

interface BrowserPreviewProps {
  /** 初始 URL。 */
  url: string;
  /** URL 变更回调(可选)。 */
  onUrlChange?: (url: string) => void;
}

export function BrowserPreview({ url, onUrlChange }: BrowserPreviewProps) {
  // 初始 URL：仅当通过安全校验时才进入历史栈。
  const initialSafe = normalizePreviewUrl(url);
  const [input, setInput] = useState(url);
  // 已访问历史栈 + 当前指针（只存已规整的安全 URL）。
  const [history, setHistory] = useState<string[]>(initialSafe ? [initialSafe] : []);
  const [cursor, setCursor] = useState(initialSafe ? 0 : -1);
  // 刷新 key：递增以强制 iframe 重载。
  const [reloadKey, setReloadKey] = useState(0);

  // 当前实际加载的 URL（history[cursor] 或空）。
  const current = cursor >= 0 ? history[cursor] ?? "" : "";

  // 外部 url prop 变化时同步（如标签切换带来的 URL 变化）。
  useEffect(() => {
    const safe = normalizePreviewUrl(url);
    if (safe && safe !== current) {
      pushHistory(safe);
      setInput(safe);
    } else if (!safe) {
      // 无效/空 URL：仅回填输入框，不污染历史栈。
      setInput(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const normalized = normalizePreviewUrl(input);

  const pushHistory = useCallback(
    (next: string) => {
      setHistory((prev) => {
        // 截断当前指针之后的历史（前进分支被覆盖）。
        const base = prev.slice(0, cursor + 1);
        // 去重连续相同。
        if (base.length > 0 && base[base.length - 1] === next) return base;
        const updated = [...base, next];
        setCursor(updated.length - 1);
        return updated;
      });
    },
    [cursor],
  );

  const navigate = useCallback(
    (target: string) => {
      const safe = normalizePreviewUrl(target);
      if (!safe) return;
      pushHistory(safe);
      setInput(safe);
      onUrlChange?.(safe);
    },
    [onUrlChange, pushHistory],
  );

  const handleGo = useCallback(() => {
    if (normalized) navigate(normalized);
  }, [normalized, navigate]);

  const goBack = useCallback(() => {
    setCursor((c) => {
      if (c <= 0) return c;
      const next = c - 1;
      const u = history[next];
      setInput(u);
      onUrlChange?.(u);
      return next;
    });
  }, [history, onUrlChange]);

  const goForward = useCallback(() => {
    setCursor((c) => {
      if (c >= history.length - 1) return c;
      const next = c + 1;
      const u = history[next];
      setInput(u);
      onUrlChange?.(u);
      return next;
    });
  }, [history, onUrlChange]);

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const openExternal = useCallback(() => {
    if (!current) return;
    invoke("open_url", { url: current }).catch(() => {
      /* 忽略打开失败 */
    });
  }, [current]);

  const canGoBack = cursor > 0;
  const canGoForward = cursor >= 0 && cursor < history.length - 1;

  const frameTitle = useMemo(
    () => (current ? previewTitle(current) : "网页预览"),
    [current],
  );

  return (
    <div className="browser-preview" role="region" aria-label="网页预览">
      <div className="browser-preview__toolbar">
        <button
          type="button"
          className="browser-preview__nav-btn"
          onClick={goBack}
          disabled={!canGoBack}
          title="后退"
          aria-label="后退"
        >
          <ChevronLeftIcon size="sm" />
        </button>
        <button
          type="button"
          className="browser-preview__nav-btn"
          onClick={goForward}
          disabled={!canGoForward}
          title="前进"
          aria-label="前进"
        >
          <ChevronRightIcon size="sm" />
        </button>
        <button
          type="button"
          className="browser-preview__nav-btn"
          onClick={refresh}
          disabled={!current}
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCwIcon size="sm" />
        </button>
        <input
          className="browser-preview__input"
          type="text"
          value={input}
          placeholder="输入网址预览(https://…)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleGo();
          }}
          aria-label="预览网址"
        />
        <button
          type="button"
          className="browser-preview__go"
          onClick={handleGo}
          disabled={!normalized}
        >
          预览
        </button>
        <button
          type="button"
          className="browser-preview__nav-btn"
          onClick={openExternal}
          disabled={!current}
          title="用系统浏览器打开"
          aria-label="用系统浏览器打开"
        >
          <OpenExternalIcon size="sm" />
        </button>
      </div>
      {current ? (
        <iframe
          key={reloadKey}
          className="browser-preview__frame"
          src={current}
          title={frameTitle}
          sandbox={PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="browser-preview__empty">
          {input.trim()
            ? "该网址不可预览(仅允许 http/https 公网地址,拒绝本地/内网)。"
            : "输入一个 https 网址以预览。"}
        </div>
      )}
    </div>
  );
}
