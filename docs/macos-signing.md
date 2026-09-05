# macOS 签名与公证

## 结论

macOS 没有可跨开发者、可免费复用的“通用签名”。要让其他用户下载 DMG 后直接打开，并避免“无法验证开发者”或“包含恶意软件”提示，需要：

1. Apple Developer Program 会员（通常为每年 99 美元，价格和地区以 Apple 为准）。
2. Apple Developer ID Application 证书，用于签名 `.app`。
3. Apple notarization 凭据，让 Apple 检查并公证应用。

免费 Apple 账号、`codesign -s -` 的 ad-hoc 签名、自己生成的证书，以及删除 quarantine 属性，都不能替代公开分发所需的 Apple 信任链。它们只适合本机开发或临时测试。

## 本地开发

使用 `pnpm dev`。不要直接从 Finder 打开 `node_modules/electron/dist/Electron.app`，它是 Electron 的开发运行时，不是 OpenBuddy 的发布应用。没有发布证书时可以继续开发，但不要把生成的 DMG 当作正式安装包。

## 正式构建

正式 macOS 构建使用 Moon 门禁：

```bash
pnpm electron:release:mac
```

该任务在 `electron-builder` 前检查 Developer ID 证书和 notarization 凭据，缺失时立即失败，避免产出未签名发布包。`electron-builder.yml` 已启用 `hardenedRuntime` 和 `notarize`。

推荐使用 App Store Connect API key 公证：

```bash
export CSC_LINK=/path/to/developer-id-application.p12
export CSC_KEY_PASSWORD='p12-password'
export APPLE_API_KEY=/path/to/AuthKey_KEYID.p8
export APPLE_API_KEY_ID='KEYID'
export APPLE_API_ISSUER='issuer-uuid'
pnpm electron:release:mac
```

也可以使用 Apple ID 应用专用密码：

```bash
export CSC_LINK=/path/to/developer-id-application.p12
export CSC_KEY_PASSWORD='p12-password'
export APPLE_ID='apple-id@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID'
pnpm electron:release:mac
```

不要把 `.p12`、`.p8`、密码或这些环境变量提交到 Git。CI 应使用加密 secrets；`CSC_LINK` 可以使用 electron-builder 支持的 base64 证书内容，`APPLE_API_KEY` 应指向 CI 临时写入的 `.p8` 文件。

## 验证

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/OpenBuddy Pi.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/OpenBuddy Pi.app"
xcrun stapler validate "release/OpenBuddy Pi-0.14.0-arm64.dmg"
```

只有签名验证、公证状态和 stapling 都通过，才应发布 DMG。Apple Developer ID 证书是个人/组织专属的，不存在项目可以共享的通用证书。
