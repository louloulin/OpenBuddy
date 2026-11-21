# @openbuddy/chat-core

无 UI 的会话逻辑：回合分组、工具摘要、diff、导出、错误文案等纯函数。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。
当前处于 P1（纯搬迁）：文件原样从旧位置 `git mv` 过来，只改了 import 路径；结构改造在 P2 的 R 项里进行。

会话记录的数据模型在 `src/transcript.ts`，把引擎历史 / 流式事件变成会话记录的纯函数在 `src/transcript-reducer.ts`（R7）；
zustand store 和逐帧批处理留在 `apps/web/src/features/chat/state/session-store.ts`。
