'use client';

import { useState, useCallback } from 'react';

interface CopyState {
  copied: boolean;
  copy: (text: string) => Promise<void>;
}

/**
 * useCopyToClipboard —— 复制文本到剪贴板的小工具 hook
 *
 * 使用 navigator.clipboard.writeText (HTTPS / localhost 限定),
 * 在 Electron renderer 中也可用 (因为内置 Chromium 支持)。
 */
export function useCopyToClipboard(resetMs = 1500): CopyState {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), resetMs);
        } else if (typeof document !== 'undefined') {
          // Fallback: textarea + execCommand
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          setCopied(true);
          setTimeout(() => setCopied(false), resetMs);
        }
      } catch (err) {
        console.warn('Failed to copy text', err);
      }
    },
    [resetMs]
  );

  return { copied, copy };
}