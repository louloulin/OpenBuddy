# 发布操作手册（RELEASE.md）

> 本文是发布 OpenBuddy 桌面版的**唯一操作手册**。目标是：任何人在 main 干净的状态下按本文操作，能在 1 小时内产出一个可安装、可自动更新的三平台 Release。

## 前置检查（一次性/每次都要）

| 项 | 要求 | 检查方式 |
|---|---|---|
| 分支 | feature 分支已全部合入 `main`，`main` 上 `pnpm run build` + `vitest run` 全绿 | 本地 checkout main 跑一遍 |
| 版本号 | `package.json` version 与本次发布语义一致 | `node scripts/bump-version.mjs version:current` |
| 密钥历史 | 无未处置的泄漏密钥（泄漏 = 必须先在服务端轮换） | `git log --all -S "sk-"` 复核；泄漏处置模板见本文末尾 |
| CI | push main 后 ci.yml 六个 job 全绿 | GitHub Actions 页面 |

## 发布步骤

1. **合并与版本**
   ```bash
   git checkout main && git pull
   git merge --no-ff feature/pre   # 或直接在 main 上 squash 合并 PR
   node scripts/bump-version.mjs version:bump   # patch/minor 按语义
   git commit -am "chore(release): v$(node -p "require('./package.json').version")"
   ```

2. **打 tag 触发构建**
   ```bash
   git tag "v$(node -p "require('./package.json').version")"
   git push origin main --tags
   ```
   `release.yml` 会自动：typecheck + build → 三平台（mac dmg x64+arm64 / win NSIS / linux AppImage）构建 → upload-artifact → `publish-release` job 创建 GitHub Release 并上传全部安装包。

3. **签名要求**（构建 job 会自行校验，缺凭据的 job 会失败而不是产出坏包）：
   - macOS：secrets `MACOS_CSC_LINK_BASE64` + `MACOS_CSC_KEY_PASSWORD`（Developer ID .p12）与 `MACOS_API_*` 三件套（notarize .p8）。entitlements 已内置（`build/entitlements.mac.plist`）。
   - **无 Apple 证书时的 Preview 通道**：本地跑 `moon run electron.build.mac.dir`（`CSC_IDENTITY_AUTO_DISCOVERY=false`，ad-hoc），产物仅限内测分发——用户首次打开需右键 → 打开。**不要**把无签名/未公证的包挂到正式 Release 里冒充稳定版。
   - Windows：当前无代码签名 secret（如需 SmartScreen 降噪，接 EV 证书后再开）。

4. **发布后验证**（缺一不可）：
   - Release 页面三平台安装包齐全，`latest-mac.yml` / `latest.yml` 存在（自动更新的 feed）。
   - 下载 macOS 包 → 安装 → 启动 → 设置 → 关于 → 「检查更新」能返回"已是最新版本"（证明 app-update.yml feed 链路通）。
   - 从上一个版本升级安装（不是全新装），确认用户数据（会话/模型配置）保留。

## 自动更新说明

- `electron-updater` 读打包时生成的 `app-update.yml`（GitHub Releases provider）。
- 策略：`autoDownload=false`（发现更新不自动下载）+ `autoInstallOnAppQuit=true`（下载后下次退出安装）。
- 渲染端入口：设置 → 关于 → 「检查更新」；状态机 idle/checking/available/downloading/downloaded/error。
- 事件通道：`app:auto-update-{available,progress,downloaded,state}`（preload 已放行）。

## 密钥泄漏处置模板

1. 服务端**先轮换/吊销**（泄漏即视为已失陷，删 commit 不等于撤销）。
2. 从工作树清除明文（grep `sk-`/`AKIA`/`BEGIN PRIVATE KEY` 复核）。
3. 文档中替换为占位并加"已泄漏已轮换"标注（参考 `docs/enterprise-live-verification-2026-08-31.md` 顶部的事故记录格式）。
4. git 历史里的明文：若仓库公开且密钥未轮换，需用 `git filter-repo` 重写历史并 force-push（破坏性操作，需团队同步）。
