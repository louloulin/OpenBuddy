'use client';

import { useEffect } from 'react';

/**
 * MDCodeEnhancer —— 客户端副作用组件。
 * 找到 markdown 渲染时留下的 .code-block 容器(data-lang + data-copy-target),
 * 给代码块右上角加 Copy 按钮(始终可见, hover 加深)。
 *
 * 走 effect 路径而不是 React render, 是因为 markdown html 是
 * dangerouslySetInnerHTML 注入的, React 不会重新遍历子树。
 */
export default function MDCodeEnhancer() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const containers = document.querySelectorAll<HTMLElement>(
      'article .md-prose .code-block[data-copy-target]'
    );

    const cleanups: Array<() => void> = [];

    containers.forEach((container) => {
      const pre = container.querySelector('pre');
      if (!pre) return;
      if (container.dataset.copyHooked === '1') return;
      container.dataset.copyHooked = '1';

      const code = pre.querySelector('code');
      const text = code?.textContent ?? pre.textContent ?? '';
      if (!text.trim()) return;

      container.classList.add('group/code');

      // Ensure language label exists (docs-server already injects one; this is a fallback).
      let langLabel = container.querySelector<HTMLElement>('.code-block-lang');
      if (!langLabel) {
        const lang = (container.dataset.lang ?? '').trim();
        if (lang) {
          langLabel = document.createElement('span');
          langLabel.className = 'code-block-lang';
          langLabel.textContent = lang;
          const meta = document.createElement('div');
          meta.className = 'code-block-meta';
          meta.appendChild(langLabel);
          container.prepend(meta);
        }
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Copy code to clipboard');
      btn.className =
        'code-copy-btn inline-flex h-7 items-center gap-1.5 rounded-md ' +
        'border border-white/10 bg-white/5 px-2 text-[11px] font-mono ' +
        'uppercase tracking-wider text-white/70 transition-all ' +
        'hover:bg-white/10 hover:text-white group-hover/code:opacity-100 ' +
        'focus:opacity-100';
      btn.style.opacity = '0.55';

      let resetTimer: number | undefined;

      const renderLabel = (copied: boolean) => {
        btn.innerHTML = copied
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied</span>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>';
      };

      renderLabel(false);

      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          renderLabel(true);
          btn.style.opacity = '1';
          if (resetTimer) window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => {
            renderLabel(false);
            btn.style.opacity = '0.55';
          }, 1800);
        } catch {
          // Clipboard might be blocked; do nothing visible.
        }
      });

      container.appendChild(btn);

      cleanups.push(() => {
        btn.remove();
        delete container.dataset.copyHooked;
      });
    });

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
