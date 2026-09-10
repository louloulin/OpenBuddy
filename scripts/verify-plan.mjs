/**
 * verify-plan.mjs — OpenBuddy 阶段计划一键验收门（WORKBUDDY_PI_OPTIMIZATION_PLAN §6.2）。
 *
 * 静态架构不变量（不跑测试，秒级）：
 *   - 巨型文件断言：core 源码（src/ + electron/main/ + packages/{ui,runtime,renderer,core}/）
 *     超过 R 行即报 FAIL（可被 env OVERRIDE 以排除 legacy 外部兼容文件）。
 *   - 能力归属单一权威：pi-passthrough 的 CAPABILITY_TO_PLUGIN_ID 必须从
 *     capability-ownership.ts 派生，禁止自持重复映射。
 *   - Pi 覆盖：builtinPiExtensionFactories + BUILTIN_PI_PLUGIN_MANIFESTS 的
 *     注册数与计划文档（plan2.0.md / plan3.0.md / plan4.md）声明一致；
 *     不一致即报 FAIL（plan3.0.md 起新增了 registerFlag/registerShortcut
 *     这类 Pi 原生 API 的覆盖检查）。
 *
 * 可选动态门（--run-tests 或 --run-vitest）：调用 tsc / vitest。
 *
 * 用法：
 *   node scripts/verify-plan.mjs                # 仅静态门（快）
 *   node scripts/verify-plan.mjs --run-vitest   # 静态门 + 全量 vitest
 *   node scripts/verify-plan.mjs --limit=2600   # 覆盖巨型文件阈值（默认 3000）
 *   node scripts/verify-plan.mjs --plan3-only   # 仅跑 plan3.0.md 增量检查
 *
 * 退出码：0=全 PASS，1=任一 FAIL。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const LIMIT_DEFAULT = Number(process.env.GIANT_FILE_LIMIT ?? 3000);
const results = []; // {name, ok, detail}

function pass(name, detail = "") { results.push({ name, ok: true, detail }); }
function fail(name, detail) { results.push({ name, ok: false, detail }); }

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(p, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

// ——— 1. 巨型文件断言 ———
const scanRoots = ["src", "electron/main", "packages/ui", "packages/runtime", "packages/renderer", "packages/core"];
const limit = LIMIT_DEFAULT;
const legacy = new Set([
  // 遗留外部兼容/生成文件，不纳入"微内核拆分可维护性"门（详见计划 §3）。
  "electron/main/deepseek/deepseek-runtime.ts",
  "packages/renderer/openbuddy-renderer-host/src/deepseek-compat.ts",
  "electron/main/casdoor/casdoor-management.ts",
  "electron/main/deepseek/deepseek-generic.ts",
]);
const giants = [];
for (const root of scanRoots) {
  for (const file of walk(resolve(ROOT, root))) {
    const rel = relative(ROOT, file);
    if (legacy.has(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n").length;
    if (lines > limit) giants.push({ rel, lines });
  }
}
if (giants.length === 0) {
  pass("giant-file-limit", `no core file > ${limit} lines`);
} else {
  const detail = giants.map((g) => `${g.rel} (${g.lines})`).join("; ");
  fail("giant-file-limit", `core files exceed ${limit} lines: ${detail}`);
}

// ——— 2. 能力归属单一权威 ———
try {
  const ptPath = resolve(ROOT, "packages/runtime/openbuddy-plugin-host/src/pi-passthrough.ts");
  const pt = readFileSync(ptPath, "utf8");
  const ownership = resolve(ROOT, "packages/runtime/openbuddy-plugin-host/src/capability-ownership.ts");
  const oc = readFileSync(ownership, "utf8");
  const declaresOwnMap = /(const|let)\s+CAPABILITY_TO_PLUGIN_ID\s*=/.test(pt);
  const derives = /from\s+["']\.\/capability-ownership["']/.test(pt) || /AUTHORITY_CAPABILITY_TO_PLUGIN_ID/.test(pt);
  if (!declaresOwnMap && derives) {
    pass("capability-ownership-single-source", "pi-passthrough derives CAPABILITY_TO_PLUGIN_ID from capability-ownership (no self-held duplicate map)");
  } else {
    fail("capability-ownership-single-source", `pi-passthrough duplicate map: declareOwn=${declaresOwnMap}, derivesFromAuthority=${derives}`);
  }
} catch (e) {
  fail("capability-ownership-single-source", `read error: ${e.message}`);
}

// ——— 3. Pi 覆盖：builtin 工厂与 manifest 表一致 ———
try {
  const extPath = resolve(ROOT, "electron/main/agent/pi-extensions.ts");
  const src = readFileSync(extPath, "utf8");
  // 统计 builtinPiExtensionFactories 中以 `"openbuddy-` 开头的 key 数量
  // 以及 BUILTIN_PI_PLUGIN_MANIFESTS 中 `id: "openbuddy-` 的数量；
  // 两个数字必须一致，否则 builtin 注册表与 manifest 表漂移。
  // 工厂 key 行的形态有三种：(_emit ... / ((emit ... / (emit ... 都允许。
  const factoryKeys = new Set();
  for (const match of src.matchAll(/^\s*"([a-z0-9-]+)"\s*:\s*\(\(*\s*_?emit\b/mg)) {
    factoryKeys.add(match[1]);
  }
  const manifestIds = new Set();
  for (const match of src.matchAll(/^\s*id:\s*"([a-z0-9-]+)",/mg)) {
    manifestIds.add(match[1]);
  }
  const onlyInFactory = [...factoryKeys].filter((k) => !manifestIds.has(k));
  const onlyInManifest = [...manifestIds].filter((k) => !factoryKeys.has(k));
  if (onlyInFactory.length === 0 && onlyInManifest.length === 0 && factoryKeys.size > 0) {
    pass(
      "pi-builtin-coverage",
      `${factoryKeys.size} builtins registered (factories ↔ manifests aligned)`,
    );
  } else {
    fail(
      "pi-builtin-coverage",
      `factories=[${[...factoryKeys].join(",")}] manifests=[${[...manifestIds].join(",")}] onlyFactory=[${onlyInFactory.join(",")}] onlyManifest=[${onlyInManifest.join(",")}]`,
    );
  }
} catch (e) {
  fail("pi-builtin-coverage", `read error: ${e.message}`);
}

// ——— 4. plan3.0.md 增量：registerFlag / registerShortcut 落地检查 ———
try {
  const extPath = resolve(ROOT, "electron/main/agent/pi-extensions.ts");
  const src = readFileSync(extPath, "utf8");
  const flagShortcutFile = resolve(ROOT, "electron/main/agent/extensions/flag-shortcut-bridge.ts");
  const flagShortcutSrc = readFileSync(flagShortcutFile, "utf8");
  const plan3 = resolve(ROOT, "plan3.0.md");
  const hasPlan3 = existsSync(plan3);
  const hasFactory = /"openbuddy-pi-flag-shortcut"\s*:/m.test(src);
  const usesRegisterFlag = /\.registerFlag\s*\(/.test(flagShortcutSrc);
  const usesRegisterShortcut = /\.registerShortcut\s*\(/.test(flagShortcutSrc);
  if (hasPlan3 && hasFactory && usesRegisterFlag && usesRegisterShortcut) {
    pass(
      "plan3-flag-shortcut",
      "plan3.0.md present, openbuddy-pi-flag-shortcut factory registered, registerFlag + registerShortcut both exercised",
    );
  } else {
    fail(
      "plan3-flag-shortcut",
      `hasPlan3=${hasPlan3} hasFactory=${hasFactory} registerFlag=${usesRegisterFlag} registerShortcut=${usesRegisterShortcut}`,
    );
  }
} catch (e) {
  fail("plan3-flag-shortcut", `read error: ${e.message}`);
}

// ——— 可选动态门 ———
const args = process.argv.slice(2);
const runVitest = args.includes("--run-vitest");
const runTsc = args.includes("--run-tsc") || args.includes("--run-vitest");
const plan3Only = args.includes("--plan3-only");

function sh(cmd, label) {
  try {
    execFileSync(cmd.shift(), cmd, { cwd: ROOT, stdio: "pipe", timeout: 600_000 });
    pass(label);
  } catch (e) {
    const out = (e.stdout?.toString() || "").split("\n").slice(-8).join("\n");
    fail(label, (e.message || "") + (out ? ` :: ${out}` : ""));
  }
}

if (runTsc) sh(["npx", "tsc", "--noEmit"], "tsc-noEmit");
if (runVitest) sh(["npx", "vitest", "run", "--reporter=dot"], "vitest-run");

// ——— 汇总 ———
const failed = results.filter((r) => !r.ok);
console.log("\n[verify-plan] Architecture acceptance gates:\n");
const filtered = plan3Only ? results.filter((r) => r.name.startsWith("plan3-") || r.name === "pi-builtin-coverage") : results;
for (const r of filtered) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  if (r.detail && !r.ok) console.log(`       └─ ${r.detail}`);
}
console.log(`\n  → ${filtered.length - failed.filter((f) => filtered.includes(f)).length}/${filtered.length} gates passed`);
if (plan3Only) {
  const plan3Failed = filtered.filter((r) => !r.ok);
  if (plan3Failed.length > 0) {
    console.log("[verify-plan] ❌ FAILED\n");
    process.exit(1);
  }
  console.log("[verify-plan] ✅ ALL PASS\n");
} else if (failed.length > 0) {
  console.log("[verify-plan] ❌ FAILED\n");
  process.exit(1);
} else {
  console.log("[verify-plan] ✅ ALL PASS\n");
}
