import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConversations, scanConversations } from "../src/data/import-conversations";

const chatgpt = JSON.stringify([
  {
    id: "c1",
    title: "季度复盘",
    create_time: 1,
    update_time: 1700000000,
    mapping: {
      a: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["帮我看下进度"] } } },
      b: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["好的，进度如下…"] } } },
    },
  },
]);

const claude = JSON.stringify([
  {
    uuid: "u1",
    name: "合同审阅",
    updated_at: "2026-01-02T03:04:05Z",
    chat_messages: [
      { sender: "human", text: "看看这份合同" },
      { sender: "assistant", text: "有两条风险…" },
    ],
  },
]);

const workbuddy = JSON.stringify({
  conversations: [
    { id: "w1", title: "整理周报", messages: [{ role: "user", content: "写周报" }, { role: "assistant", content: "已完成" }] },
  ],
});

describe("外部会话导入 (G4-3)", () => {
  it("识别 ChatGPT / Claude / WorkBuddy 三种导出格式", async () => {
    const dir = await mkdtemp(join(tmpdir(), "import-scan-"));
    const a = join(dir, "chatgpt.json"), b = join(dir, "claude.json"), c = join(dir, "wb.json");
    await writeFile(a, chatgpt); await writeFile(b, claude); await writeFile(c, workbuddy);

    const scanA = await scanConversations(a);
    expect(scanA.format).toBe("chatgpt");
    expect(scanA.conversations[0]).toMatchObject({ title: "季度复盘", messageCount: 2 });

    const scanB = await scanConversations(b);
    expect(scanB.format).toBe("claude");
    expect(scanB.conversations[0]).toMatchObject({ title: "合同审阅", messageCount: 2 });

    const scanC = await scanConversations(c);
    expect(scanC.format).toBe("workbuddy");
    expect(scanC.conversations[0]).toMatchObject({ title: "整理周报", messageCount: 2 });
  });

  it("无法识别的文件给出可读错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "import-bad-"));
    const bad = join(dir, "x.json");
    await writeFile(bad, JSON.stringify({ hello: "world" }));
    await expect(scanConversations(bad)).rejects.toThrow("无法识别这个文件");
  });

  it("导入写出 Markdown，重复导入同一内容不会重复写", async () => {
    const dir = await mkdtemp(join(tmpdir(), "import-apply-"));
    const src = join(dir, "chatgpt.json");
    const out = join(dir, "out");
    await writeFile(src, chatgpt);

    const first = await applyConversations(src, ["c1"], out);
    expect(first.written).toHaveLength(1);
    const files = await readdir(out);
    expect(files).toHaveLength(1);
    const text = await readFile(join(out, files[0]), "utf8");
    expect(text).toContain("# 季度复盘");
    expect(text).toContain("## 用户");
    expect(text).toContain("## 助手");

    const second = await applyConversations(src, ["c1"], out);
    expect(second.written).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(await readdir(out)).toHaveLength(1);
  });

  it("只导入被勾选的会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "import-pick-"));
    const src = join(dir, "claude.json");
    const out = join(dir, "out");
    await writeFile(src, claude);
    // 没有匹配项时明确报错，不静默成功。
    await expect(applyConversations(src, ["not-existing"], out)).rejects.toThrow("请选择要导入的会话");
  });
});
