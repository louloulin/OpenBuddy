# vendor/upup

内置应用源目录（2026-11-27）。打包时由 `electron-builder.yml` 的 `extraResources` 复制到
`<App>.app/Contents/Resources/upup`；运行时会话通过 `apps_bundled_source` 发现它，
用户在「更多 → 应用」里点「安装内置应用」即可装进 agentDir（无需联网）。

**开发态**：把 UpUp 仓库放到这里（保留 `node_modules/@upup/*` 工作区链接）：

```bash
pnpm bundle:upup              # 默认从 ~/stock/upup 复制
UPUP_REPO=/path/to/upup pnpm bundle:upup
pnpm bundle:upup --clean      # 先清空再复制
```

目录为空（只有这个 README）时，`apps_bundled_source` 返回 `exists:false`，界面不显示安装入口。
不要提交真实内容到 git（`.gitignore` 已排除）。
