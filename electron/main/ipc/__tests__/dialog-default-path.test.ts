/**
 * dialog-default-path.test.ts — 对话框「打开位置」提示的容错契约。
 *
 * 修的是什么
 * ----------
 * `dialog:open` / `dialog:save` 的 `defaultPath` 曾经走 `absolutePath()`,非绝对
 * 路径直接抛错。这看着严格,实际上制造了一个**静默死按钮**:
 *
 *   - 专家页 / 技能页把 Windows 风格默认值 `E:/Pi/agents` 传进来;
 *   - `isAbsolute("E:/Pi/agents")` 在 macOS/Linux 上是 `false`
 *     (POSIX 绝对路径必须以 `/` 开头);
 *   - main 侧抛错 → IPC promise reject;
 *   - 调用点的 `catch { }` 把它当成"用户取消了"(注释就写着 `/* cancelled *\/`);
 *   - 用户点「选择目录」**什么都不发生,也不报错**。
 *
 * 契约区分
 * --------
 * `defaultPath` 只是"对话框打开在哪"的**提示**,不是安全边界(`path` /
 * `root` 那些才是,它们继续走 `absolutePath()` 抛错)。提示无效时正确行为是
 * 忽略提示、打开系统默认位置。
 */
import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { dialogDefaultPath, openDialogOptions, saveDialogOptions } from "../validation";

describe("dialogDefaultPath", () => {
  it("接受绝对路径原样返回", () => {
    expect(dialogDefaultPath("/Users/x/.openbuddy/agent", "defaultPath")).toBe("/Users/x/.openbuddy/agent");
  });

  it("未提供时返回 undefined(不传 defaultPath,让系统决定)", () => {
    expect(dialogDefaultPath(undefined, "defaultPath")).toBeUndefined();
    expect(dialogDefaultPath(null, "defaultPath")).toBeUndefined();
  });

  it("空串 / 纯空白视为未提供", () => {
    expect(dialogDefaultPath("", "defaultPath")).toBeUndefined();
    expect(dialogDefaultPath("   ", "defaultPath")).toBeUndefined();
  });

  it("把 ~ 展开成 $HOME", () => {
    expect(dialogDefaultPath("~", "defaultPath")).toBe(homedir());
    expect(dialogDefaultPath("~/.openbuddy/agent", "defaultPath")).toBe(join(homedir(), ".openbuddy/agent"));
  });

  it("丢弃 Windows 盘符路径 —— 这是导致「点选择目录没反应」的原始输入", () => {
    // 在 POSIX 上 E:/... 不是绝对路径;在 Windows 上它是合法的,所以这个
    // 断言只在 POSIX 跑。CI 的 macos/linux job 会覆盖到。
    if (process.platform !== "win32") {
      expect(dialogDefaultPath("E:/Pi/agents", "defaultPath")).toBeUndefined();
      expect(dialogDefaultPath("E:\\Pi\\agents", "defaultPath")).toBeUndefined();
    }
  });

  it("丢弃相对路径(而不是抛错)", () => {
    expect(dialogDefaultPath("relative/dir", "defaultPath")).toBeUndefined();
    expect(dialogDefaultPath("./x", "defaultPath")).toBeUndefined();
  });

  it("非字符串仍然抛错 —— 那是调用方的类型 bug,不该被静默吞掉", () => {
    expect(() => dialogDefaultPath(42, "defaultPath")).toThrow();
    expect(() => dialogDefaultPath({ path: "/x" }, "defaultPath")).toThrow();
  });
});

describe("openDialogOptions / saveDialogOptions", () => {
  it("坏 defaultPath 不会让整个 options 解析抛错", () => {
    expect(() => openDialogOptions({ defaultPath: "E:/Pi/agents", title: "选择目录" })).not.toThrow();
    expect(() => saveDialogOptions({ defaultPath: "E:/Pi/agents" })).not.toThrow();
  });

  it("坏 defaultPath 被丢弃,其余字段照常生效", () => {
    if (process.platform === "win32") return;
    const open = openDialogOptions({ defaultPath: "E:/Pi/agents", title: "选择目录", properties: ["openDirectory"] });
    expect(open).not.toHaveProperty("defaultPath");
    expect(open.title).toBe("选择目录");
    expect(open.properties).toEqual(["openDirectory"]);

    const save = saveDialogOptions({ defaultPath: "E:/Pi/agents", buttonLabel: "保存" });
    expect(save).not.toHaveProperty("defaultPath");
    expect(save.buttonLabel).toBe("保存");
  });

  it("好 defaultPath 原样传给 Electron", () => {
    const opts = openDialogOptions({ defaultPath: "/tmp/ob-experts" });
    expect(opts.defaultPath).toBe("/tmp/ob-experts");
  });

  it("~ 形式的 defaultPath 在传给 Electron 之前已展开(它自己不展开)", () => {
    const opts = openDialogOptions({ defaultPath: "~/.openbuddy/agent/experts" });
    expect(opts.defaultPath).toBe(join(homedir(), ".openbuddy/agent/experts"));
    expect(opts.defaultPath?.startsWith("~")).toBe(false);
  });
});
