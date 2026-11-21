import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { useMarkdownHost } from "./host";
import { Check, Copy } from "lucide-react";
import type { CodeBlockAction } from "./types";

type Props = {
  code: string;
  language: string;
  actions?: CodeBlockAction[];
  applyButton?: ReactNode;
  requestId?: string;
  onAction?: (
    action: string,
    code: string,
    language: string,
    requestId?: string,
  ) => void;
  copyIconOnly?: boolean;
};

export const CodeBlockActions = memo(function CodeBlockActions({
  code,
  language,
  actions = [],
  applyButton,
  requestId,
  onAction,
  copyIconOnly = true,
}: Props) {
  const [copied, setCopied] = useState(false);
  // Copying goes through the app's host (the main-process clipboard in Electron), 20261115-md R6.
  const host = useMarkdownHost();

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleCopy = useCallback(() => {
    if (!code) return;
    const done = () => {
      setCopied(true);
      onAction?.("copy", code, language, requestId);
    };
    host.copyText(code).then(done).catch(() => {
      /* Clipboard unavailable — the button simply does not flip to "已复制". */
    });
  }, [code, language, onAction, requestId, host]);

  const visibleActions = actions.filter((action) => {
    if (!action.condition) return true;
    return action.condition(code, language);
  });

  return (
    <div className="md-code-actions">
      <button
        type="button"
        className="md-code-action"
        onClick={handleCopy}
        aria-label={copied ? "已复制" : "复制"}
        title={copied ? "已复制" : "复制"}
      >
        {copied ? (
          <Check size={14} className="md-code-action-icon md-code-action-icon--ok" />
        ) : (
          <Copy size={14} className="md-code-action-icon" />
        )}
        {!copyIconOnly && (
          <span className="md-code-action-label">{copied ? "已复制" : "复制"}</span>
        )}
      </button>
      {visibleActions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="md-code-action"
          title={action.description || action.label}
          aria-label={action.label}
          onClick={() => {
            action.onClick(code, language);
            onAction?.(action.id, code, language, requestId);
          }}
        >
          {action.icon}
          <span className="md-code-action-label">{action.label}</span>
        </button>
      ))}
      {applyButton ? (
        <>
          <div className="md-code-divider" />
          {applyButton}
        </>
      ) : null}
    </div>
  );
});
