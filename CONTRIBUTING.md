# 参与共建 OpenBuddy

谢谢你想让更多人拥有自己的 Buddy。这个项目是 MIT 许可的，贡献可以很小：改一句话、补一张截图、加一个 Buddy 模板，都算。

## 先了解边界

- README 是**产品入口**：首屏讲清价值主张、60 秒上手、截图和构建状态。
- [功能状态总表](docs/FEATURE-STATUS.md) 是**功能事实的唯一来源**。不要在其他文档里另立一套"支持 / 不支持"的口径；改状态请先改这张表。
- [技术架构与验证](docs/architecture.md) 承载实现细节；README 保持产品优先。

## 开发环境

```sh
pnpm install --frozen-lockfile
pnpm dev:electron          # 需要原生能力时用这个，不是 pnpm dev
pnpm test
pnpm check:docs
pnpm audit:ipc
```

改动主进程或 preload 后要重启 `dev:electron`。`pnpm dev` 只是浏览器预览，没有宿主能力，功能入口会隐藏——这是设计如此。

## 提交前检查

```sh
pnpm typecheck
pnpm check:boundaries
pnpm check:docs
pnpm audit:ipc
pnpm build:electron
pnpm test:electron-ui      # 真实 Electron 走查（本地 fixture）
```

依赖方向由 `tools/check-boundaries.mjs` 约束；Electron 专属 API 只能放在 `apps/desktop`。

## 适合上手的贡献

| 类型 | 从哪里开始 |
| :--- | :--- |
| 文档 | 修正 [用户手册](docs/user-guide.md)、[FAQ](docs/faq.md) 的过期表述；补充英文文档 |
| 截图 / 演示 | 按 `pnpm verify:e2e` 的产物更新 `docs/screenshots/`；`pnpm demo:gif` 重新录制 README 首屏的 36 秒演示 GIF（真实 Electron + 本地 fixture） |
| Buddy 模板 | 按 [产品主张](docs/VISION.md) 的"记忆 / 人格 / 手脚 / 自主 / 边界"五部分组织专家包与技能 |
| 国际化 | README.en.md 与各文档页；保持与中文版一致的功能口径 |
| 代码 | 先看 [架构说明](docs/architecture.md) 的分层与各包 README，再认领 `good first issue` |

## 写文档的三条规矩

1. **先链接事实来源**：涉及"能不能用"的表述，链接到 [功能状态总表](docs/FEATURE-STATUS.md)。
2. **不夸大构建状态**：当前是未签名预览版，不写"正式发布 / 已公证 / 开箱即用"。
3. **截图注明来源**：演示截图来自本地 fixture，不包装成真实用户数据。

## 提交与讨论

- 问题与建议：[Issues](https://github.com/louloulin/OpenBuddy/issues)
- 传播与产品思路：[增长与传播计划](docs/GROWTH.md)
- 产品方向：[让每个人都能拥有自己的 Buddy](docs/VISION.md)

提交 PR 时请说明：改了什么、跑过哪些检查、有没有改变功能状态口径。
