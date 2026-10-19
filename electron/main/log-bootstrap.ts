/**
 * log-bootstrap.ts — 主进程日志默认落盘注入(P0.7,生产评审 §6.2)。
 *
 * **必须是 electron/main/index.ts 的第一个 import**:ES 模块按声明顺序求值,
 * 依赖模块(如 ipc/_wrap)在自己的模块顶层就 createMainLogger —— 默认路径
 * 必须在它们求值前注入,否则那些 logger 只有 stdout(打包后失败零痕迹)。
 *
 * app.getPath("logs") 在 ready 之前可用;任何失败降级为不落盘(不能让日志
 * 配置炸掉启动)。
 */
import { app } from "electron";
import { join } from "node:path";

import { setDefaultLogFile } from "@openbuddy/logging-main";

try {
  const logsDir = app.getPath("logs");
  setDefaultLogFile(join(logsDir, "openbuddy.log"));
} catch (error) {
  setDefaultLogFile(null);
  console.error("[log-bootstrap] failed to resolve logs dir:", error);
}
