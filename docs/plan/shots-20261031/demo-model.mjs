// Minimal Anthropic-Messages SSE server for UI screenshots.
//  - "记住" + memory_save available → tool_use memory_save
//  - "RATE" → HTTP 429
//  - "SLOW" → the normal reply, streamed slowly (~7s) for mid-turn switching
//  - otherwise → a short markdown reply
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const sse = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const textOf = (m) => typeof m?.content === "string" ? m.content
  : Array.isArray(m?.content) ? m.content.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : "";

const REPLY = `好的，下面是一个简单的计划：

1. **梳理需求**：确认目标与约束
2. **实现**：按优先级逐项完成
3. **验证**：跑测试并截图确认

\`\`\`ts
export function greet(name: string) {
  return \`你好，\${name}\`;
}
\`\`\`

需要我继续细化哪一步？`;

const server = createServer(async (req, res) => {
  if (req.method === "GET") { res.writeHead(200); res.end("ok"); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const messages = body.messages ?? [];
  const last = messages.at(-1);
  const lastText = textOf(last);
  const hasToolResult = Array.isArray(last?.content) && last.content.some((p) => p?.type === "tool_result");
  if (/RATE/.test(lastText) && !hasToolResult) {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded, please retry later" } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const id = `msg_${randomUUID().slice(0, 12)}`;
  res.write(sse("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 2400, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }));
  const wantsMemory = /记住/.test(lastText) && !hasToolResult && (body.tools ?? []).some((t) => t.name === "memory_save");
  if (wantsMemory) {
    res.write(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `toolu_${randomUUID().slice(0, 12)}`, name: "memory_save", input: {} } }));
    res.write(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ title: "回答偏好用中文", body: "所有回复使用简体中文，代码注释保持英文。", scope: "user" }) } }));
    res.write(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
    res.write(sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }));
  } else {
    const text = hasToolResult ? "已记下这条偏好。" : REPLY;
    res.write(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    for (const piece of text.match(/[\s\S]{1,8}/g)) {
      res.write(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }));
      await new Promise((r) => setTimeout(r, /SLOW/.test(lastText) ? 600 : 15));
    }
    res.write(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
    res.write(sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } }));
  }
  res.write(sse("message_stop", { type: "message_stop" }));
  res.end();
});
server.listen(0, "127.0.0.1", () => console.log(`PORT=${server.address().port}`));
