import { describe, expect, it } from "vitest";
import { PRESET_ORDER, PRESETS } from "../model-config";

describe("magpie 本机网关预设", () => {
  it("出现在厂商预设里，指向 127.0.0.1:3425 的 OpenAI 兼容端点", () => {
    expect(PRESET_ORDER).toContain("magpie");
    expect(PRESETS.magpie).toMatchObject({
      baseUrl: "http://127.0.0.1:3425/v1",
      apiBackend: "chat_completions",
    });
    // 回环网关不需要 Key：占位文案明确说明可以留空。
    expect(PRESETS.magpie.placeholderKey).toContain("留空");
  });
});
