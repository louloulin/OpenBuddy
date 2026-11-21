/**
 * 界面语言 (B4): zh-CN 默认，en-US 首选覆盖设置页（导航、通用、关于、数据管理）。
 *
 * The table is intentionally flat and small: untranslated keys fall back to zh-CN, so a panel
 * can be migrated incrementally without ever rendering a raw key. `useLocale` re-renders on
 * change; the choice lives in localStorage and is mirrored to `<html lang>`.
 */
import { useSyncExternalStore } from "react";

export type Locale = "zh-CN" | "en-US";
const STORAGE_KEY = "openbuddy.locale";
const listeners = new Set<() => void>();

const ZH: Record<string, string> = {
  "nav.newTask": "新建任务",
  "nav.专家·技能·连接器": "专家·技能·连接器",
  "nav.自动化": "自动化",
  "nav.资料库": "资料库",
  "nav.项目": "项目",
  "nav.助理": "助理",
  "nav.更多": "更多",
  "nav.我的文件": "我的文件",
  "nav.腾讯文档": "腾讯文档",
  "nav.乐享知识库": "乐享知识库",
  "nav.知识库": "知识库",
  "nav.用量统计": "用量统计",
  "nav.通知渠道": "通知渠道",
  "nav.网页预览": "网页预览",
  "nav.灵感": "灵感",
  "nav.策略设置": "策略设置",
  "nav.云存储": "云存储",
  "sidebar.moreSub": "文件·通知",
  "sidebar.recent": "最近",
  "sidebar.searchTasks": "搜索任务",
  "sidebar.notifications": "通知",
  "sidebar.settings": "设置",
  "composer.placeholder.plan": "说说要做什么，Buddy 先调研并给出计划，确认后再动手",
  "composer.placeholder.ask": "问点什么，Buddy 只回答、不改文件",
  "composer.placeholder.default": "今天帮你做些什么？/ 调用技能与指令，可粘贴截图或拖入文件",
  "home.disclaimer": "内容由 AI 生成，请核实重要信息",
  "settings.nav.general": "通用",
  "settings.nav.model": "模型",
  "settings.nav.assistant": "助理设置",
  "settings.nav.agent-settings": "智能体",
  "settings.nav.security": "安全中心",
  "settings.nav.personalize": "个性化",
  "settings.nav.memory": "记忆",
  "settings.nav.shortcuts": "快捷键",
  "settings.nav.agent-mail": "智能体邮箱",
  "settings.nav.data": "数据管理",
  "settings.nav.help": "帮助与反馈",
  "settings.nav.about": "关于",
  "general.title": "通用",
  "general.desc": "外观与输入习惯。改动即时生效，并保存在这台设备上。",
  "general.theme.title": "主题",
  "general.theme.hint": "暖中性浅色，或低眩光深色。",
  "general.theme.light": "浅色",
  "general.theme.dark": "深色",
  "general.font.title": "字号",
  "general.font.hint": "影响对话正文、侧栏与设置文字。",
  "general.font.small": "小",
  "general.font.normal": "标准",
  "general.font.large": "大",
  "general.density.title": "信息密度",
  "general.density.hint": "列表与设置行的间距。",
  "general.density.comfortable": "宽松",
  "general.density.compact": "紧凑",
  "general.density.comfortableHint": "行高更舒展",
  "general.density.compactHint": "一屏看到更多",
  "general.sendKey.title": "发送键",
  "general.sendKey.hint": "发送消息的快捷键；换行始终可用。",
  "general.sendKey.enter": "Shift+Enter 换行",
  "general.sendKey.modEnter": "Enter 换行",
  "general.language.title": "语言",
  "general.language.hint": "界面语言。设置页立即切换，重启后保留。",
  "general.tray.title": "托盘常驻",
  "general.tray.none": "当前环境没有系统托盘。",
  "general.tray.on": "关闭窗口后驻留托盘，自动化继续在后台运行；从托盘菜单退出。",
  "general.tray.off": "关闭窗口即退出。开启后可在后台继续跑自动化。",
  "general.tray.offButton": "关闭",
  "general.tray.onButton": "开启",
  "general.tray.unavailable": "不可用",
  "general.quick.title": "快速输入",
  "general.quick.unsupported": "当前环境不支持全局快捷键。",
  "general.quick.hint": "在任意应用里按下这个组合键，弹出小输入框并新建任务。",
  "general.quick.inputLabel": "快速输入快捷键",
  "general.quick.save": "保存",
  "about.title": "关于",
  "about.desc": "版本信息、更新检查与文档入口。",
  "about.tagline": "Pi 版 WorkBuddy",
  "about.engine": "引擎",
  "about.update": "更新",
  "about.license": "许可",
  "about.licenseValue": "本地优先，数据不出设备（诊断报告需你手动保存 / 分享）",
  "about.docs": "文档",
  "about.feedback": "反馈",
  "about.feedbackValue": "设置 · 帮助与反馈 →「生成诊断报告」",
  "about.check": "检查更新",
  "about.checking": "检查中…",
  "about.available": "发现新版本 v{version}",
  "about.upToDate": "已是最新版本 v{version}",
  "about.channel.stable": "正式通道",
  "about.channel.beta": "测试通道",
  "about.download": "打开下载页",
  "about.downloadNote": "安装包下载后手动安装；应用不会静默替换自身。",
  "about.downloadInstaller": "下载安装包",
  "about.downloading": "下载并校验中…",
  "about.downloaded": "已下载到本机并通过校验",
  "about.openFolder": "打开所在文件夹",
  "about.downloadReady": "保存在应用自己的更新目录，运行前不会执行；请手动打开安装包。",
  "data.title": "数据管理",
  "data.desc": "本地数据目录、全量导出/恢复、自动快照与会话导入。",
  "data.dir": "agent 数据目录",
  "data.files": "全量数据 / 会话文件",
  "data.filesHint": "导出包含设置、模型、项目、自动化、MCP 与 Pi 设置；恢复前会自动快照。",
  "data.export": "导出全部数据",
  "data.exporting": "导出中…",
  "data.restore": "从数据包恢复",
  "data.restoring": "恢复中…",
  "data.import": "导入会话 JSONL",
  "data.importing": "导入中…",
  "data.clear": "清理本地会话缓存",
  "data.secretNote": "导出包不含密钥（`credentials.enc.json` 与系统钥匙串绑定）；恢复后请在「账号与模型」重新输入 API Key。",
  "data.snapshots": "自动快照",
  "data.snapshotsHint": "启动、迁移与恢复前各留一份，保留最近 3 份。",
  "data.noSnapshots": "还没有快照：首次有数据后的启动或首次迁移会自动创建。",
  "data.snapshotStartup": "启动快照",
  "data.snapshotRestore": "恢复前快照",
  "data.rollback": "回滚",
  "data.rollingBack": "回滚中…",
  "data.filesCount": "{count} 个文件",
  "data.footnote": "完全删除历史会话请在侧栏右键单个会话选「删除」；导入的会话使用新 id，不会覆盖已有历史。数据文件带 `schemaVersion`，旧版本会在启动时顺序迁移。",
};

const EN: Record<string, string> = {
  "nav.newTask": "New task",
  "nav.专家·技能·连接器": "Experts · Skills · Connectors",
  "nav.自动化": "Automations",
  "nav.资料库": "Library",
  "nav.项目": "Projects",
  "nav.助理": "Assistant",
  "nav.更多": "More",
  "nav.我的文件": "My files",
  "nav.腾讯文档": "Tencent Docs",
  "nav.乐享知识库": "Lexiang KB",
  "nav.知识库": "Knowledge base",
  "nav.用量统计": "Usage",
  "nav.通知渠道": "Notify channels",
  "nav.网页预览": "Web preview",
  "nav.灵感": "Inspiration",
  "nav.策略设置": "Policy",
  "nav.云存储": "Cloud storage",
  "sidebar.moreSub": "Files · Alerts",
  "sidebar.recent": "Recent",
  "sidebar.searchTasks": "Search tasks",
  "sidebar.notifications": "Notifications",
  "sidebar.settings": "Settings",
  "composer.placeholder.plan": "Describe what you want; Buddy researches and proposes a plan first",
  "composer.placeholder.ask": "Ask anything; Buddy answers without changing files",
  "composer.placeholder.default": "What can I do for you today? Use skills and commands, paste a screenshot or drop a file",
  "home.disclaimer": "AI-generated content may be inaccurate; verify important information",
  "settings.nav.general": "General",
  "settings.nav.model": "Models",
  "settings.nav.assistant": "Assistant",
  "settings.nav.agent-settings": "Agent",
  "settings.nav.security": "Security",
  "settings.nav.personalize": "Personalization",
  "settings.nav.memory": "Memory",
  "settings.nav.shortcuts": "Shortcuts",
  "settings.nav.agent-mail": "Agent email",
  "settings.nav.data": "Data",
  "settings.nav.help": "Help & feedback",
  "settings.nav.about": "About",
  "general.title": "General",
  "general.desc": "Appearance and input habits. Changes apply immediately and stay on this device.",
  "general.theme.title": "Theme",
  "general.theme.hint": "Warm neutral light, or a low-glare dark theme.",
  "general.theme.light": "Light",
  "general.theme.dark": "Dark",
  "general.font.title": "Font size",
  "general.font.hint": "Affects messages, the sidebar and settings text.",
  "general.font.small": "Small",
  "general.font.normal": "Default",
  "general.font.large": "Large",
  "general.density.title": "Density",
  "general.density.hint": "Spacing in lists and settings rows.",
  "general.density.comfortable": "Comfortable",
  "general.density.compact": "Compact",
  "general.density.comfortableHint": "More breathing room",
  "general.density.compactHint": "See more at once",
  "general.sendKey.title": "Send key",
  "general.sendKey.hint": "Shortcut to send a message; line breaks always work.",
  "general.sendKey.enter": "Shift+Enter for a new line",
  "general.sendKey.modEnter": "Enter for a new line",
  "general.language.title": "Language",
  "general.language.hint": "Interface language. Settings switch immediately and persist.",
  "general.tray.title": "Keep in tray",
  "general.tray.none": "This environment has no system tray.",
  "general.tray.on": "Closing the window keeps the app in the tray; automations keep running. Quit from the tray menu.",
  "general.tray.off": "Closing the window quits. Turn this on to keep automations running in the background.",
  "general.tray.offButton": "Off",
  "general.tray.onButton": "On",
  "general.tray.unavailable": "Unavailable",
  "general.quick.title": "Quick input",
  "general.quick.unsupported": "Global shortcuts are not supported here.",
  "general.quick.hint": "Press this shortcut in any app to open a small composer and start a task.",
  "general.quick.inputLabel": "Quick input shortcut",
  "general.quick.save": "Save",
  "about.title": "About",
  "about.desc": "Version, update check and documentation.",
  "about.tagline": "WorkBuddy on Pi",
  "about.engine": "Engine",
  "about.update": "Update",
  "about.license": "License",
  "about.licenseValue": "Local-first; your data stays on this device (diagnostics are saved/shared manually).",
  "about.docs": "Docs",
  "about.feedback": "Feedback",
  "about.feedbackValue": "Settings · Help & feedback → “Generate diagnostics”",
  "about.check": "Check for updates",
  "about.checking": "Checking…",
  "about.available": "Version v{version} is available",
  "about.upToDate": "You are on the latest version v{version}",
  "about.channel.stable": "Stable",
  "about.channel.beta": "Beta",
  "about.download": "Open download page",
  "about.downloadNote": "Install the downloaded package manually; the app never replaces itself silently.",
  "about.downloadInstaller": "Download installer",
  "about.downloading": "Downloading and verifying…",
  "about.downloaded": "Downloaded and verified",
  "about.openFolder": "Show in folder",
  "about.downloadReady": "Saved to the app's own updates folder and never executed automatically; open the installer manually.",
  "data.title": "Data",
  "data.desc": "Data directory, full export/restore, snapshots and session import.",
  "data.dir": "Agent data directory",
  "data.files": "All data / session files",
  "data.filesHint": "The bundle covers settings, models, projects, automations, MCP and Pi settings; a snapshot is taken before restoring.",
  "data.export": "Export all data",
  "data.exporting": "Exporting…",
  "data.restore": "Restore from bundle",
  "data.restoring": "Restoring…",
  "data.import": "Import session JSONL",
  "data.importing": "Importing…",
  "data.clear": "Clear local session cache",
  "data.secretNote": "Keys are not exported (`credentials.enc.json` is bound to the system keychain); re-enter them under Account & models after restoring.",
  "data.snapshots": "Automatic snapshots",
  "data.snapshotsHint": "Taken at startup, before migrations and before restores; the newest three are kept.",
  "data.noSnapshots": "No snapshots yet: one is created on the first startup with data or the first migration.",
  "data.snapshotStartup": "Startup snapshot",
  "data.snapshotRestore": "Pre-restore snapshot",
  "data.rollback": "Roll back",
  "data.rollingBack": "Rolling back…",
  "data.filesCount": "{count} files",
  "data.footnote": "To delete a conversation entirely, right-click it in the sidebar and choose “Delete”. Imported sessions get a new id. Data files carry `schemaVersion` and migrate in order on startup.",
};

const DICTS: Record<Locale, Record<string, string>> = { "zh-CN": ZH, "en-US": EN };

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en-US" ? "en-US" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

let current: Locale = readLocale();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the language still applies for this session.
  }
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translate a key in the active locale; unknown keys fall back to zh-CN, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = DICTS[current][key] ?? ZH[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** The translation when it exists, otherwise undefined (lets a component keep its own default). */
export function tOptional(key: string): string | undefined {
  return DICTS[current][key] ?? ZH[key];
}

/** Apply `<html lang>` on boot (main.tsx). */
export function applyLocale(): void {
  document.documentElement.lang = current;
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, setLocale, t, tOptional };
}
