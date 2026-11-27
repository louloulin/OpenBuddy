// @vitest-environment node
/**
 * 安装来源记录与回滚的真实链路 (2026-11-27 U6)。
 *
 *   OPENBUDDY_ROLLBACK=1 npx vitest run packages/host/test/apps-rollback.integration.test.ts
 *
 * 本地起一个 `git daemon` 当远端（`git://127.0.0.1:PORT/repo.git`，Pi 原生支持）：
 * v1.0.0 安装 → 推送 v1.1.0 后 `apps_update`（previous=v1.0.0）→ `apps_rollback`
 * 按记录的 commit 重装 → 版本回到 v1.0.0。需要本机 git，默认跳过。
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const enabled = process.env.OPENBUDDY_ROLLBACK === "1";
const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/**
 * 最小的 Git smart HTTP 服务（`git http-backend` + Node HTTP）。
 * Pi 不接受 `git://` 协议源，但接受 `http://`，这样就能在本地完整走安装/更新/回滚。
 */
function gitHttpServer(root: string) {
  const server = createServer((req, res) => {
    const [path, query = ""] = (req.url ?? "/").split("?");
    const child = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: path,
        QUERY_STRING: query,
        REQUEST_METHOD: req.method ?? "GET",
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        CONTENT_LENGTH: req.headers["content-length"] ?? "",
        REMOTE_ADDR: "127.0.0.1",
        REMOTE_USER: "",
        GATEWAY_INTERFACE: "CGI/1.1",
        SERVER_PROTOCOL: "HTTP/1.1",
      },
    });
    let head = Buffer.alloc(0);
    let sent = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (sent) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const split = head.indexOf("\r\n\r\n");
      if (split < 0) return;
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of head.subarray(0, split).toString("utf8").split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === "status") status = Number(value.split(" ")[0]) || 200;
        else headers[key] = value;
      }
      res.writeHead(status, headers);
      const body = head.subarray(split + 4);
      if (body.length) res.write(body);
      sent = true;
    });
    child.stderr.on("data", () => {});
    child.on("close", () => res.end());
    req.pipe(child.stdin);
  });
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** 工作仓库 + 裸仓库 + 本地 HTTP 服务；返回 clone 源与提交 sha。 */
async function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "ob-rollback-"));
  dirs.push(root);
  const work = join(root, "work");
  // Pi 要求 git 源路径至少两段（group/repo）；裸仓库放一层子目录。
  const bare = join(root, "group", "repo.git");
  mkdirSync(join(root, "group"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  git(work, "config", "user.email", "test@openbuddy.local");
  git(work, "config", "user.name", "OpenBuddy Test");
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "fixture-app", version: "1.0.0" }));
  git(work, "add", ".");
  git(work, "commit", "-qm", "v1.0.0");
  const v1 = git(work, "rev-parse", "HEAD");
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);
  git(bare, "symbolic-ref", "HEAD", "refs/heads/main");

  const base = await gitHttpServer(root);
  return { work, bare, source: `${base}/group/repo.git`, v1 };
}

async function host() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-rollback-"));
  dirs.push(root);
  const safe = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  };
  return createEngineHandlers({
    userDataDir: root,
    safeStorage: safe,
    emit: () => {},
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
  });
}

interface InstallState {
  current: { version?: string; commit?: string };
  previous?: { version?: string; commit?: string };
}

describe.skipIf(!enabled)("安装来源记录与回滚 (U6)", () => {
  it("更新记录上一份，回滚按 commit 重装回旧版本", { timeout: 300_000 }, async () => {
    const { work, bare, source, v1 } = await fixtureRepo();
    const app = await host();

    const installed = (await app.handlers.apps_ensure_default({ source })) as { installed: boolean; error?: string };
    expect(installed.installed, installed.error).toBe(true);

    // 上游发布 v1.1.0。
    writeFileSync(join(work, "package.json"), JSON.stringify({ name: "fixture-app", version: "1.1.0" }));
    git(work, "commit", "-qam", "v1.1.0");
    const v2 = git(work, "rev-parse", "HEAD");
    git(work, "push", "-q", "--all", bare);

    const updated = (await app.handlers.apps_update({ packageSource: source })) as {
      install: { version?: string; commit?: string } | null;
      canRollback: boolean;
    };
    console.log("ROLLBACK_UPDATE", JSON.stringify(updated));
    expect(updated.install?.version).toBe("1.1.0");
    expect(updated.install?.commit).toBe(v2);
    expect(updated.canRollback).toBe(true);

    const rollback = (await app.handlers.apps_rollback({ packageSource: source })) as { rolledBackTo: string };
    console.log("ROLLBACK_RESULT", JSON.stringify(rollback));
    expect(rollback.rolledBackTo).toBe(`${source}@${v1}`);

    const state = (await app.handlers.apps_install_state({})) as Record<string, InstallState>;
    const history = state[source];
    console.log("ROLLBACK_STATE", JSON.stringify(history));
    expect(history?.current.version).toBe("1.0.0");
    expect(history?.current.commit).toBe(v1);
    expect(history?.previous).toBeUndefined();
  });
});
