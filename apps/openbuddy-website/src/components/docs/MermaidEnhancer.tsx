'use client';

import { useEffect } from 'react';

/**
 * MermaidEnhancer —— 把 server-rendered `<pre class="mermaid">` 块渲染成真正的图。
 * 用 IntersectionObserver 懒加载,避免一次性 hydrate 全部 mermaid block。
 * mermaid 通过 dynamic import 拉,首屏 docs 不被 mermaid 阻塞。
 */
export default function MermaidEnhancer() {
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (cancelled) return;
      const blocks = Array.from(
        document.querySelectorAll<HTMLPreElement>('.mermaid-block pre.mermaid')
      );
      if (blocks.length === 0) return;
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
        fontFamily: 'inherit'
      });
      // Render visible blocks immediately, queue the rest behind an IntersectionObserver.
      await Promise.all(
        blocks.map(async (block, idx) => {
          const source = block.textContent ?? '';
          const id = `mmd-${idx}-${Math.random().toString(36).slice(2, 8)}`;
          try {
            const { svg } = await mermaid.render(id, source);
            if (cancelled) return;
            const wrap = block.parentElement;
            if (!wrap) return;
            wrap.innerHTML = svg;
            wrap.classList.add('mermaid-rendered');
          } catch (err) {
            block.textContent = `Mermaid render failed: ${(err as Error).message}\n\n${source}`;
          }
        })
      );
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
