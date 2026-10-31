/**
 * ChatShortcutOverlay 一致性守卫 —— 面板宣称的键位必须有真实注册点。
 *
 * 背景(2026-10-13 盘点):`CHAT_SHORTCUTS` 宣称了 ⌘R/⌘E/⌘P/⌘L/⌘⏎/⌘G 等
 * 键位,但代码里没有注册 —— 面板"单一真值"与现实脱节,用户按了没反应。
 * 本守卫把**每个 id** 钉到注册它的文件与代码模式上;新增宣称必须同步加映射,
 * 删除注册必须同步删映射 —— 两侧永远一起动。
 *
 * 注意:这是文本级守卫(本仓库 parity/contract 守卫同款传统)。它不验证
 * 运行时行为 —— 行为由各注册点的交互测试与真实启动探针覆盖。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const conversationSrc = join(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(conversationSrc, rel), "utf8");
}

/** id → [文件, 该文件里必须存在的注册代码片段]。 */
const REGISTRY: Record<string, Array<[string, RegExp]>> = {
  "chat-find": [["chatview/useChatViewShortcuts.ts", /toLowerCase\(\)\s*===?\s*"f"/]],
  "chat-find-next": [["FindBar.tsx", /key\.toLowerCase\(\)\s*!==\s*"g"/]],
  "chat-find-prev": [["FindBar.tsx", /e\.shiftKey \? -1 : 1/]],
  "chat-edit-last": [["chatview/useChatShortcuts.ts", /mod: true, key: "e"/]],
  "chat-pause": [["chatview/useChatShortcuts.ts", /mod: true, key: "p"/]],
  "chat-clear": [["Composer.tsx", /"l"/]],
  "chat-send": [["Composer.tsx", /key === "Enter"/]],
  "chat-history-prev": [["composer/use-input-history.ts", /ArrowUp/]],
  "chat-history-next": [["composer/use-input-history.ts", /ArrowDown/]],
  "chat-tools-panel": [["chatview/useChatViewShortcuts.ts", /toLowerCase\(\) === "t"/]],
  "chat-canvas": [["chatview/useChatViewShortcuts.ts", /onToggleCanvas/]],
  "chat-stop": [["chatview/useChatShortcuts.ts", /stopRef\.current\?\.\(\)/]],
  "chat-shortcuts": [["chatview/ChatShortcutOverlay.tsx", /"\?"|Ctrl\/Cmd\+\/|useEffect/]],
};

describe("CHAT_SHORTCUTS 宣称键位 = 真实注册点", () => {
  it("每个宣称的 id 都在 REGISTRY 有映射", async () => {
    const overlay = await import("../chatview/ChatShortcutOverlay");
    const ids = overlay.CHAT_SHORTCUTS.map((entry) => entry.id);
    const missing = ids.filter((id) => !(id in REGISTRY));
    expect(missing).toEqual([]);
  });

  it("每个映射的注册片段都真实存在于对应文件", () => {
    for (const [id, checks] of Object.entries(REGISTRY)) {
      for (const [file, pattern] of checks) {
        let source = "";
        try {
          source = read(file);
        } catch {
          throw new Error(`REGISTRY[${id}] 指向的文件不存在: ${file}`);
        }
        expect(
          pattern.test(source),
          `${id} 的注册片段在 ${file} 中找不到(宣称与实现漂移): ${pattern}`,
        ).toBe(true);
      }
    }
  });
});
