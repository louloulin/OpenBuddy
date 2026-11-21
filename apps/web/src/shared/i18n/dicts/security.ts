/** security 域文案（zh-CN 默认，en-US 覆盖）。 */
export const securityZh: Record<string, string> = {
  "security.title": "安全中心",
  "security.desc":
    "工具执行的放行规则与受保护路径。改动立即生效：下一次工具调用就按新规则判断。",
  "security.loading": "加载中…",

  "security.category.read": "读取",
  "security.category.write": "写入",
  "security.category.delete": "删除",
  "security.category.command": "命令",
  "security.category.mcp": "MCP 工具",
  "security.category.other": "其他",

  "security.action.allow": "允许",
  "security.action.ask": "询问",
  "security.action.deny": "拒绝",

  "security.protected.title": "受保护路径",
  "security.protected.hint": "写入 / 编辑 / 删除这些文件一律拒绝，完全访问也不例外。",
  "security.protected.empty": "没有受保护路径（写入不再受硬性拦截）",
  "security.protected.remove": "移除受保护路径 {path}",
  "security.protected.placeholder": ".env / *.pem / .git / config/secrets.json",
  "security.protected.add": "添加",
  "security.protected.restore": "恢复默认",
  "security.protected.restoreTitle": "恢复为默认的 .env / .git / 密钥等",
  "security.protected.note.env": "同时覆盖",
  "security.protected.note.sep": "；",
  "security.protected.note.pem": "按后缀匹配",
  "security.protected.note.git": "匹配路径中任意一段。",

  "security.rules.title": "权限规则",
  "security.rules.hint": "拒绝 > 询问 > 允许。「始终允许」产生的规则可以在这里撤销。",
  "security.rules.empty": "还没有自定义规则。所有工具都按当前权限模式处理。",
  "security.rules.anyTool": "所有工具",
  "security.rules.actionGroup": "{tool} 的处理方式",
  "security.rules.delete": "删除规则 {tool}",
  "security.rules.toolLabel": "规则工具",
  "security.rules.optMcp": "mcp（所有 MCP 工具）",
  "security.rules.optAny": "any（所有工具）",
  "security.rules.patternPlaceholder": "可选：路径 / 命令片段",
  "security.rules.add": "添加规则",
  "security.rules.note.head": "规则按顺序匹配；",
  "security.rules.note.mcp": "覆盖所有 ",
  "security.rules.note.tail": " 开头的工具。改动保存到本地设置，无需重启。",
};

export const securityEn: Record<string, string> = {
  "security.title": "Security Center",
  "security.desc":
    "Allow rules for tool execution and protected paths. Changes take effect immediately: the next tool call is judged by the new rules.",
  "security.loading": "Loading…",

  "security.category.read": "Read",
  "security.category.write": "Write",
  "security.category.delete": "Delete",
  "security.category.command": "Command",
  "security.category.mcp": "MCP tools",
  "security.category.other": "Other",

  "security.action.allow": "Allow",
  "security.action.ask": "Ask",
  "security.action.deny": "Deny",

  "security.protected.title": "Protected paths",
  "security.protected.hint":
    "Writing, editing or deleting these files is always denied, even with full access.",
  "security.protected.empty": "No protected paths (writes are no longer hard-blocked)",
  "security.protected.remove": "Remove protected path {path}",
  "security.protected.placeholder": ".env / *.pem / .git / config/secrets.json",
  "security.protected.add": "Add",
  "security.protected.restore": "Restore defaults",
  "security.protected.restoreTitle": "Restore the default .env / .git / key files",
  "security.protected.note.env": "also covers",
  "security.protected.note.sep": "; ",
  "security.protected.note.pem": "matches by suffix",
  "security.protected.note.git": "matches any segment of a path.",

  "security.rules.title": "Permission rules",
  "security.rules.hint":
    "Deny > Ask > Allow. Rules created by “always allow” can be revoked here.",
  "security.rules.empty":
    "No custom rules yet. All tools follow the current permission mode.",
  "security.rules.anyTool": "All tools",
  "security.rules.actionGroup": "Handling of {tool}",
  "security.rules.delete": "Delete rule {tool}",
  "security.rules.toolLabel": "Rule tool",
  "security.rules.optMcp": "mcp (all MCP tools)",
  "security.rules.optAny": "any (all tools)",
  "security.rules.patternPlaceholder": "Optional: path / command fragment",
  "security.rules.add": "Add rule",
  "security.rules.note.head": "Rules are matched in order; ",
  "security.rules.note.mcp": " covers every ",
  "security.rules.note.tail":
    " tool. Changes are stored in local settings and need no restart.",
};
