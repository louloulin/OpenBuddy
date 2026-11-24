import { describe, expect, it } from "vitest";
import { benchKind, isBinaryLoaded, isTextKind } from "../bench-kind";

describe("产物预览类型 (G3-1)", () => {
  it("mermaid 源码文件按图渲染，且按文本读取", () => {
    expect(benchKind("/work/flow.mmd")).toBe("mermaid");
    expect(benchKind("/work/flow.mermaid")).toBe("mermaid");
    expect(isTextKind("mermaid")).toBe(true);
    expect(isBinaryLoaded("mermaid")).toBe(false);
  });

  it("drawio / excalidraw 是结构化图表文件，按源码可读", () => {
    expect(benchKind("/work/arch.drawio")).toBe("diagram");
    expect(benchKind("/work/sketch.excalidraw")).toBe("diagram");
    expect(isTextKind("diagram")).toBe(true);
  });

  it("原有类型不受影响", () => {
    expect(benchKind("a.md")).toBe("markdown");
    expect(benchKind("a.png")).toBe("image");
    expect(benchKind("a.ts")).toBe("code");
    expect(benchKind("a.unknown")).toBe("binary");
  });
});
