# @openbuddy/client

渲染层客户端：Electron 桥封装（ipc）与按命令封装的 API（agent-client）。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。
当前处于 P1（纯搬迁）：文件原样从旧位置 `git mv` 过来，只改了 import 路径；结构改造在 P2 的 R 项里进行。
