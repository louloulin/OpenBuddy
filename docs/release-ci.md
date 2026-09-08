# OpenBuddy Release CI 矩阵

> 更新时间:2026-09-07
> 范围:`.github/workflows/release.yml`、`electron-builder.yml`、moon 单仓多包构建、`scripts/check-macos-signing.mjs`
> 目的:把当前散落的 Windows / macOS / Linux / 公证 / 签名步骤固化成单一事实源

## 1. 流水线概览

| Job | Runner | 触发条件 | 产物 | 关键 Secrets |
| --- | --- | --- | --- | --- |
| `ci` | ubuntu-latest | tag `v*` 或 workflow_dispatch | (无产物) | — |
| `build-windows` | windows-latest | `ci` 完成 | NSIS `.exe` (x64) | — |
| `build-macos` | macos-latest | `ci` 完成 | DMG (x64 + arm64),已签名 + notarized;无 secrets 时 dir-only unsigned(需 `OPENBUDDY_ALLOW_UNSIGNED_MAC=1`) | `MACOS_CSC_LINK_BASE64`、`MACOS_CSC_KEY_PASSWORD`、`MACOS_API_KEY_BASE64`、`MACOS_API_KEY_ID`、`MACOS_API_ISSUER` |
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

凭据导入脚本位于 `.github/workflows/release.yml` 中 `build-macos.import-cert` 与 `build-macos.import-notary` 两个步骤,顺序:

1. 解码 `MACOS_CSC_LINK_BASE64` → `$RUNNER_TEMP/developer-id-application.p12`
2. 设置 `CSC_LINK` 与 `CSC_KEY_PASSWORD`
3. 解码 `MACOS_API_KEY_BASE64` → `$RUNNER_TEMP/AuthKey_<id>.p8`
4. 设置 `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`
5. 调用 `pnpm electron:release:mac`(等同 `moon run openbuddy:electron.build.mac`)
6. electron-builder 自动检测 `CSC_LINK` → 签名,检测 `APPLE_API_KEY*` → notarize

> 任一导入步骤在缺少 secret 且未设置 `OPENBUDDY_ALLOW_UNSIGNED_MAC=1` 时硬失败;
> 设置后只产出未签名 `--dir` 产物,后续步骤不会跑 `codesign -dv` 验证。

### 2.2 失败时排错

| 错误码 / 现象 | 可能原因 | 下一步 |
| --- | --- | --- |
| `electron-builder` 报 `code signing failed` | `MACOS_CSC_LINK_BASE64` 解码失败 / 证书过期 | 用 `base64 -d` 本地验证;检查 Apple Developer Portal 的证书状态 |
| `notarytool` 报 `authentication failed` | `MACOS_API_KEY_ID` / `MACOS_API_ISSUER` 错配 | 在 App Store Connect 重新生成 API Key |
| `hardened runtime` 失败 | `electron-builder.yml mac.hardenedRuntime: true` 但未签名 | 已签名则不会出现;如失败检查 entitlements |
| 公证超时 | 公证服务拥塞 | 重跑 job,无需改代码 |
| `check-macos-signing.mjs --verify` 报 `not signed by a Developer ID Application` | 证书来源不是 `Developer ID Application`(常见原因:`Apple Development` 个人证书、ad-hoc) | 重新从 Apple Developer Portal 导出 `.p12`,确认 type=`Developer ID Application` |
| `spctl --assess` 报 `rejected` | 公证未完成 / ticket 未 stapled | 重跑 release job;若仍失败,检查 `xcrun notarytool history` 中该 bundle id 的状态 |
| `stapler validate` 报 `not a staple` | 公证完成但 ticket 未自动 stapled(DMG 才会出现) | 在 `electron-builder.yml mac.notarize: true` 已经处理;如仍失败,手动 `xcrun stapler staple <dmg>` 重打 |

### 2.3 Codesign 后置校验(`scripts/check-macos-signing.mjs --verify`)

发布流水线在 `build-macos` job 的 `Verify signed macOS artifact` 步骤里跑:

```bash
APP_PATH=$(ls -d release/mac-*/OpenBuddy.app | head -n1)
node scripts/check-macos-signing.mjs --verify "${APP_PATH}"
```

- 通过条件:
  - `codesign -dv` 输出 `Authority=Developer ID Application: <team>`
  - 签名 flags 含 `runtime`(hardened runtime)
  - `spctl --assess --type execute --verbose=2` 通过
  - 当 artifact 是 `.dmg` / `.pkg` 时,`xcrun stapler validate` 通过
- 退出码:
  - `0` = 通过
  - `1` = 签名 / 公证失败,CI 红灯
  - `2` = codesign 不可用(Linux runner 才会出现)
- 本地预演:
  ```bash
  pnpm electron:build:mac.dir
  CSC_LINK=/path/to/cert.p12 CSC_KEY_PASSWORD=... APPLE_API_KEY=... \
    node scripts/check-macos-signing.mjs --verify release/mac-arm64/OpenBuddy.app
  ```

## 3. "无 secrets 时跳过 notarize" 路径

> 默认情况下,`build-macos` 在缺少任何 Apple secret 时**硬失败**(红屏)。
> 仅在显式开启旁路时才跳过 notarize。

### 3.1 启用方式

在工作流仓库的 Settings → Variables → Actions 里新增:

| Variable | 取值 | 含义 |
| --- | --- | --- |
| `OPENBUDDY_ALLOW_UNSIGNED_MAC` | `1` | 允许 `build-macos` 在缺少 `MACOS_CSC_LINK_BASE64` / `MACOS_API_KEY_BASE64` 时跳过签名 / 公证 |
| 同上 | `0`(默认) | 缺少 secret 时直接红屏,不允许发布 |

### 3.2 行为差异

| secret 状态 | `OPENBUDDY_ALLOW_UNSIGNED_MAC=0`(默认) | `OPENBUDDY_ALLOW_UNSIGNED_MAC=1` |
| --- | --- | --- |
| 5 个 Apple secret 齐全 | 签名 + notarize + codesign 后置校验 + artifact 上传 | 同左 |
| 缺 `MACOS_CSC_LINK_*` 或 `MACOS_API_KEY_*` | job 失败,DMG 不上传 | 输出 `::warning::`、跳过 `Verify signed macOS artifact` 步骤、仍上传未签名 DMG,但 Artifact 名称 + 警告都明确标记为 unsigned |

### 3.3 谁应该开启

- 公共 fork 仓库的 CI(没有付费 Apple 账号)→ 建议开启
- 主仓 `louloulin/OpenBuddy` 发布 job → **必须保持 `0`**,避免在缺 secret 时悄悄发布未签名包

### 3.4 回滚步骤(已签名的 DMG 但 Gatekeeper 拒绝)

1. **不要重新跑 release job**:同样 commit / tag 会再次产出未签名包
2. 手动从本地 Mac 用同一份 `.p12` 重新签:
   ```bash
   xcrun notarytool history --key ~/.private_keys/AuthKey_<id>.p8 --key-id <id> --issuer <uuid>
   xcrun stapler staple release/OpenBuddy-<ver>-arm64.dmg
   codesign -dvv release/mac-arm64/OpenBuddy.app
   ```
3. 把重新签好的 DMG 用 `softprops/action-gh-release` 的 `files:` 模式上传覆盖现有 release

## 4. Linux AppImage 注意事项

- `electron-builder.yml linux.target: AppImage[x64]`
- `pnpm electron:build:linux`(等同 `moon run openbuddy:electron.build.linux`)
- AppImage 自包含,无需系统级安装,但首次运行需要 `chmod +x *.AppImage`
- CI runner 必须安装 `libfuse2`(`apt-get install -y libfuse2`),否则 AppImage 启动失败
- 暂不在 release 中要求 `.deb` / `.rpm`(已配 task 但未启用)

## 5. macOS 真签名 / 公证验收清单(发布前)

- [ ] CI job `build-macos` 成功跑完且 artifact 上传(secret 齐全时,日志含 `macOS signing verify passed`)
- [ ] DMG 拖入 Applications 启动无 Gatekeeper 警告
- [ ] `codesign -dvv <app>` 输出 `Developer ID Application: <team>` 且 `flags=` 含 `runtime`
- [ ] `spctl --assess --type execute --verbose <app>` 输出 `accepted`
- [ ] `xcrun stapler validate <dmg>` 通过
- [ ] `xcrun notarytool history` 显示该 bundle id 的提交状态为 `Accepted`

## 6. 不在 release 流水线内的任务

- 内部 nightly:`pnpm moon:graph` / `pnpm test` 不依赖 tag,可手动跑
- 草稿 release:`softprops/action-gh-release` 当前用 `draft: false`,若需草稿先发,可改为 `draft: true`
- 月度预发布:`schedule` cron 未启用,需另开 workflow

## 7. 与 P1 / P2 改造的关系

- 本 change 闭合 P0-1(macOS 真实签名 + 后置 codesign 校验)+ P0-5(`scripts/_section-credit-expiry.sh` 抽出)
- 后续 P1 工作:`release-ci.md` 与 `audit-enterprise-release.mjs` 联动,自动阻断不通过能力目录的 release
- 后续 P2 工作:`SCHEDULED` cron nightly / 公证前自动 lint / 平行 macos-latest + windows-latest 矩阵