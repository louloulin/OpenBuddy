/**
 * Settings 面板的各个真实分区。
 *
 * 这些是 SettingsPanel.tsx 里除了"模型"以外的真实实现，替代之前的
 * "该分区即将上线"占位。每个分区对接 OpenBuddy 已有的能力：
 *  - personalize: 主题（接 ThemeProvider）+ 字号
 *  - shortcuts: 快捷键说明（纯展示 + localStorage 自定义）
 *  - memory: 资料库入口（接 memory_list + memory_rewrite）
 *  - help: 帮助 + 反馈入口（含 agent 内核信息）
 *  - security: 安全中心（权限规则入口 + folder trust 说明）
 *  - data: 数据管理（清理会话/缓存 + 打开 agent 目录）
 *  - general: 系统设置（cwd/工作目录 + 重启 agent）
 *  - account: 账户（agent auth 状态）
 *  - agent-settings / assistant: 引导到对应面板
 */
export { PersonalizeSettingsPanel } from "./sections/PersonalizeSettingsPanel";
export { ShortcutsSettingsPanel } from "./sections/ShortcutsSettingsPanel";
export { MemorySettingsPanel } from "./sections/MemorySettingsPanel";
export { HelpSettingsPanel } from "./sections/HelpSettingsPanel";
export { SecuritySettingsPanel } from "./sections/SecuritySettingsPanel";
export { DataSettingsPanel } from "./sections/DataSettingsPanel";
export { GeneralSettingsPanel } from "./sections/GeneralSettingsPanel";
export { GeneralPreferencesPanel } from "./sections/GeneralPreferencesPanel";
export { DefaultOpenPanel } from "./sections/DefaultOpenPanel";
export { ConversationFlowPanel } from "./sections/ConversationFlowPanel";
export { AboutSettingsPanel } from "./sections/AboutSettingsPanel";
export { AccountSettingsPanel } from "./sections/AccountSettingsPanel";
export { AgentSettingsPanel } from "./sections/AgentSettingsPanel";
export { AssistantSettingsPanel } from "./sections/AssistantSettingsPanel";
export { AgentMailSettingsPanel } from "./sections/AgentMailSettingsPanel";
export { MobileAccessPanel } from "./sections/MobileAccessPanel";
