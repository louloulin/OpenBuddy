/**
 * mermaid-loader —— 懒加载 mermaid 并复用单例实例。
 *
 * mermaid 打包体积很大(>1MB),绝不能进主包。编辑器里只有真的渲染图表
 * 节点时才动态 import,且全局只初始化一次。
 */
/**
 * mermaid 的类型从**默认导出**取:`import("mermaid")` 的命名空间本身只有
 * 少量再导出的常量,真正的 API(`initialize` / `render`)挂在 default 上。
 */
type MermaidApi = (typeof import("mermaid"))["default"];

let cached: Promise<MermaidApi> | null = null;

/** 懒加载并初始化 mermaid。多次调用返回同一个 Promise。 */
export function loadMermaid(): Promise<MermaidApi> {
  if (!cached) {
    cached = import("mermaid").then((mod) => {
      // ESM/CJS 互操作:打包器有时把默认导出再包一层。
      const mermaid = ((mod as unknown as { default?: MermaidApi }).default ??
        mod) as MermaidApi;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default",
        fontFamily: "var(--wb-font, sans-serif)",
      });
      return mermaid;
    });
  }
  return cached;
}

/** 测试用:重置缓存。 */
export function resetMermaidLoader(): void {
  cached = null;
}
