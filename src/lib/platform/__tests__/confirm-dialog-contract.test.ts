/**
 * 确认框契约 —— 「问过了」必须真的等答案 + 全仓不许再有原生模态框。
 *
 * 为什么值得单独立一条 spec:
 *   `confirm()` 早在 R15 就从原生 `dialog.showMessageBox` 迁到了 workbuddy 风格
 *   的 `ConfirmDialog`(异步,返回 Promise<boolean>)。迁移时**漏了 `await`** 的
 *   调用点不会报错、不会崩,而是安静地变成:
 *
 *     if (!confirm("清空本地审计日志？此操作不可撤销")) return;   // 永远不为真
 *
 *   Promise 恒为真值 → `!confirm(...)` 恒为 false → **确认框弹出的同时,
 *   "不可撤销"的操作已经执行完了**。用户看到弹窗时事情已经发生,点"取消"
 *   也没有任何作用(甚至会让弹窗自己 resolve 掉)。这比"点不动"更糟:它把
 *   一个安全门做成了装饰品。
 *
 *   （同一个仓库里的 `SessionManagementPanel` / `ResourceCatalogPanel` 则是漏
 *   了迁移,直接用**原生** `window.confirm` —— 系统模态框阻断渲染进程、字体与
 *   配色都不属于 OpenBuddy。）
 *
 * 所以这里做两件事:
 *   1. 把行为钉死:`confirm()` 走全局 store,用户点确定/取消才 resolve;
 *   2. 全仓守卫:不许原生 `alert()/prompt()/confirm()`,且每次 `confirm(`
 *      调用都必须是被 `await` 的。
 */
// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { useGlobalConfirmStore } from "@/stores/global-confirm-store";

type StubBridge = { apiVersion: 1 } & Record<string, unknown>;

const stubApi: StubBridge = {
  apiVersion: 1,
  invoke: async () => undefined,
  rpc: { request: async () => undefined, onMessage: () => () => void 0 },
  events: { on: () => () => void 0 },
  dialog: { open: async () => [], save: async () => null },
  window: {
    label: () => "main",
    minimize: async () => void 0,
    toggleMaximize: async () => void 0,
    close: async () => void 0,
    isMaximized: async () => false,
    onResized: async () => () => void 0,
  },
  webview: { label: () => "", onDragDropEvent: async () => () => void 0 },
  debug: { enabled: false },
  clipboard: { readText: async () => "", writeText: async () => void 0 },
};

/** 打开一个确认框并等它真的注册进 store(confirm 内部是异步取 store 的)。 */
/**
 * 打开一个确认框并等它真的注册进 store(`confirm` 内部是异步取 store 的),
 * 再把"待答复的 Promise"交回调用方。
 *
 * 注意返回的是**包装对象**而不是 Promise 本身:async 函数直接 `return answer`
 * 会把外层 await 变成"等用户答复",测试就会永远挂住(第一版就是这么写的)。
 */
async function startConfirm(message: string, options?: Parameters<typeof import("../electron-api")["confirm"]>[1]) {
  const { confirm } = await import("../electron-api");
  const answer = confirm(message, options);
  // 等到这一条**真的**成为当前待答复项(不能只等"有 pending":并发用例里
  // 前一条还在,`!pending` 立刻为假,断言就会读到上一条)。
  const expectedTitle = message.trim() || "确认";
  for (let i = 0; i < 40 && pending()?.title !== expectedTitle; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { answer };
}

const pending = () => useGlobalConfirmStore.getState().pending;
const answerWith = (value: boolean) => useGlobalConfirmStore.getState().resolve(pending()!.id, value);

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = { api: stubApi };
  useGlobalConfirmStore.getState().dismiss();
});

describe("confirm():异步契约与全局 store 路由", () => {
  it("返回 Promise,在用户答复前不 resolve", async () => {
    const { answer: pendingAnswer } = await startConfirm("清空本地审计日志？", { tone: "danger" });
    expect(pending()?.title).toBe("清空本地审计日志？");
    expect(pending()?.tone).toBe("danger");

    answerWith(false);
    await expect(pendingAnswer).resolves.toBe(false);
  });

  it("用户点确定 → true;点取消 → false(而不是恒真)", async () => {
    const { answer: yes } = await startConfirm("删除？");
    answerWith(true);
    await expect(yes).resolves.toBe(true);

    const { answer: no } = await startConfirm("删除？");
    answerWith(false);
    await expect(no).resolves.toBe(false);
  });

  it("空标题被兜底成「确认」,并且不返回 Promise 以外的形状", async () => {
    const { answer } = await startConfirm("   ");
    expect(pending()?.title).toBe("确认");
    answerWith(false);
    await expect(answer).resolves.toBe(false);
  });

  it("并发请求不会把前一个调用者永久挂住(后到者顶掉前者的等待)", async () => {
    const { answer: first } = await startConfirm("第一个");
    const { answer: second } = await startConfirm("第二个");
    expect(pending()?.title).toBe("第二个");
    await expect(first).resolves.toBe(false);
    answerWith(true);
    await expect(second).resolves.toBe(true);
  });
});

// ─── 全仓守卫:原生模态框清零 + confirm 必须 await ───────────────────────────

const ROOTS = ["src", "packages/ui"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist", "out", ".turbo"]);
const ELECTRON_API = join("src", "lib", "platform", "electron-api.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** 去掉注释,避免文档里解释"什么是原生 confirm"本身被当成违规。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:/])\/\/[^\n]*/g, "$1");
}

const sourceFiles = ROOTS.flatMap((root) => walk(root));
const sourceText = new Map(sourceFiles.map((file) => [file, stripComments(readFileSync(file, "utf8"))]));

describe("原生模态框的全仓守卫", () => {
  it("扫描面不为空(守卫本身有意义)", () => {
    expect(sourceFiles.length).toBeGreaterThan(200);
  });

  it("没有文件再用原生 `alert()`(统一走 toast)", () => {
    const offenders = [...sourceText.entries()]
      .filter(([, text]) => /(^|[^\w.$])alert\s*\(/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("没有文件再用原生 `prompt()`", () => {
    const offenders = [...sourceText.entries()]
      .filter(([, text]) => /(^|[^\w.$])prompt\s*\(/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("每个 `confirm(` 都来自包装层(不许用全局 window.confirm)", () => {
    const offenders = [...sourceText.entries()]
      .filter(([file, text]) => {
        if (file.endsWith(ELECTRON_API)) return false; // 包装层自身
        if (!/(^|[^\w.$])confirm\s*\(/.test(text)) return false;
        return !/import\s*\{[^}]*\bconfirm\b[^}]*\}\s*from\s*"@\/lib\/platform\/electron-api"/.test(
          readFileSync(file, "utf8"),
        );
      })
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("每个 `confirm(` 调用点都被 await(R40 之前的漏 await 是安全门漏洞)", () => {
    const offenders: string[] = [];
    for (const [file, text] of sourceText.entries()) {
      if (file.endsWith(ELECTRON_API)) continue;
      for (const match of text.matchAll(/(^|[^\w.$])confirm\s*\(/g)) {
        const before = text.slice(Math.max(0, match.index - 6), match.index + match[1].length);
        // 合法写法只允许 `await confirm(`:漏 await 会让 `!confirm(...)` 恒假,
        // 也就是"确认框在,但门是开着的"。
        if (!/\bawait\s*$/.test(before)) {
          offenders.push(`${file}: ...${text.slice(Math.max(0, match.index - 40), match.index + 20).trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
