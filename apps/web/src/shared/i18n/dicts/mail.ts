/** mail 域文案（zh-CN 默认，en-US 覆盖）。 */
export const mailZh: Record<string, string> = {
  "mail.title": "智能体邮箱（通知中心）",
  "mail.desc":
    "OpenBuddy 收到的所有 agent 事件通知：权限请求、文件夹信任、任务更新、计划模式、MCP 状态、会话完成等。数据存在 应用数据目录/pi/openbuddy-notifications.json。",
  "mail.loading": "加载中…",
  "mail.refresh": "刷新",
  "mail.markAllRead": "全部已读",
  "mail.clear": "清空",
  "mail.confirmClearTitle": "确定清空所有通知？",
  "mail.confirmClearLabel": "清空",

  "mail.systemNotify": "系统通知",
  "mail.systemNotifyHint":
    "窗口不在前台时，任务完成、失败或需要你确认时弹出系统通知，点击直接打开对应任务",
  "mail.unread": "未读通知",
  "mail.unreadBadge": "未读",
  "mail.session": "会话 #{id}",
  "mail.markRead": "标记已读",
  "mail.empty":
    "暂无通知。当 agent 产生事件时（权限请求、任务完成等）会记录到这里。",

  "mail.filter.all": "全部",
  "mail.filter.permission": "权限请求",
  "mail.filter.folder_trust": "文件夹信任",
  "mail.filter.task_update": "任务更新",
  "mail.filter.plan_mode": "计划模式",
  "mail.filter.mcp_status": "MCP 状态",
  "mail.filter.models_update": "模型更新",
  "mail.filter.summary": "会话标题",
  "mail.filter.session_complete": "会话完成",
  "mail.filter.error": "错误",

  "mail.kind.permission": "权限请求",
  "mail.kind.folder_trust": "文件夹信任",
  "mail.kind.task_update": "任务更新",
  "mail.kind.plan_mode": "计划模式",
  "mail.kind.mcp_status": "MCP 状态",
  "mail.kind.models_update": "模型更新",
  "mail.kind.summary": "会话标题",
  "mail.kind.session_complete": "会话完成",
  "mail.kind.error": "错误",
  "mail.kind.info": "信息",
};

export const mailEn: Record<string, string> = {
  "mail.title": "Agent Mail (Notification Center)",
  "mail.desc":
    "All agent events received by OpenBuddy: permission requests, folder trust, task updates, plan mode, MCP status, session completion and more. Stored in the app data directory at pi/openbuddy-notifications.json.",
  "mail.loading": "Loading…",
  "mail.refresh": "Refresh",
  "mail.markAllRead": "Mark all read",
  "mail.clear": "Clear",
  "mail.confirmClearTitle": "Clear all notifications?",
  "mail.confirmClearLabel": "Clear",

  "mail.systemNotify": "System notifications",
  "mail.systemNotifyHint":
    "Show a system notification when a task finishes, fails or needs your confirmation while the window is not in the foreground; clicking it opens the matching task",
  "mail.unread": "Unread notifications",
  "mail.unreadBadge": "Unread",
  "mail.session": "Session #{id}",
  "mail.markRead": "Mark as read",
  "mail.empty":
    "No notifications yet. Agent events (permission requests, task completion, …) are recorded here.",

  "mail.filter.all": "All",
  "mail.filter.permission": "Permission requests",
  "mail.filter.folder_trust": "Folder trust",
  "mail.filter.task_update": "Task updates",
  "mail.filter.plan_mode": "Plan mode",
  "mail.filter.mcp_status": "MCP status",
  "mail.filter.models_update": "Model updates",
  "mail.filter.summary": "Session titles",
  "mail.filter.session_complete": "Session complete",
  "mail.filter.error": "Errors",

  "mail.kind.permission": "Permission request",
  "mail.kind.folder_trust": "Folder trust",
  "mail.kind.task_update": "Task update",
  "mail.kind.plan_mode": "Plan mode",
  "mail.kind.mcp_status": "MCP status",
  "mail.kind.models_update": "Model update",
  "mail.kind.summary": "Session title",
  "mail.kind.session_complete": "Session complete",
  "mail.kind.error": "Error",
  "mail.kind.info": "Info",
};
