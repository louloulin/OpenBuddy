/**
 * Tests for scripts/check-ipc-stubs.mjs.
 *
 * 这个门禁存在的理由是仓库反复出现的"假成功":UI 调用的通道实现是
 * `async () => null`,调用方把 null 当成功、再弹一句成功 toast。所以这里
 * 的核心用例全部是**红灯用例** —— 造一个 fixture,断言门禁确实失败,并点名
 * 是哪一类问题。只有红灯用例才能证明门禁会咬人;绿灯用例只是护栏。
 *
 * 另外锁住两个具体教训(都真的踩过):
 *   • 通道字面量出现在**注释**里不算实现(第一版把 `dialog:save` 误判成空桩);
 *   • 实现在 `electron/main/` 下的**任意位置**都算数,不只在 `ipc/` 目录
 *     (第一版把 `plugin:hash-content` 误报成"无处理器")。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, "scripts", "check-ipc-stubs.mjs");

const ALLOWLIST = (channels) =>
  `const allowedInvokeChannels = new Set([${channels.map((c) => `"${c}"`).join(", ")}]);\n`;

/** 造一棵最小 fixture 树:main 侧注册 + preload allowlist + UI 调用点。 */
function fixture({ channels, main, ui, baseline }) {
  const root = mkdtempSync(join(tmpdir(), "ipc-stub-gate-"));
  mkdirSync(join(root, "electron", "main", "ipc"), { recursive: true });
  mkdirSync(join(root, "electron", "preload"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "packages", "ui", "probe", "src"), { recursive: true });
  writeFileSync(join(root, "electron", "preload", "index.ts"), ALLOWLIST(channels));
  writeFileSync(join(root, "electron", "main", "ipc", "misc.ts"), main);
  writeFileSync(join(root, "packages", "ui", "probe", "src", "client.ts"), ui);
  if (baseline) writeFileSync(join(root, "scripts", "ipc-stub-baseline.json"), JSON.stringify(baseline));
  return root;
}

function run(root) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, OPENBUDDY_IPC_GATE_ROOT: root },
    encoding: "utf8",
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function withFixture(spec, fn) {
  const root = fixture(spec);
  try {
    return fn(run(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("check-ipc-stubs", () => {
  it("绿灯:UI 调用的通道有真实实现", () => {
    withFixture(
      {
        channels: ["demo:ok"],
        main: 'wrapIpcHandler("demo:ok", async (_e, a) => {\n  return await doWork(a);\n});\n',
        ui: 'export const f = () => invoke("demo:ok", {});\n',
      },
      ({ status, out }) => {
        expect(out).toContain("门禁通过");
        expect(status).toBe(0);
      },
    );
  });

  it("红灯:UI 调用的通道是空桩 → 判为「假成功」", () => {
    withFixture(
      {
        channels: ["tasks:add"],
        main: 'wrapIpcHandler("tasks:add", async (_e, args) => {\n  recordValue(args);\n  return null;\n});\n',
        ui: 'export const f = () => invoke("tasks:add", { id: 1 });\n',
      },
      ({ status, out }) => {
        expect(status).toBe(1);
        expect(out).toContain("假成功");
        expect(out).toContain("tasks:add");
      },
    );
  });

  it("红灯:UI 调用了没放行、也没注册的通道", () => {
    withFixture(
      {
        channels: ["demo:other"],
        main: 'wrapIpcHandler("demo:other", async () => 1);\n',
        ui: 'export const f = () => invoke("read_text_file", { path: "x" });\n',
      },
      ({ status, out }) => {
        expect(status).toBe(1);
        expect(out).toContain("通道不在 allowlist");
        expect(out).toContain("read_text_file");
      },
    );
  });

  it("红灯:allowlist 里有、UI 也调用,但 main 从未注册", () => {
    withFixture(
      {
        channels: ["demo:ghost"],
        main: 'wrapIpcHandler("demo:other", async () => 1);\n',
        ui: 'export const f = () => invoke("demo:ghost", {});\n',
      },
      ({ status, out }) => {
        expect(status).toBe(1);
        expect(out).toContain("无处理器");
        expect(out).toContain("demo:ghost");
      },
    );
  });

  it("显式移除:未登记即失败,写进 baseline 后放行", () => {
    const spec = {
      channels: ["automations_snapshot"],
      main:
        'const retired = "automations IPC has been retired";\n' +
        'wrapIpcHandler("automations_snapshot", async () => { throw new Error(retired); });\n',
      ui: 'export const f = () => invoke("automations_snapshot", {});\n',
    };
    withFixture(spec, ({ status, out }) => {
      expect(status).toBe(1);
      expect(out).toContain("未登记的显式移除");
    });
    withFixture(
      { ...spec, baseline: { removedButReferenced: { automations_snapshot: "阶段 1.4 重接线" } } },
      ({ status, out }) => {
        expect(out).toContain("门禁通过");
        expect(status).toBe(0);
      },
    );
  });

  it("基线腐烂:登记了但 UI 已不再引用 → 失败", () => {
    withFixture(
      {
        channels: ["demo:ok"],
        main: 'wrapIpcHandler("demo:ok", async (_e, a) => await work(a));\n',
        ui: 'export const f = () => invoke("demo:ok", {});\n',
        baseline: { removedButReferenced: { automations_run: "早就删了" } },
      },
      ({ status, out }) => {
        expect(status).toBe(1);
        expect(out).toContain("基线腐烂");
      },
    );
  });

  it("通道名只出现在注释里不算实现,实现在 ipc/ 之外也算数", () => {
    // 1) 注释里提到 dialog:save —— 真实处理器在别处,不应被判为空桩
    withFixture(
      {
        channels: ["dialog:save", "probe:run"],
        main:
          '// dialog:save 的 defaultPath 是提示,无效就返回 null\n' +
          'export function note() { return null; }\n',
        ui: 'export const f = () => invoke("dialog:save", {});\n',
      },
      ({ status, out }) => {
        // main 里完全没有 handler(只有注释)→ 应报"无处理器",而不是"假成功"
        expect(status).toBe(1);
        expect(out).toContain("UI 引用+无处理器 1");
        expect(out).not.toContain("[假成功]");
      },
    );
    // 2) 处理器住在 electron/main/plugin-hash.ts(不在 ipc/ 下)
    const root = mkdtempSync(join(tmpdir(), "ipc-stub-gate-"));
    try {
      mkdirSync(join(root, "electron", "main", "ipc"), { recursive: true });
      mkdirSync(join(root, "electron", "preload"), { recursive: true });
      mkdirSync(join(root, "packages", "ui", "probe", "src"), { recursive: true });
      writeFileSync(join(root, "electron", "preload", "index.ts"), ALLOWLIST(["plugin:hash-content"]));
      writeFileSync(
        join(root, "electron", "main", "plugin-hash.ts"),
        'export function registerPluginHashIpc(fn) {\n  wrapIpcHandler("plugin:hash-content", async (_e, a) => await fn(a));\n}\n',
      );
      writeFileSync(join(root, "packages", "ui", "probe", "src", "client.ts"), 'export const f = () => invoke("plugin:hash-content", {});\n');
      const { status, out } = run(root);
      // 汇总行里总会出现"无处理器"四个字,所以断言计数为 0,而不是断言文案不出现。
      expect(out).toContain("UI 引用+无处理器 0");
      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allowlist 里被注释掉的通道不算放行(真实缺陷:三个 mcp:config-* 曾整行注释)", () => {
    // 造一个 fixture:通道只出现在注释里,而 UI 在调它 → 必须报"通道不在 allowlist"。
    const root = mkdtempSync(join(tmpdir(), "ipc-stub-gate-"));
    try {
      mkdirSync(join(root, "electron", "main", "ipc"), { recursive: true });
      mkdirSync(join(root, "electron", "preload"), { recursive: true });
      mkdirSync(join(root, "packages", "ui", "probe", "src"), { recursive: true });
      writeFileSync(
        join(root, "electron", "preload", "index.ts"),
        'const allowedInvokeChannels = new Set([\n  "demo:ok",\n  // "mcp:config-read",\n]);\n',
      );
      writeFileSync(join(root, "electron", "main", "ipc", "connectors.ts"), 'wrapIpcHandler("mcp:config-read", async () => await readConfig());\n');
      writeFileSync(join(root, "packages", "ui", "probe", "src", "client.ts"), 'export const f = () => invoke("mcp:config-read", {});\n');
      const { status, out } = run(root);
      expect(status).toBe(1);
      expect(out).toContain("通道不在 allowlist");
      expect(out).toContain("mcp:config-read");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("真实仓库当前是绿的(棘轮:新增一个假成功就红)", () => {
    const { status, out } = run(REPO_ROOT);
    expect(out).toContain("门禁通过");
    expect(status).toBe(0);
  });
});
