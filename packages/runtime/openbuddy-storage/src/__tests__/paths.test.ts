/**
 * paths.test.ts — agent 根目录的解析与「钉入 pi 环境变量」契约。
 *
 * 为什么值得单测
 * --------------
 * `agentHome()` 本身只是一行表达式,但它决定的是**数据写到哪个目录**。
 * 围绕它有两个真实发生过的故障:
 *
 *   1. `PI_CODING_AGENT_DIR` 没被设置时,pi-coding-agent 的 `getAgentDir()`
 *      会回落到 `~/.pi/agent`(另一个产品的目录)。OpenBuddy 传给
 *      `createAgentSession()` 的 `agentDir` **不会**影响它 —— SDK 只读环境
 *      变量。于是用 `getAgentDir()` 的代码路径(包括在扩展注册期解析目录的
 *      第三方扩展)读写的是错的目录。
 *   2. 一旦我们在启动时补上这个变量,`agent:paths` 的 `fromEnv` 就会恒为
 *      true,界面会一直谎称"用户改过数据目录"。所以必须能区分
 *      "用户设的" 与 "我们补的"。
 *
 * 这两个都是「看起来只是文案、实际是数据落盘」的问题,所以这里既做纯逻辑
 * 断言,也把真实 SDK 拉进来对一次。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentHome,
  agentPath,
  isPiAgentDirPinnedByUs,
  pinPiAgentDirEnv,
  resetPiAgentDirPinForTests,
} from "../paths";

const KEYS = ["OPENBUDDY_AGENT_DIR", "PI_CODING_AGENT_DIR", "PI_HOME"] as const;
let original: Record<string, string | undefined> = {};

beforeEach(() => {
  original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  resetPiAgentDirPinForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  resetPiAgentDirPinForTests();
});

describe("agentHome", () => {
  it("默认是 ~/.openbuddy/agent,不是 ~/.pi/agent", () => {
    const home = agentHome();
    expect(home.endsWith("/.openbuddy/agent")).toBe(true);
    expect(home).not.toMatch(/[\\/]\.pi([\\/]|$)/);
  });

  it("OPENBUDDY_AGENT_DIR 优先于 PI_CODING_AGENT_DIR", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-agent";
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/openbuddy-agent";
    expect(agentHome()).toBe("/tmp/openbuddy-agent");
  });

  it("PI_HOME 只作为前缀,仍然追加 .openbuddy/agent", () => {
    process.env.PI_HOME = "/tmp/pi-home";
    const home = agentHome();
    expect(home).toBe("/tmp/pi-home/.openbuddy/agent");
    expect(home).not.toBe("/tmp/pi-home");
  });

  it("agentPath 拼在 agentHome 之下", () => {
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/ob";
    expect(agentPath("agents", "reviewer.md")).toBe("/tmp/ob/agents/reviewer.md");
  });
});

describe("pinPiAgentDirEnv", () => {
  it("未设置时补成 agentHome,并标记为我们补的", () => {
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/ob-pin";
    expect(isPiAgentDirPinnedByUs()).toBe(false);
    expect(pinPiAgentDirEnv()).toBe(true);
    expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/ob-pin");
    expect(isPiAgentDirPinnedByUs()).toBe(true);
  });

  it("用户已显式设置时不覆盖(那是刻意的覆盖)", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/user-chose-this";
    expect(pinPiAgentDirEnv()).toBe(false);
    expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/user-chose-this");
    // 关键:不算"我们补的",否则 UI 的 fromEnv 判断会错。
    expect(isPiAgentDirPinnedByUs()).toBe(false);
  });

  it("幂等:调用多次结果一致", () => {
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/ob-idem";
    pinPiAgentDirEnv();
    pinPiAgentDirEnv();
    pinPiAgentDirEnv();
    expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/ob-idem");
  });

  it("钉入的值等于 agentHome(),所以 OPENBUDDY_AGENT_DIR 覆盖依然生效", () => {
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/ob-override";
    pinPiAgentDirEnv();
    expect(process.env.PI_CODING_AGENT_DIR).toBe(agentHome());
  });
});

describe("与真实 pi-coding-agent SDK 的一致性", () => {
  it("钉入后 SDK 的 getAgentDir() 指向 OpenBuddy 的根(而不是 ~/.pi/agent)", async () => {
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/ob-sdk-agreement";
    pinPiAgentDirEnv();
    // 直接 import 已安装的 SDK —— 这是"我们算的"与"SDK 算的"唯一权威对照。
    const sdk = await import("@earendil-works/pi-coding-agent");
    expect(typeof sdk.getAgentDir).toBe("function");
    expect(sdk.getAgentDir()).toBe("/tmp/ob-sdk-agreement");
  });

  it("未钉入时 SDK 会回落到 ~/.pi/agent(证明这个变量确实是唯一开关)", async () => {
    const sdk = await import("@earendil-works/pi-coding-agent");
    // 不调 pinPiAgentDirEnv(),且 beforeEach 已清掉环境变量。
    const resolved = sdk.getAgentDir();
    // 只断言"与 OpenBuddy 的默认根不同",不去断言具体的 home 目录名 ——
    // 那取决于跑测试的机器。
    expect(resolved).not.toBe(agentHome());
    expect(resolved).toMatch(/[\\/]\.pi[\\/]agent$/);
  });
});
