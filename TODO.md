# Electron + Pi 发布前检查

以下为待验证事项，不表示已经发布或完成公证。

- 在 macOS/Windows 安装打包产物，验证首次启动、文件对话框和窗口操作。
- 配置真实 BYOK，验证流式文本、工具权限允许/拒绝、停止和会话恢复。
- 检查 packaged Pi 技能、主题、WASM 与动态加载路径，无系统 Node/Pi 依赖。
- 配置 macOS Developer ID、hardened runtime 签名和公证，并独立验证 Gatekeeper。
- 配置 Windows 代码签名并验证 NSIS 安装/卸载。
- 记录冷启动、安装包体积和内存；与旧版基线比较。
- 设计旧 ACP 会话到 Pi 会话的迁移方案，当前不自动导入。
- 按优先级恢复暂缓能力：专家、自动化、连接器、插件、云存储、团队/子代理、计划模式与 rewind。
