'use client';

import { useEffect } from 'react';

/**
 * MDCodeEnhancer —— 客户端副作用组件。
 * 找到 markdown 渲染时留下的 [data-copy-target] 容器,
 * 把每个 <pre> 转换为一个带 Copy 按钮的相对定位容器。
 *
 * 走 effect 路径而不是 React render, 是因为 markdown html 是
 * dangerouslySetInnerHTML 注入的, React 不会重新遍历子树。
 */
export default function MDCodeEnhancer() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const containers = document.querySelectorAll<HTMLElement>(
      'article .md-prose [data-copy-target]'
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

      // Make container positioned.
      container.classList.add('group/code');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Copy code to clipboard');
      btn.className =
        'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center ' +
        'rounded-md border border-white/10 bg-white/5 text-white/70 ' +
        'opacity-0 transition-opacity hover:bg-white/10 hover:text-white ' +
        'group-hover/code:opacity-100 focus:opacity-100';

      let resetTimer: number | undefined;

      const renderIcon = (copied: boolean) => {
        btn.innerHTML = copied
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      };

      renderIcon(false);

      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          renderIcon(true);
          if (resetTimer) window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => renderIcon(false), 1800);
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
