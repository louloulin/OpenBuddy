/**
 * agent-core-ux-verify.mjs — **Agent 核心交互**真机深探针。
 *
 * prod1 证明了"核心旅程可用",但没证明"Agent 干活时的交互"可用。
 * 本探针专打 Agent 主链路的交互面:
 *   A1  权限审批:工具要权限 → 出现唯一审批面 → 点「允许」→ 工具真的执行
 *   A2  权限拒绝:点「拒绝」→ 工具不执行、回合不卡死
 *   A2b 会话级始终允许:同命令第二次不再弹审批
 *   A2c 审批内容可读:卡片正文出现真实命令
 *   A3  中断:流式中点「停止生成」→ 流式结束、输入框恢复可发
 *   A4  队列:流式中发第二条 → 进入待发送队列 → 队列 dock 可见
 *   A5  工具卡:工具调用渲染出卡片且可展开详情
 *   A6  错误恢复:存在可点的重试入口(有错误时)
 *   A7  思考块:助手消息的思考过程可见(模型支持时)
 *   A8  编辑重发:用户消息可编辑并重发
 *   A9  渲染层零 React 错误
 *   A10 权限模式:bypassPermissions 下不再弹审批
 *
 * 用本地 Ollama(无需余额)作为真实模型;权限路径靠 pi 的 permission 通道。
 *
 * Usage: node scripts/electron/agent-core-ux-verify.mjs
 */
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { resolveE2ECredentials, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SHOT_DIR = "/tmp/ob-agent-core-ux";
mkdirSync(SHOT_DIR, { recursive: true });
const log = (msg) => console.log(`[agent-ux] ${msg}`);

const creds = resolveE2ECredentials({});
if (!creds.apiKey) {
  console.error("[agent-ux] 缺少凭据(.env.e2e.local),无法验证");
  process.exit(2);
}

/**
 * Model boundary shim.
 *
 * The permission journey needs the model to emit a real `apply_command`
 * tool call. A 3B local model with 66 tools available is unreliable at
 * that (it answers with raw JSON text), which made the probe flaky and
 * masked the UI defects. This local proxy keeps the **whole app path**
 * real — tool dispatch, `ctx.ui.confirm`, permission IPC, renderer state,
 * resolution — and only scripts the model's output when the prompt
 * carries an explicit `TOOL_PROBE <command>` marker. Every other prompt
 * is streamed verbatim from the real Ollama endpoint.
 */
const PROXY_PORT = Number(process.env.OPENBUDDY_AGENT_UX_PROXY_PORT ?? 11439);
const REAL_BASE_URL = creds.baseUrl ?? "http://localhost:11434/v1";
let proxyRequests = 0;
let errorProbeServed = false;

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? "")).join(" ");
  }
  return content == null ? "" : String(content);
}

function lastMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages[messages.length - 1] ?? null;
}

function toolProbeCommand(text) {
  const match = /TOOL_PROBE\s+([\s\S]+)/.exec(text);
  if (!match) return null;
  return match[1].trim().replace(/^`|`$/g, "");
}

function writeChatCompletion(res, body, content) {
  if (body?.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-agent-ux", object: "chat.completion", created: 0, model: "agent-ux-probe",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({
    id: "chatcmpl-agent-ux", object: "chat.completion.chunk", created: 0, model: "agent-ux-probe",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
  res.write(chunk({ role: "assistant", content }));
  res.write(chunk({}, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Anthropic Messages API 版本的探针响应。
 *
 * 为什么需要两套:上游可能是 OpenAI 兼容端点(Ollama),也可能是 Anthropic
 * 兼容端点(MiniMax 的 /anthropic)。**协议必须跟着上游走** —— 之前这个探针
 * 只写 OpenAI 的 `chat.completion.chunk`,于是对着 Anthropic 端点注入
 * 工具调用时,客户端拿到的是无法解析的流,回合以
 * "Anthropic stream ended without a stop reason" 结束,工具卡与审批面
 * 全部不出现 —— 看起来像产品缺陷,其实是探针自己把线接错了。
 */
function anthropicEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function writeAnthropicText(res, body, content) {
  if (body?.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_agent_ux", type: "message", role: "assistant", model: "agent-ux-probe",
      content: [{ type: "text", text: content }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(anthropicEvent("message_start", {
    type: "message_start",
    message: {
      id: "msg_agent_ux", type: "message", role: "assistant", model: "agent-ux-probe",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  }));
  res.write(anthropicEvent("content_block_start", {
    type: "content_block_start", index: 0, content_block: { type: "text", text: "" },
  }));
  res.write(anthropicEvent("content_block_delta", {
    type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content },
  }));
  res.write(anthropicEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
  res.write(anthropicEvent("message_delta", {
    type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 },
  }));
  res.write(anthropicEvent("message_stop", { type: "message_stop" }));
  res.end();
}

function writeAnthropicToolCall(res, body, command, toolName = "apply_command", args = null) {
  const toolArgs = args ?? { command };
  const partialJson = JSON.stringify(toolArgs);
  if (body?.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_agent_ux", type: "message", role: "assistant", model: "agent-ux-probe",
      content: [{ type: "tool_use", id: "toolu_agent_ux", name: toolName, input: toolArgs }],
      stop_reason: "tool_use", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(anthropicEvent("message_start", {
    type: "message_start",
    message: {
      id: "msg_agent_ux", type: "message", role: "assistant", model: "agent-ux-probe",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  }));
  res.write(anthropicEvent("content_block_start", {
    type: "content_block_start", index: 0,
    content_block: { type: "tool_use", id: "toolu_agent_ux", name: toolName, input: {} },
  }));
  res.write(anthropicEvent("content_block_delta", {
    type: "content_block_delta", index: 0,
    delta: { type: "input_json_delta", partial_json: partialJson },
  }));
  res.write(anthropicEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
  // stop_reason 必须是 tool_use —— 客户端据此决定"这是一次工具调用"而不是
  // "模型说完了"。缺了它,回合会被当成普通文本结束。
  res.write(anthropicEvent("message_delta", {
    type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 },
  }));
  res.write(anthropicEvent("message_stop", { type: "message_stop" }));
  res.end();
}

async function writeAnthropicSlowStream(res, body, lines = 60) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (body?.stream === false) {
    writeAnthropicText(res, body, Array.from({ length: lines }, (_, i) => i + 1).join("\n"));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(anthropicEvent("message_start", {
    type: "message_start",
    message: {
      id: "msg_agent_ux", type: "message", role: "assistant", model: "agent-ux-probe",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  }));
  res.write(anthropicEvent("content_block_start", {
    type: "content_block_start", index: 0, content_block: { type: "text", text: "" },
  }));
  for (let i = 1; i <= lines; i += 1) {
    res.write(anthropicEvent("content_block_delta", {
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `${i}\n` },
    }));
    await delay(160);
  }
  res.write(anthropicEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
  res.write(anthropicEvent("message_delta", {
    type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: lines },
  }));
  res.write(anthropicEvent("message_stop", { type: "message_stop" }));
  res.end();
}

function writeToolCall(res, body, command, toolName = "apply_command", args = null) {
  const toolArgs = args ?? { command };
  if (body?.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-agent-ux", object: "chat.completion", created: 0, model: "agent-ux-probe",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_agent_ux", index: 0, type: "function", function: { name: toolName, arguments: JSON.stringify(toolArgs) } }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({
    id: "chatcmpl-agent-ux", object: "chat.completion.chunk", created: 0, model: "agent-ux-probe",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
  // Emit the whole call in one delta. Splitting name and arguments across
  // chunks made pi register the call twice (the first chunk carried the id,
  // the second looked like a new call with index 0 and no id).
  res.write(chunk({
    role: "assistant",
    content: null,
    tool_calls: [{
      index: 0,
      id: "call_agent_ux",
      type: "function",
      function: { name: toolName, arguments: JSON.stringify(toolArgs) },
    }],
  }));
  res.write(chunk({}, "tool_calls"));
  res.write("data: [DONE]\n\n");
  res.end();
}

async function writeSlowStream(res, body, lines = 60) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (body?.stream === false) {
    writeChatCompletion(res, body, Array.from({ length: lines }, (_, i) => i + 1).join("\n"));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({
    id: "chatcmpl-agent-ux", object: "chat.completion.chunk", created: 0, model: "agent-ux-probe",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
  res.write(chunk({ role: "assistant", content: "" }));
  for (let i = 1; i <= lines; i += 1) {
    res.write(chunk({ content: `${i}\n` }));
    await delay(160);
  }
  res.write(chunk({}, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
}

/** 请求转储目录：私有临时目录，不用可预测的 /tmp 路径。 */
const proxyDumpDir = mkdtempSync(join(tmpdir(), "ob-agentux-req-"));

const proxy = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body = {};
  try { body = JSON.parse(raw || "{}"); } catch { /* forward verbatim */ }
  proxyRequests += 1;
  if (proxyRequests <= 3) {
    // 用 mkdtempSync 建的私有目录，不用可预测的 /tmp/<name> —— 后者是
    // CodeQL js/insecure-temporary-file 指出的符号链接攻击面（本机多用户
    // 场景下别人可以预先占位/替换）。目录在 388 行创建，退出时清理。
    try {
      writeFileSync(join(proxyDumpDir, `request-${proxyRequests}.json`), JSON.stringify(body, null, 2));
    } catch { /* ignore */ }
  }

  // 协议必须跟着上游走:Anthropic Messages 端点(/v1/messages)与 OpenAI
  // chat-completions 端点(/chat/completions)的请求与响应格式完全不同。
  const anthropic = /\/(v1\/)?messages(\?|$)/.test(req.url ?? "");
  const writeText = (content) => (anthropic ? writeAnthropicText(res, body, content) : writeChatCompletion(res, body, content));
  const writeTool = (command, toolName, args) =>
    anthropic ? writeAnthropicToolCall(res, body, command, toolName, args) : writeToolCall(res, body, command, toolName, args);
  const writeSlow = async (lines) =>
    anthropic ? writeAnthropicSlowStream(res, body, lines) : writeSlowStream(res, body, lines);

  const last = lastMessage(body);
  // Only a *fresh* user turn may trigger the shim. If the last message is
  // the tool result, the turn is over — answer with text, otherwise the
  // marker would be re-read from history forever and the tool would loop.
  // OpenAI 把工具结果放在 role:"tool" 的消息里;Anthropic 放在 user 消息的
  // tool_result content block 里 —— 两种都要认。
  const anthropicToolResult =
    last?.role === "user" && Array.isArray(last.content) &&
    last.content.some((part) => part?.type === "tool_result");
  if (last?.role === "tool" || anthropicToolResult) {
    writeText("done");
    return;
  }
  const lastText = last?.role === "user" ? contentText(last.content) : "";
  if (lastText.includes("STREAM_PROBE")) {
    await writeSlow(60);
    return;
  }
  if (lastText.includes("ERROR_PROBE")) {
    if (!errorProbeServed) {
      errorProbeServed = true;
      log("model-shim: inject 402 error");
      // 402 is not retried by pi's transport layer, so the banner actually
      // reaches the renderer (5xx would be retried and masked).
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify(
        anthropic
          ? { type: "error", error: { type: "insufficient_balance_error", message: "probe insufficient balance" } }
          : { error: { message: "probe insufficient balance", type: "insufficient_balance_error", code: "insufficient_balance_error" } },
      ));
      return;
    }
    writeText("recovered");
    return;
  }
  if (lastText.includes("FAIL_PROBE")) {
    log("model-shim: tool_call apply_patch(/etc/agent-ux-denied)");
    writeTool("", "apply_patch", {
      file_path: "/etc/agent-ux-denied",
      patch: "@@ -1,1 +1,1 @@\n-a\n+b",
    });
    return;
  }
  const command = toolProbeCommand(lastText);
  if (command) {
    log(`model-shim: tool_call apply_command(${command})`);
    writeTool(command);
    return;
  }

  try {
    // 上游 URL 的拼接要分协议:
    //   OpenAI     base "http://host:11434/v1" + req.url "/chat/completions"
    //              → origin + req.url(base 路径已含在 req.url 里)
    //   Anthropic  base "https://api.minimaxi.com/anthropic" + req.url "/v1/messages"
    //              → origin + base 路径 + req.url(base 路径不在 req.url 里)
    // 之前统一用 origin + req.url,把 Anthropic 端点的 "/anthropic" 前缀丢了。
    const baseUrl = new URL(REAL_BASE_URL);
    const basePath = anthropic
      ? baseUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")
      : "";
    const upstreamUrl = baseUrl.origin + basePath + (req.url ?? "/");
    const upstreamHeaders = { "content-type": "application/json" };
    if (anthropic) {
      upstreamHeaders["x-api-key"] = creds.apiKey;
      upstreamHeaders["anthropic-version"] = "2023-06-01";
    }
    upstreamHeaders["authorization"] = `Bearer ${creds.apiKey}`;
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      // 本地 E2E 代理的全部职责就是把请求连同凭据转发给上游 provider;
      // 凭据来自 .env.e2e.local / 环境变量是设计使然,不是数据外泄。
      // codeql[js/file-access-to-http]
      headers: upstreamHeaders,
      body: raw,
    });
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end(await upstream.text());
    }
  } catch (error) {
    console.error("[agent-ux] upstream proxy error:", error);
    res.writeHead(502); res.end("{}");
  }
});

const userData = mkdtempSync(join(tmpdir(), "ob-agentux-ud-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

const childEnv = scrubProviderCredentials({
  ...process.env,
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

const checks = [];
function record(id, label, ok, detail = "") {
  checks.push({ id, ok, label });
  const tag = ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
  log(`${tag}  ${id}  ${label}${detail ? ` — ${detail}` : ""}`);
}

let app;
let page;
const consoleErrors = [];

try {
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(PROXY_PORT, "127.0.0.1", resolve);
  });
  log(`model shim listening on 127.0.0.1:${PROXY_PORT} (upstream ${REAL_BASE_URL})`);
  log("launching Electron…");
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron"),
    cwd: ROOT,
    timeout: 90_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(String(m.text()).slice(0, 300));
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 300)));
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(1000);

  const invoke = (channel, args) =>
    page.evaluate(({ channel: ch, args: a }) => window.api.invoke(ch, a), { channel, args });

  // 配置 provider + model(协议可注入,默认 Anthropic Messages)
  const providerKind = process.env.OPENBUDDY_E2E_PROVIDER_KIND ?? "custom_anthropic";
  const apiBackend = process.env.OPENBUDDY_E2E_API_BACKEND ?? "messages";
  const providerId = creds.providerId ?? creds.modelId.split("/")[0];
  const bareModel = creds.modelId.includes("/") ? creds.modelId.split("/").slice(1).join("/") : creds.modelId;
  await invoke("agent:providers-save-provider", {
    provider: {
      id: providerId,
      label: "agent-ux",
      providerKind,
      apiKey: creds.apiKey,
      baseUrl: `http://127.0.0.1:${PROXY_PORT}/v1`,
      apiBackend,
      authScheme: providerKind.startsWith("custom_anthropic") ? "x_api_key" : "bearer",
    },
  });
  await invoke("agent:providers-save-model", {
    model: { providerId, modelId: bareModel, name: bareModel, contextWindow: 128000, reasoning: false },
  });
  await invoke("agent:set-model", { modelId: `${providerId}/${bareModel}` });

  // 首启/未配置模型时，设置面板可能自动弹出并拦掉侧栏点击。
  const dismissSettings = async () => {
    const close = page.locator(".settings-modal__close");
    if ((await close.count()) > 0) await close.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  };
  await dismissSettings();

  // 会话(工作区 = 仓库根,便于 read 工具读到真实文件)
  await invoke("agent:new-session", { cwd: ROOT });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await dismissSettings();
  await page.locator(".sidebar__conv").first().waitFor({ state: "visible", timeout: 20_000 });
  await dismissSettings();
  await page.locator(".sidebar__conv").first().click({ force: true });
  await page.waitForTimeout(1500);

  const composer = page.locator("textarea.wb-composer__input");
  await composer.waitFor({ state: "visible", timeout: 20_000 });

  // ── F4 空态引导 ──
  const emptyState = await page.locator(".chatview__empty-state").count();
  record("F4", "空会话展示引导与可点示例", emptyState > 0, `${emptyState} 个空态块`);
  await page.screenshot({ path: join(SHOT_DIR, "empty.png") });
  const card = page.locator('[data-testid="permission-card"]');
  const allowBtn = page.locator('[data-testid="permission-allow"]');
  const allowAlwaysBtn = page.locator('[data-testid="permission-allow-always"]');
  const denyBtn = page.locator('[data-testid="permission-card"] button:has-text("拒绝")');

  const waitIdle = async (ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await page.getByRole("button", { name: "停止生成" }).count()) === 0) return true;
      await page.waitForTimeout(300);
    }
    return false;
  };
  const send = async (text) => {
    // Sending while a turn is still streaming is silently dropped by the
    // composer (`handleSendContent` returns early), which used to make the
    // next assertion observe the *previous* turn.
    await waitIdle();
    await composer.fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).first().click();
  };
  const waitForApproval = async (ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await card.count()) > 0) return true;
      await page.waitForTimeout(400);
    }
    return false;
  };
  const waitForCardGone = async (ms = 8_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await card.count()) === 0) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };

  // ── A1 / A2c 权限审批 + 内容可读 ──
  await send("TOOL_PROBE echo agent-ux-probe");
  const approvalSeen = await waitForApproval();
  record("A1a", "危险工具触发权限审批面", approvalSeen, approvalSeen ? "出现唯一审批卡" : "未出现(工具调用未触发权限路径)");

  // 唯一审批面:同一时刻不应再出现第二张审批卡或全屏遮罩
  const cardCount = await card.count();
  const overlayCount = await page.locator('[data-testid="permission-overlay"]').count();
  record("A1a2", "同一时刻只有一个审批面", approvalSeen ? cardCount === 1 && overlayCount === 0 : "skip", `cards=${cardCount} overlays=${overlayCount}`);

  if (approvalSeen) {
    await page.screenshot({ path: join(SHOT_DIR, "approval.png") });
    const messageText = (await page.locator('[data-testid="permission-message"]').first().textContent().catch(() => "")) ?? "";
    record("A2c", "审批卡正文包含真实命令", messageText.includes("agent-ux-probe"), messageText.trim().slice(0, 80));

    const toolLabel = (await page.locator('[data-testid="permission-tool-label"]').first().textContent().catch(() => "")) ?? "";
    const modeLabel = (await page.locator('[data-testid="permission-mode-label"]').first().textContent().catch(() => "")) ?? "";
    record("A2d", "审批卡展示本地化工具名与当前权限档位", /执行命令/.test(toolLabel) && modeLabel.length > 0, `${toolLabel} · ${modeLabel}`);

    const enabled = await allowBtn.first().isEnabled().catch(() => false);
    record("A1b", "「允许」按钮可点(无遮挡)", enabled);
    if (enabled) {
      await allowBtn.first().click();
      const gone = await waitForCardGone();
      record("A1c", "批准后审批面消失", gone);
    }
  } else {
    record("A2c", "审批卡正文包含真实命令", "skip", "未触发权限路径");
    record("A2d", "审批卡展示本地化工具名与当前权限档位", "skip", "未触发权限路径");
    record("A1b", "「允许」按钮可点(无遮挡)", "skip", "未触发权限路径");
    record("A1c", "批准后审批面消失", "skip", "未触发权限路径");
  }

  // 工具卡渲染
  // 单个工具渲染为 .toolcall;并行的多个工具折叠为 tool-group-summary。
  const toolRow = page.locator('.toolcall, [data-testid="tool-group-summary"]');
  const toolCards = await toolRow.count();
  record("A5", "工具调用渲染出工具卡", toolCards > 0, `${toolCards} 行`);
  if (toolCards > 0) {
    const first = toolRow.first();
    const isGroup = (await first.getAttribute("data-testid")) === "tool-group-summary";
    await (isGroup ? first.locator(".tool-group-summary__header") : first).click();
    await page.waitForTimeout(600);
    const expanded = await page.locator(".tool-detail, .toolcall--expanded, .tool-group-summary__list").count();
    record("A5b", "工具卡可展开详情", expanded > 0, `${expanded} 个详情节点`);
  }

  // ── C2 长工具输出:截断 + 复制/展开 ──
  await page.waitForTimeout(1000);
  await send("TOOL_PROBE seq 1 500");
  const c2Approval = await waitForApproval(20_000);
  if (c2Approval) {
    await allowBtn.first().click().catch(() => {});
    await waitForCardGone();
  }
  await waitIdle(30_000);
  await page.waitForTimeout(800);
  // A5 打开的详情面板可能还停留在旧工具上;先关掉,再点最新一行,
  // 否则断言的是上一个 echo 工具(短输出,没有截断 UI)。
  await page.locator('.tool-side-panel__header button[aria-label="关闭面板"]').click().catch(() => {});
  await page.waitForTimeout(500);
  const c2Rows = page.locator('.chatview__scroll .toolcall, .chatview__scroll [data-testid="tool-group-summary"]');
  const c2RowCount = await c2Rows.count();
  if (c2RowCount > 0) {
    // 本回合的工具可能被折进并行组。先展开包含它的组,再点子行 ——
    // 直接点折叠组里的隐藏子行不会触发 onOpen。
    const seqGroups = page.locator('.chatview__scroll [data-testid="tool-group-summary"]', { hasText: "seq 1 500" });
    const seqGroupCount = await seqGroups.count();
    for (let i = 0; i < seqGroupCount; i += 1) {
      const header = seqGroups.nth(i).locator(".tool-group-summary__header");
      if ((await header.getAttribute("aria-expanded").catch(() => "false")) !== "true") {
        await header.dispatchEvent("click").catch(() => {});
      }
    }
    await page.waitForTimeout(600);
    const targetRow = page.locator('.chatview__scroll .toolcall', { hasText: "seq 1 500" }).last();
    const row = (await targetRow.count()) > 0 ? targetRow : c2Rows.last();
    const rowIsGroup = (await row.getAttribute("data-testid")) === "tool-group-summary";
    const clickTarget = rowIsGroup ? row.locator(".tool-group-summary__header") : row;
    const clickedHtml = await clickTarget.evaluate((el) => el.outerHTML.slice(0, 160)).catch(() => "");
    // dispatchEvent 绕开遮挡/动画导致的 actionability 等待,直接触发 React 的
    // onClick(真实鼠标点击在滚动容器里偶发被忽略)。
    const clickErr = await clickTarget.dispatchEvent("click").then(() => "").catch((e) => String(e).slice(0, 200));
    log(`C2 clicked=${JSON.stringify(clickedHtml)}`);
    await page.waitForTimeout(900);
    const detailCount = await page.locator(".tool-detail").count();
    const panelCount = await page.locator(".tool-side-panel").count();
    const panelText = panelCount > 0 ? ((await page.locator(".tool-side-panel").innerText().catch(() => "")) ?? "").slice(0, 100) : "";
    log(`C2 detail=${detailCount} panel=${panelCount} clickErr=${JSON.stringify(clickErr)} panelText=${JSON.stringify(panelText)}`);
    const scope = page.locator(".tool-detail").last();
    const outputVisible = (await scope.locator('[data-testid="toolcall-output"]').count()) > 0;
    const copyVisible = (await scope.locator('[data-testid="toolcall-output-copy"]').count()) > 0;
    const expandVisible = (await scope.locator('[data-testid="toolcall-output-expand"]').count()) > 0;
    const moreCount = await scope.locator(".toolcall__output-more").count();
    record("C2", "长工具输出截断并提供复制/展开", outputVisible && copyVisible && expandVisible && moreCount > 0, `output=${outputVisible} copy=${copyVisible} expand=${expandVisible} trunc=${moreCount}`);
    // 关掉侧栏,否则它的边缘拖拽条会盖住后续的错误重试按钮。
    await page.locator('.tool-side-panel__header button[aria-label="关闭面板"]').click().catch(() => {});
    await page.waitForTimeout(300);
  } else {
    record("C2", "长工具输出截断并提供复制/展开", "skip", "未找到工具行");
  }

  // ── A2 拒绝 ──
  await page.waitForTimeout(1200);
  await send("TOOL_PROBE echo agent-ux-denied");
  const denySeen = await waitForApproval();
  if (denySeen) {
    await denyBtn.first().click();
    const gone = await waitForCardGone();
    await page.waitForTimeout(2500);
    const sendBack = (await page.getByRole("button", { name: "发送", exact: true }).count()) > 0;
    record("A2", "拒绝后审批面消失且回合不卡死", gone && sendBack, `gone=${gone} send=${sendBack}`);
  } else {
    record("A2", "拒绝后审批面消失且回合不卡死", "skip", "第二次未触发权限路径");
  }

  // ── A2b 会话级始终允许 ──
  await page.waitForTimeout(1200);
  await send("TOOL_PROBE echo agent-ux-always");
  const alwaysSeen = await waitForApproval();
  if (alwaysSeen) {
    const alwaysEnabled = await allowAlwaysBtn.first().isEnabled().catch(() => false);
    if (alwaysEnabled) {
      await allowAlwaysBtn.first().click();
      await waitForCardGone();
      await page.waitForTimeout(2000);
      await send("TOOL_PROBE echo agent-ux-always");
      const secondApproval = await waitForApproval(25_000);
      record("A2b", "「本会话始终允许」后同命令不再弹审批", !secondApproval, secondApproval ? "第二次仍弹审批" : "第二次直接执行");
      if (secondApproval) await denyBtn.first().click().catch(() => {});
    } else {
      record("A2b", "「本会话始终允许」后同命令不再弹审批", false, "始终允许按钮不可点");
    }
  } else {
    record("A2b", "「本会话始终允许」后同命令不再弹审批", "skip", "未触发权限路径");
  }

  // ── A6 / A6b 错误横幅 + 重试幂等 ──
  await send("ERROR_PROBE");
  const errorSelector = ".chatview__error-banner:visible, .turn-error:visible";
  let sawError = false;
  const errorDeadline = Date.now() + 20_000;
  while (Date.now() < errorDeadline) {
    if ((await page.locator(errorSelector).count()) > 0) { sawError = true; break; }
    await page.waitForTimeout(300);
  }
  record("A6", "失败回合出现错误横幅/错误卡", sawError);
  if (sawError) {
    const beforeRetry = await page.getByText("ERROR_PROBE", { exact: true }).count();
    const retry = page.locator('[data-testid="chatview-error-retry"]:visible, .turn-error__retry:visible, button[aria-label*="重试"]:visible').first();
    const retryVisible = (await retry.count()) > 0;
    if (retryVisible) await retry.click();
    await waitIdle(25_000);
    const afterRetry = await page.getByText("ERROR_PROBE", { exact: true }).count();
    // The failed turn's transcript card legitimately stays as history; only
    // the transient banner must clear.
    const stillBanner = await page.locator(".chatview__error-banner:visible").count();
    record("A6b", "重试不重复插入用户消息且错误横幅消失", retryVisible && beforeRetry === afterRetry && stillBanner === 0, `users ${beforeRetry}→${afterRetry} banner=${stillBanner}`);
  } else {
    record("A6b", "重试不重复插入用户消息且错误消失", "skip", "未出现错误横幅");
  }

  // ── A12 工具失败卡片 ──
  await send("FAIL_PROBE");
  await page.waitForTimeout(3000);
  await waitIdle(25_000);
  // Failed calls may be folded into a parallel group; expand every group
  // before counting (collapsed groups render only the summary row).
  for (const header of await page.locator(".tool-group-summary__header").all()) {
    await header.click().catch(() => {});
  }
  await page.waitForTimeout(500);
  const failedCards = await page.locator(".toolcall--err").count();
  const rows = await page.locator('.toolcall, [data-testid="tool-group-summary"]').evaluateAll((els) =>
    els.map((el) => ({ cls: el.className, text: (el.textContent ?? "").slice(0, 100) })),
  ).catch(() => []);
  log(`A12 rows: ${JSON.stringify(rows)}`);
  record("A12", "工具失败渲染为红色失败卡片", failedCards > 0, `${failedCards} 个失败节点`);

  // ── A13 上下文用量 pill(有 usage 时) ──
  const pill = page.locator(".context-usage__pill");
  const pillCount = await pill.count();
  const pillText = pillCount > 0 ? ((await pill.first().textContent()) ?? "").trim() : "";
  record("A13", "上下文用量 pill 显示真实百分比", pillCount > 0 ? /^\d+%$/.test(pillText) : "skip", pillCount > 0 ? pillText : "provider/model 未上报 context 窗口或 usage(Ollama 能力边界)");

  // ── A3 中断(独立长回合) ──
  await page.waitForTimeout(1500);
  // A12 展开了若干工具组，视口可能停在中段。跟随模式只在"贴底"时生效，
  // 先显式回到底部，否则 A11 会测到一次用户主动上滚后的位置。
  const jumpToBottom = page.locator(".chatview__jump-bottom");
  if ((await jumpToBottom.count()) > 0) {
    await jumpToBottom.first().click().catch(() => {});
  }
  await page.locator(".chatview__scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => {});
  await page.waitForTimeout(400);
  await send("STREAM_PROBE");
  await page.waitForTimeout(2500);
  const stopBtn = page.getByRole("button", { name: "停止生成" });
  const streamingNow = (await stopBtn.count()) > 0;
  if (streamingNow) {
    // A11 — 跟随流式时用户应当仍钉在底部，且不出现无意义的未读徽标。
    const scrollState = await page.evaluate(() => {
      const el = document.querySelector(".chatview__scroll");
      if (!el) return null;
      return {
        gap: el.scrollHeight - el.scrollTop - el.clientHeight,
        unread: document.querySelectorAll(".chatview__jump-bottom").length,
      };
    });
    record("A11", "长回答流式期间保持底部跟随且无未读徽标", scrollState ? scrollState.gap <= 48 && scrollState.unread === 0 : "skip", scrollState ? `gap=${Math.round(scrollState.gap)} unread=${scrollState.unread}` : "no scroll container");
    await stopBtn.first().click();
    await page.waitForTimeout(2500);
    const stillStreaming = (await page.getByRole("button", { name: "停止生成" }).count()) > 0;
    const sendBack = (await page.getByRole("button", { name: "发送", exact: true }).count()) > 0;
    record("A3", "流式中可中断且输入框恢复", !stillStreaming && sendBack, `streaming=${stillStreaming} send=${sendBack}`);
    // 中断不应把本轮已有内容清空，也不应伪造一条错误横幅。
    const errorBanner = await page.locator(".chatview__error-banner:visible").count();
    const transcript = (await page.locator(".chatview__messages, .chatview__scroll").first().innerText().catch(() => "")) ?? "";
    record("A3b", "中断后保留已生成内容且无错误横幅", errorBanner === 0 && transcript.trim().length > 0, `errors=${errorBanner} chars=${transcript.trim().length}`);
  } else {
    record("A3", "流式中可中断且输入框恢复", "skip", "未观测到流式态");
  }

  // ── A4 队列 ──
  await page.waitForTimeout(1200);
  await send("STREAM_PROBE");
  await page.waitForTimeout(2000);
  // 入队按钮只在"流式中 + 输入框非空"时出现 —— 必须先输入再找按钮。
  await composer.fill("这条应当进入待发送队列");
  const enqueueBtn = page.getByRole("button", { name: "加入待发送队列" });
  if ((await enqueueBtn.count()) > 0) {
    await enqueueBtn.first().click();
    await page.waitForTimeout(1200);
    const queued = (await page.locator(".composer-queued, .queued-messages, [data-testid*='queue']").count()) > 0;
    record("A4", "流式中第二条进入待发送队列(dock 可见)", queued);
    await page.screenshot({ path: join(SHOT_DIR, "queue.png") });

    // 回合自然结束后队列应自动出队发送，dock 归零。
    const deadline = Date.now() + 20_000;
    let drained = false;
    while (Date.now() < deadline) {
      if ((await page.locator(".composer-queued").count()) === 0) { drained = true; break; }
      await page.waitForTimeout(500);
    }
    const queuedVisible = (await page.locator(".chatview__messages, .chatview__scroll").first().innerText().catch(() => "")).includes("这条应当进入待发送队列");
    record("A4b", "回合结束后队列自动出队发送", drained && queuedVisible, `drained=${drained} visible=${queuedVisible}`);
  } else {
    record("A4", "流式中第二条进入待发送队列(dock 可见)", "skip", "未观测到流式态");
    record("A4b", "回合结束后队列自动出队发送", "skip", "未观测到流式态");
  }
  // 收尾:停掉当前生成,避免残留
  await page.getByRole("button", { name: "停止生成" }).first().click().catch(() => {});
  await page.waitForTimeout(1500);

  // ── A6 重试入口(有错误时) ──
  const retryCount = await page.locator('[data-testid="chatview-error-retry"]:visible, .turn-error__retry:visible, button[aria-label*="重试"]:visible').count();
  record("A6", "错误卡/横幅存在可点重试入口(有错误时)", retryCount > 0 ? true : "skip", `${retryCount} 个`);

  // ── A7 思考块 ──
  const thoughtCount = await page.locator(".msg__thought").count();
  record("A7", "助手思考过程可见(模型支持时)", thoughtCount > 0 ? true : "skip", `${thoughtCount} 个思考块`);

  // ── A8 编辑重发 ──
  const editBtns = await page.locator('.msg__actions button[aria-label*="编辑"], button[title*="编辑"]').count();
  record("A8", "用户消息有编辑入口", editBtns > 0, `${editBtns} 个`);
  if (editBtns > 0) {
    const editBtn = page.locator('.msg--user .msg__actions button[aria-label*="编辑"]').first();
    if ((await editBtn.count()) > 0) {
      const usersBefore = await page.locator(".msg--user").count();
      await editBtn.click();
      const input = page.locator('[data-testid="user-bubble-edit-input"]');
      await input.waitFor({ state: "visible", timeout: 5_000 });
      await input.fill("EDITED agent-ux message");
      await page.locator('[data-testid="user-bubble-edit-submit"]').click();
      // Submission now rewinds the origin turn and resends directly — no
      // second manual send, otherwise the new prompt is appended twice.
      await page.waitForTimeout(2500);
      await waitIdle(35_000);
      await page.waitForTimeout(800);
      const editedCount = await page.getByText("EDITED agent-ux message", { exact: true }).count();
      const editedUserBubbles = await page.locator(".msg--user", { hasText: "EDITED agent-ux message" }).count();
      const usersAfter = await page.locator(".msg--user").count();
      log(`A8b occ=${editedCount} userBubbles=${editedUserBubbles} users ${usersBefore}→${usersAfter}`);
      record("A8b", "编辑重发后新文本只出现一次(版本历史保留)", editedCount === 1 && editedUserBubbles === 1, `occ=${editedCount} userBubbles=${editedUserBubbles}`);
    } else {
      record("A8b", "编辑重发后新文本只出现一次(版本历史保留)", "skip", "未找到用户消息编辑按钮");
    }
  } else {
    record("A8b", "编辑重发后新文本只出现一次(版本历史保留)", "skip", "无编辑入口");
  }

  // ── A10 权限模式:bypassPermissions 不再弹审批 ──
  await invoke("permission:mode-set", "bypassPermissions");
  await page.waitForTimeout(800);
  const toolCountBeforeBypass = await page.locator('.toolcall, [data-testid="tool-group-summary"]').count();
  await send("TOOL_PROBE echo agent-ux-bypass");
  await page.waitForTimeout(12_000);
  const bypassCard = (await card.count()) > 0;
  const bypassTool = (await page.locator('.toolcall, [data-testid="tool-group-summary"]').count()) > toolCountBeforeBypass;
  record("A10", "完全访问模式下不再弹审批", !bypassCard && bypassTool, `card=${bypassCard} newTool=${bypassTool}`);
  await invoke("permission:mode-set", "default").catch(() => {});

  // ── A14 计划模式:执行类工具强制询问,卡片显示当前档位 ──
  await invoke("permission:mode-set", "plan");
  await page.waitForTimeout(800);
  const modeAfterSet = await invoke("permission:mode-get").catch(() => null);
  await send("TOOL_PROBE echo agent-ux-plan");
  const planApproval = await waitForApproval(20_000);
  if (planApproval) {
    const planModeText = (await page.locator('[data-testid="permission-mode-label"]').first().textContent().catch(() => "")) ?? "";
    record("A14", "计划模式下执行类工具强制询问且档位可见", /计划模式/.test(planModeText), `${planModeText.trim()} (host=${modeAfterSet})`);
    await denyBtn.first().click().catch(() => {});
    await waitIdle(15_000);
  } else {
    record("A14", "计划模式下执行类工具强制询问且档位可见", false, "未出现审批卡");
  }
  await invoke("permission:mode-set", "default").catch(() => {});

  // ── F3 会话切换:旧转录恢复且不串流 ──
  const oldSessionMarker = "FAIL_PROBE";
  const oldHadMarker = ((await page.locator(".chatview__scroll").innerText().catch(() => "")) ?? "").includes(oldSessionMarker);
  await invoke("agent:new-session", { cwd: ROOT });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1800);
  await dismissSettings();
  const convRows = page.locator(".sidebar__conv");
  const convRowCount = await convRows.count();
  if (convRowCount >= 2) {
    await convRows.first().click({ force: true });
    await page.waitForTimeout(1800);
    await send("F3 新会话独有内容");
    await waitIdle(35_000);
    const newTranscript = (await page.locator(".chatview__scroll").innerText().catch(() => "")) ?? "";
    const newSessionClean = !newTranscript.includes(oldSessionMarker);
    // 旧会话是列表里更早的一行(列表按最近活动倒序)。
    await convRows.last().click({ force: true });
    await page.waitForTimeout(2500);
    const restoredTranscript = (await page.locator(".chatview__scroll").innerText().catch(() => "")) ?? "";
    const restoredOld = restoredTranscript.includes(oldSessionMarker);
    const noLeak = !restoredTranscript.includes("F3 新会话独有内容");
    record("F3", "会话切换后恢复原转录且无串流", oldHadMarker && newSessionClean && restoredOld && noLeak, `old=${oldHadMarker} newClean=${newSessionClean} restored=${restoredOld} leak=${!noLeak}`);
  } else {
    record("F3", "会话切换后恢复原转录且无串流", "skip", `仅 ${convRowCount} 个会话行`);
  }

  // ── A9 渲染层 ──
  const reactErrors = consoleErrors.filter((e) => /Minified React error|React error/i.test(e));
  record("A9", "零 React 错误", reactErrors.length === 0, reactErrors.slice(0, 2).join(" | "));

  await page.screenshot({ path: join(SHOT_DIR, "final.png") });
} catch (error) {
  const message = String(error?.message ?? error).slice(0, 600);
  log(`PROBE ERROR: ${message}`);
  try {
    await page?.screenshot({ path: join(SHOT_DIR, "probe-error.png") });
  } catch {}
  record("PROBE", "探针完成(无异常)", false, message);
} finally {
  try { await app?.close(); } catch {}
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
  try { rmSync(proxyDumpDir, { recursive: true, force: true }); } catch {}
  try { proxy.close(); } catch {}
}

const failed = checks.filter((c) => c.ok === false);
const skipped = checks.filter((c) => c.ok === "skip");
const passed = checks.filter((c) => c.ok === true);
console.log(
  `\n[agent-ux] ${passed.length} 通过 / ${skipped.length} 跳过 / ${failed.length} 失败 — 共 ${checks.length}` +
    (skipped.length ? `\n跳过:${skipped.map((c) => c.id).join(", ")}` : "") +
    (failed.length ? `\n未通过:${failed.map((c) => c.id).join(", ")}` : "") +
    `\n截图:${SHOT_DIR}`,
);
process.exit(failed.length > 0 ? 1 : 0);
