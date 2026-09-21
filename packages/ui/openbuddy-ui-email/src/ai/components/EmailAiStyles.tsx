/**
 * EmailAiStyles — 统一收敛 ai.css 的注入入口(P3-收尾)。
 *
 * 设计动机:
 *   - 之前 EmailAiPanel 模块顶 `import "../ai.css"`,每次模块加载都会触发
 *     Vite chunk 解析,与其他 UI 包(ui-conversation / ui-workbench)共消费
 *     时会造成 chunk 边界重排 + 重复注入风险。
 *   - 现在把这个副作用收敛到 host(AppShell)在 root 一次性挂载。
 *   - 组件只做副作用,渲染 null。
 *
 * 副作用三件套:
 *   1. 静态 import ai.css(Vite 注入 <link> 或 <style>)。
 *   2. 运行时 inject <style id="openbuddy-ai-tokens"> — 包含 AI 私有变量
 *      和 `--wb-*` 全局变量 fallback(theme 未加载时仍可用)。
 *   3. SSR / 测试安全:document 不存在时跳过注入。
 *
 * 用法:
 *   // AppShell.tsx
 *   import { EmailAiStyles } from "@openbuddy/ui-email/ai";
 *   <EmailAiStyles />
 */
import { useEffect } from "react";
import { buildTokenStyleSheet } from "../ai-tokens";
import "../ai.css";

const STYLE_TAG_ID = "openbuddy-ai-tokens";

export function EmailAiStyles(): null {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const css = buildTokenStyleSheet();
    let tag = document.getElementById(STYLE_TAG_ID);
    if (!tag) {
      tag = document.createElement("style");
      tag.setAttribute("id", STYLE_TAG_ID);
      tag.setAttribute("data-openbuddy-tokens", "ai");
      document.head.appendChild(tag);
    }
    tag.textContent = css;
    return () => {
      // 卸载时清理 — 配合 host 卸载 / 测试。
      const t = document.getElementById(STYLE_TAG_ID);
      if (t?.textContent === css) t.remove();
    };
  }, []);
  return null;
}
