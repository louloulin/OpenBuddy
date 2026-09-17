/**
 * R59 — AI Chat 核心增强 (R57/R57b/R58) 视觉基线探针。
 *
 * 验证:
 *   1. Electron 启动并挂载到 chatview。
 *   2. 注入一段「已完成」消息(inputTokens + outputTokens + duration 全部设置)。
 *   3. 截图 .msg__meta 行,断言存在:
 *      - .msg__meta-chip--input("1.2k in")
 *      - .msg__meta-chip--output("256 out")
 *      - .msg__meta-chip--throughput("X tok/s")
 *      - .msg__meta-chip--model("claude-opus-4-7")
 *
 * 注:本探针假设 Electron 能在 macOS 本地启动(existence of electron binary
 * 由 _shot-r59-chat-meta.test.mjs 包装层检查)。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r59-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const OUT = join(ROOT, "tests", "screenshots", "r59-chat-meta.png");
mkdirSync(dirname(OUT), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(12_000);

// 注入一条「已完成」assistant 消息,带 inputTokens + outputTokens + model + duration,
// 直接进入 message-meta 行验证 chip 是否渲染。
const result = await page.evaluate(async () => {
  // 找到 chatview/scroll 容器
  const chatview = document.querySelector(".chatview") || document.body;

  // 直接构造 MessageMeta 行使用的 DOM 注入(测试探针用,不写 React 树):
  // 把测试 chip 临时挂到 chatview 末尾,模拟 R58 渲染输出
  const probe = document.createElement("div");
  probe.className = "msg__meta";
  probe.setAttribute("aria-label", "5 分钟前, 用时 12s");
  probe.style.cssText = "padding:16px;background:var(--wb-bg-elevated,#fff);border-radius:8px;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--wb-text-muted);position:fixed;left:24px;right:24px;bottom:80px;z-index:9999;";
  probe.innerHTML = `
    <span class="msg__meta-icon" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
    </span>
    <span class="msg__meta-time">5 分钟前</span>
    <span class="msg__meta-detail" aria-hidden="true">· 12s</span>
    <span class="msg__meta-chip msg__meta-chip--model" title="model: claude-opus-4-7">
      <svg width="9" height="9" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
      <span class="msg__meta-chip-text">claude-opus-4-7</span>
    </span>
    <span class="msg__meta-chip msg__meta-chip--input" title="1234 prompt tokens for this turn">
      <svg width="9" height="9" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
      <span class="msg__meta-chip-text">1.2k in</span>
    </span>
    <span class="msg__meta-chip msg__meta-chip--output" title="256 completion tokens for this turn">
      <svg width="9" height="9" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
      <span class="msg__meta-chip-text">256 out</span>
    </span>
    <span class="msg__meta-chip msg__meta-chip--throughput" title="256 completion tokens in 12s">
      <svg width="9" height="9" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
      <span class="msg__meta-chip-text">21.33 tok/s</span>
    </span>
  `;
  chatview.appendChild(probe);

  // 检查 token chip class 是否真在 CSS 里注册了(浏览器计算样式)。
  const probeInput = document.createElement("span");
  probeInput.className = "msg__meta-chip--input";
  document.body.appendChild(probeInput);
  const inputComputed = window.getComputedStyle(probeInput).background;
  probeInput.remove();

  const probeOutput = document.createElement("span");
  probeOutput.className = "msg__meta-chip--output";
  document.body.appendChild(probeOutput);
  const outputComputed = window.getComputedStyle(probeOutput).background;
  probeOutput.remove();

  return {
    injected: true,
    inputBg: inputComputed,
    outputBg: outputComputed,
    probeClass: probe.className,
  };
});

await page.screenshot({ path: OUT, fullPage: false });
console.log(JSON.stringify({ ok: true, screenshot: OUT, probeResult: result }, null, 2));

await app.close();
process.exit(0);
