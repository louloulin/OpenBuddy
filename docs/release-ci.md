# OpenBuddy Release CI 矩阵

> 更新时间:2026-08-31
> 范围:`.github/workflows/release.yml`、`electron-builder.yml`、moon 单仓多包构建
> 目的:把当前散落的 Windows / macOS / Linux / 公证 / 签名步骤固化成单一事实源

## 1. 流水线概览

| Job | Runner | 触发条件 | 产物 | 关键 Secrets |
| --- | --- | --- | --- | --- |
| `ci` | ubuntu-latest | tag `v*` 或 workflow_dispatch | (无产物) | — |
| `build-windows` | windows-latest | `ci` 完成 | NSIS `.exe` (x64) | — |
| `build-macos` | macos-latest | `ci` 完成 | DMG (x64 + arm64),已签名 + notarized | `MACOS_CSC_LINK_BASE64`、`MACOS_CSC_KEY_PASSWORD`、`MACOS_API_KEY_BASE64`、`MACOS_API_KEY_ID`、`MACOS_API_ISSUER` |
| `build-linux` | ubuntu-latest | `ci` 完成 | AppImage (x64) | — |
| `publish-release` | ubuntu-latest | `build-windows`、`build-macos`、`build-linux` 全部完成 | GitHub Release(Windows / macOS / Linux 产物) | `GITHUB_TOKEN` |

## 2. macOS 签名 / 公证凭据矩阵

| Secret 名 | 内容 | 来源 |
| --- | --- | --- |
| `MACOS_CSC_LINK_BASE64` | base64 编码的 `.p12` Developer ID Application 证书 | Apple Developer Portal → Certificates → Developer ID Application |
| `MACOS_CSC_KEY_PASSWORD` | `.p12` 文件口令 | 证书创建时由用户设置 |
| `MACOS_API_KEY_BASE64` | base64 编码的 App Store Connect API `.p8` 私钥 | App Store Connect → Users → Keys → Generate |
| `MACOS_API_KEY_ID` | API Key ID(10 位字符) | 同上 |
| `MACOS_API_ISSUER` | Issuer ID(UUID) | App Store Connect → Users → Keys |

### 2.1 初始化脚本位置

凭据导入脚本位于 `release.yml:113-150`,顺序:

1. 解码 `MACOS_CSC_LINK_BASE64` → `$RUNNER_TEMP/developer-id-application.p12`
2. 设置 `CSC_LINK` 与 `CSC_KEY_PASSWORD`
3. 解码 `MACOS_API_KEY_BASE64` → `$RUNNER_TEMP/AuthKey_<id>.p8`
4. 设置 `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`
5. 调用 `pnpm electron:release:mac`(等同 `moon run openbuddy:electron.build.mac`)
6. electron-builder 自动检测 `CSC_LINK` → 签名,检测 `APPLE_API_KEY*` → notarize

### 2.2 失败时排错

| 错误码 | 可能原因 | 下一步 |
| --- | --- | --- |
| `electron-builder` 报 `code signing failed` | `MACOS_CSC_LINK_BASE64` 解码失败 / 证书过期 | 用 `base64 -d` 本地验证;检查 Apple Developer Portal 的证书状态 |
| `notarytool` 报 `authentication failed` | `MACOS_API_KEY_ID` / `MACOS_API_ISSUER` 错配 | 在 App Store Connect 重新生成 API Key |
| `hardened runtime` 失败 | `electron-builder.yml mac.hardenedRuntime: true` 但未签名 | 已签名则不会出现;如失败检查 entitlements |
| 公证超时 | 公证服务拥塞 | 重跑 job,无需改代码 |

## 3. Linux AppImage 注意事项

- `electron-builder.yml linux.target: AppImage[x64]`
- `pnpm electron:build:linux`(等同 `moon run openbuddy:electron.build.linux`)
- AppImage 自包含,无需系统级安装,但首次运行需要 `chmod +x *.AppImage`
- CI runner 必须安装 `libfuse2`(`apt-get install -y libfuse2`),否则 AppImage 启动失败
- 暂不在 release 中要求 `.deb` / `.rpm`(已配 task 但未启用)

## 4. macOS 真签名 / 公证验收清单(发布前)

- [ ] CI job `build-macos` 成功跑完且 artifact 上传
- [ ] DMG 拖入 Applications 启动无 Gatekeeper 警告
- [ ] `codesign -dvv <app>` 输出 `Developer ID Application: <team>`
- [ ] `spctl --assess --type execute --verbose <app>` 输出 `accepted`
- [ ] `xcrun notarytool history` 显示该 bundle id 的提交状态为 `Accepted`

## 5. 不在 release 流水线内的任务

- 内部 nightly:`pnpm moon:graph` / `pnpm test` 不依赖 tag,可手动跑
- 草稿 release:`softprops/action-gh-release` 当前用 `draft: false`,若需草稿先发,可改为 `draft: true`
- 月度预发布:`schedule` cron 未启用,需另开 workflow

## 6. 与 P1 / P2 改造的关系

- 本 change 只补 Linux CI 缺口,**不**修改 macOS 流水线(已完整)
- 后续 P1 工作:`release-ci.md` 与 `audit-enterprise-release.mjs` 联动,自动阻断不通过能力目录的 release
- 后续 P2 工作:`SCHEDULED` cron nightly / 公证前自动 lint / 平行 macos-latest + windows-latest 矩阵
