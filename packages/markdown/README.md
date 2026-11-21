# @openbuddy/markdown

Markdown 渲染：react-markdown 管线、remark/rehype 插件、代码块、mermaid/katex。

分层与依赖规则见 `docs/plan/20261115-md.md` §5.2，由 `tools/check-boundaries.mjs` 检查。
当前处于 P1（纯搬迁）：文件原样从旧位置 `git mv` 过来，只改了 import 路径；结构改造在 P2 的 R 项里进行。

宿主能力（复制、打开链接 / 本地路径、读写文件、对话框）经 `src/host.tsx` 的 `MarkdownHost` 注入（R6）：
应用用 `<MarkdownHostProvider host={…}>` 安装（web 的实现在 `apps/web/src/shared/markdown-host.ts`），
包内代码不 import client、platform 或应用代码。
