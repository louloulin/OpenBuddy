# @openbuddy/host

宿主命令路由：命令处理器装配、文件/工作区授权。与传输无关，不依赖 electron。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。
当前处于 P1（纯搬迁）：文件原样从旧位置 `git mv` 过来，只改了 import 路径；结构改造在 P2 的 R 项里进行。
