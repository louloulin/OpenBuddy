/**
 * EmailAiStyles — CSS 注入入口 + tokens 收敛测试。
 *
 * 覆盖:
 *   - 组件渲染 null
 *   - EmailAiPanel 不再模块顶 import ai.css
 *   - EmailAiStyles 注入 <style id="openbuddy-ai-tokens">
 *   - 注入的内容包含 AI token 与 --wb-* fallback
 *   - 卸载时清理
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EmailAiStyles } from "../components/EmailAiStyles";
import { AI_TOKEN_PALETTE, WB_TOKEN_FALLBACK, buildTokenStyleSheet } from "../ai-tokens";

afterEach(() => cleanup());

describe("EmailAiStyles", () => {
  it("renders null", () => {
    const { container } = render(<EmailAiStyles />);
    expect(container.firstChild).toBeNull();
  });

  it("EmailAiPanel 模块顶不再 import ai.css", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve(__dirname, "../components/EmailAiPanel.tsx");
    const source = await fs.readFile(filePath, "utf8");
    expect(source).not.toMatch(/^import\s+["']\.\.\/ai\.css["'];?$/m);
  });

  it("buildTokenStyleSheet 拼出 :root 块 + 所有 token", () => {
    const css = buildTokenStyleSheet();
    expect(css).toContain(":root {");
    for (const k of Object.keys(WB_TOKEN_FALLBACK)) {
      expect(css).toContain(k);
    }
    for (const k of Object.keys(AI_TOKEN_PALETTE)) {
      expect(css).toContain(k);
    }
  });

  it("mount 后注入 <style id=openbuddy-ai-tokens>", () => {
    render(<EmailAiStyles />);
    const tag = document.getElementById("openbuddy-ai-tokens");
    expect(tag).toBeTruthy();
    expect(tag?.getAttribute("data-openbuddy-tokens")).toBe("ai");
    expect(tag?.textContent).toContain(":root {");
  });

  it("卸载时清理 tag", () => {
    const { unmount } = render(<EmailAiStyles />);
    expect(document.getElementById("openbuddy-ai-tokens")).toBeTruthy();
    unmount();
    expect(document.getElementById("openbuddy-ai-tokens")).toBeNull();
  });

  it("重复挂载不会创建多个 tag(幂等)", () => {
    const { unmount: u1 } = render(<EmailAiStyles />);
    const { unmount: u2 } = render(<EmailAiStyles />);
    const tags = document.querySelectorAll("#openbuddy-ai-tokens");
    expect(tags.length).toBe(1);
    u1();
    u2();
  });
});
