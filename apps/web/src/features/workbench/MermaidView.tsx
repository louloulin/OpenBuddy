import { useEffect, useId, useState } from "react";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { mermaidSourceForRender } from "./mermaid-source";

/**
 * Mermaid 产物预览 (G3-1)：把 .mmd/.mermaid 文件渲染成图。
 *
 * 与 Markdown 里的代码块不同，这里是**完整文件**，所以总是按完整源码渲染；
 * mermaid 只在真正需要时懒加载，不进主包。渲染失败就退回源码，并给出可读原因。
 * 桑基图数值先经 mermaidSourceForRender 整理，与 PPTX 导出读出同一组数。
 */
export function MermaidView({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { theme } = useTheme();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSvg("");
    setError(null);
    const run = async () => {
      const prepared = mermaidSourceForRender(source);
      if ("error" in prepared) {
        if (alive) setError(prepared.error);
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(`af-mermaid-${reactId}`, prepared.source);
        if (alive) setSvg(rendered);
      } catch (e) {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [source, theme, reactId]);

  if (error) {
    return (
      <div className="af-mermaid af-mermaid--error">
        <div className="af-mermaid__hint">这张 Mermaid 图无法渲染：{error}</div>
        <pre className="af-mermaid__source">{source}</pre>
      </div>
    );
  }
  if (!svg) return <div className="af-mermaid__hint">正在生成图…</div>;
  return <div className="af-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
