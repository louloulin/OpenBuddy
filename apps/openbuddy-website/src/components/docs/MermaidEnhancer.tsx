'use client';

import { useEffect } from 'react';

/**
 * MermaidEnhancer —— 把 server-rendered `<pre class="mermaid">` 块渲染成真正的图。
 *
 * mermaid 是个大块头,`src/lib/docs-server.ts` 会把它标成 `mermaid-block`,
 * 这里只对进入视口(含 rootMargin 预热区)的块做 dynamic import + render,
 * 首屏之外的图不付出代价。
 */
export default function MermaidEnhancer() {
  useEffect(() => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLPreElement>('.mermaid-block pre.mermaid')
    );
    if (blocks.length === 0) return;

    let cancelled = false;
    let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

    function loadMermaid() {
      if (!mermaidPromise) {
        mermaidPromise = import('mermaid').then((mod) => {
          const mermaid = mod.default;
          mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            securityLevel: 'strict',
            fontFamily: 'inherit'
          });
          return mermaid;
        });
      }
      return mermaidPromise;
    }

    let seq = 0;
    async function renderBlock(block: HTMLPreElement) {
      const source = block.textContent ?? '';
      const id = `mmd-${ seq++ }-${ Math.random().toString(36).slice(2, 8) }`;
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        const wrap = block.parentElement;
        if (!wrap) return;
        wrap.innerHTML = svg;
        wrap.classList.add('mermaid-rendered');
      } catch (err) {
        block.textContent = `Mermaid render failed: ${ (err as Error).message }\n\n${ source }`;
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      void Promise.all(blocks.map(renderBlock));
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const block = entry.target as HTMLPreElement;
          // 命中即卸载,一个块只渲染一次。
          observer.unobserve(block);
          void renderBlock(block);
        }
      },
      { rootMargin: '600px 0px', threshold: 0 }
    );

    for (const block of blocks) observer.observe(block);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  return null;
}
