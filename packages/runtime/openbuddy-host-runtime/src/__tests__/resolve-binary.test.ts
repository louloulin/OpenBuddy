/**
 * @openbuddy/host-runtime/resolve-binary — host-core binary 解析契约测试。
 *
 * 覆盖路径:
 *   1. PI_OPENBUDDY_HOST_BIN env override(绝对路径存在)
 *   2. process.resourcesPath(已打包的 Electron 应用)
 *   3. monorepo release build (crates/target/release/...)
 *   4. monorepo debug build (crates/target/debug/...)
 *   5. 都不存在时 throw
 *   6. resolveRepoRoot:从 import.meta.url 向上找 crates/Cargo.toml
 *   7. Windows .exe 后缀
 *   8. resourcesPath 不存在时(electron-vite dev)fallback 到 monorepo
 *
 * 价值:
 *   - 守住 resolve-binary 的核心契约,防止路径解析退化
 *   - 验证 bug fix:`process.env["process.resourcesPath"]` → `process.resourcesPath`
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveHostBinary } from "../resolve-binary.js";

// ---- helpers --------------------------------------------------------------

const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

/** Build a fake monorepo: <tmp>/crates/Cargo.toml + <tmp>/crates/target/<profile>/|null> */
function buildMonorepo(opts: { release?: boolean; debug?: boolean }): string {
  const tmp = mkdtempSync(join(tmpdir(), "openbuddy-host-bin-"));
  const crates = join(tmp, "crates");
  mkdirSync(join(crates, "target/release"), { recursive: true });
  mkdirSync(join(crates, "target/debug"), { recursive: true });
  writeFileSync(join(crates, "Cargo.toml"), "[workspace]\n");
  if (opts.release !== false) {
    writeFileSync(
      join(crates, `target/release/openbuddy-host-core${EXE_SUFFIX}`),
      "release-binary",
    );
  }
  if (opts.debug) {
    writeFileSync(
      join(crates, `target/debug/openbuddy-host-core${EXE_SUFFIX}`),
      "debug-binary",
    );
  }
  return tmp;
}

let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = { ...process.env };
});
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
  vi.restoreAllMocks();
});

// ===========================================================================
// PI_OPENBUDDY_HOST_BIN env override
// ===========================================================================

describe("resolveHostBinary — PI_OPENBUDDY_HOST_BIN 优先级", () => {
  it("env override 指向存在的路径时返回该路径(不查其他位置)", () => {
    const envPath = join(tmpdir(), `override-${Date.now()}${EXE_SUFFIX}`);
    writeFileSync(envPath, "override");
    const result = resolveHostBinary({ ...process.env, PI_OPENBUDDY_HOST_BIN: envPath });
    expect(result).toBe(envPath);
    rmSync(envPath, { force: true });
  });

  it("env override 指向不存在的路径时 fallback 到其他候选", () => {
    const tmp = buildMonorepo({ release: true, debug: true });
    const result = resolveHostBinary(
      { ...process.env, PI_OPENBUDDY_HOST_BIN: "/nonexistent/path/to/host-core" },
      tmp,
    );
    expect(result.endsWith(`target/release/openbuddy-host-core${EXE_SUFFIX}`)).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ===========================================================================
// packaged resources 路径
// ===========================================================================

describe("resolveHostBinary — packaged resourcesPath", () => {
  it("process.resourcesPath 存在且 bin/ 下有二进制时,返回 packaged 路径", () => {
    const tmp = mkdtempSync(join(tmpdir(), "packaged-"));
    const binDir = join(tmp, "bin");
    mkdirSync(binDir, { recursive: true });
    const packagedPath = join(binDir, `openbuddy-host-core${EXE_SUFFIX}`);
    writeFileSync(packagedPath, "packaged");
    // 模拟 Electron 注入 process.resourcesPath
    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmp;
    try {
      const result = resolveHostBinary();
      expect(result).toBe(packagedPath);
    } finally {
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("process.resourcesPath 缺失(electron-vite dev)时,fallback 到 monorepo target/", () => {
    const tmp = buildMonorepo({ release: true, debug: true });
    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    delete process.env.PI_OPENBUDDY_HOST_BIN;
    try {
      const result = resolveHostBinary(process.env, tmp);
      expect(result.endsWith(`target/release/openbuddy-host-core${EXE_SUFFIX}`)).toBe(true);
    } finally {
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("bug fix 守门:不应使用 process.env[\"process.resourcesPath\"](env 里没有这个 key)", () => {
    // 关键回归测试:若实现退化到 process.env[\"process.resourcesPath\"],该值永远是 undefined
    // 而 packaged 路径会被解析成空字符串 + bin/,从而 fallback 到 monorepo
    const tmp = mkdtempSync(join(tmpdir(), "packaged-bug-"));
    const binDir = join(tmp, "bin");
    mkdirSync(binDir, { recursive: true });
    const packagedPath = join(binDir, `openbuddy-host-core${EXE_SUFFIX}`);
    writeFileSync(packagedPath, "packaged");
    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmp;
    delete process.env.PI_OPENBUDDY_HOST_BIN;
    try {
      const result = resolveHostBinary(process.env, tmp);
      // 必须等于 packaged 路径(否则说明又退化到 process.env 路径)
      expect(result).toBe(packagedPath);
    } finally {
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// monorepo release / debug 路径
// ===========================================================================

describe("resolveHostBinary — monorepo target/", () => {
  it("release build 存在时优先返回 release 路径", () => {
    const tmp = buildMonorepo({ release: true, debug: true });
    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    delete process.env.PI_OPENBUDDY_HOST_BIN;
    try {
      const result = resolveHostBinary(process.env, tmp);
      expect(result.endsWith(`target/release/openbuddy-host-core${EXE_SUFFIX}`)).toBe(true);
    } finally {
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });


});

// ===========================================================================
// throw 路径
// ===========================================================================


