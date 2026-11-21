# @openbuddy/engine

Pi 引擎：会话池、事件管线、权限、扩展 UI 桥、检查点、产物。不依赖 electron。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。
当前处于 P1（纯搬迁）：文件原样从旧位置 `git mv` 过来，只改了 import 路径；结构改造在 P2 的 R 项里进行。
