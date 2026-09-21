/**
 * Email AI 模块的 i18n 文本与 React hook。
 *
 * 设计:不引入新依赖,自实现轻量级 i18n。
 *   - 翻译表按 key 嵌套:{ "today": "Today · 今天要看的" }
 *   - hook:useAiT9n(locale) → 翻译函数 t(key)
 *   - 默认从 localStorage / navigator 推断 locale
 *
 * 后续可平滑替换为 @openbuddy/ui-locale 的 useT。
 */
import { useCallback, useMemo } from "react";

export type AiLocale = "zh-CN" | "en-US";

const ZH_CN: Record<string, string> = {
  "today": "Today · 今天要看的",
  "later": "Later · 本周再处理",
  "done": "Done · 已完成",
  "inbox": "Inbox",
  "drafts": "草稿",
  "scheduled": "Scheduled",
  "snoozed": "Snoozed",
  "starred": "Starred",
  "important": "重要",
  "archive": "归档",
  "trash": "垃圾箱",
  "spam": "垃圾邮件",
  "connected": "已连接",
  "reauth_required": "需要重新授权",
  "disconnected": "未连接",
  "unified_inbox": "统一收件箱",
  "ai_summary": "AI 摘要",
  "ai_summarize_loading": "正在生成摘要…",
  "ai_summarize_idle": "点击生成摘要",
  "ai_summarize_failed": "AI 摘要失败",
  "ai_recommendations": "AI 推荐的回复",
  "ai_regenerate": "换一批",
  "ai_loading_suggestions": "AI 正在起草 {count} 个回复候选…",
  "ai_no_suggestions": "AI 暂无建议 — 你可以手动撰写。",
  "ai_adopt_to_composer": "采纳进入 Composer",
  "ai_action_plan_n": "AI 建议 {total} 个操作 · 已选 {accepted}",
  "ai_action_apply_n": "一键执行 {accepted}",
  "ai_action_cancel": "取消",
  "ai_action_reject_all": "全驳",
  "ai_action_accept_all": "全选",
  "ai_action_view_detail": "查看明细",
  "ai_action_planning": "AI 正在分析邮件…",
  "ai_action_executing": "正在执行 AI 操作…",
  "ai_action_no_suggestion": "AI 没有建议 — 没有需要操作的邮件。",
  "ai_receipt_executed": "已执行 {n} 项",
  "ai_receipt_failed": "失败 {n} 项",
  "ai_receipt_partial": "已执行 {n} 项 · 失败 {m}",
  "ai_receipt_undo": "撤销（{s}s）",
  "ai_receipt_dismiss": "关闭",
  "ai_command_placeholder": "让 AI 帮你处理邮件…(按 ⏎ 运行，Esc 关闭)",
  "ai_command_starter_clean": "🧹 一键清噪声",
  "ai_command_starter_clean_prompt": "把本周营销和通知类的邮件归档",
  "ai_command_starter_needs_reply": "🔁 整理待我回复",
  "ai_command_starter_needs_reply_prompt": "列出所有需要我回复的邮件并草拟回复",
  "ai_command_starter_summary": "📅 本周总结",
  "ai_command_starter_summary_prompt": "用 5 句话总结本周我收件箱里最重要的事",
  "ai_command_starter_snooze": "⏰ 稍后处理低优先级",
  "ai_command_starter_snooze_prompt": "把所有 AI 标记低优先级的邮件 snooze 到下周一",
  "ai_command_section_try": "试试",
  "ai_command_section_recent": "最近",
  "ai_clean_inbox": "一键清空噪声",
  "ai_command_button": "AI 命令",
  "new_mail": "新建",
  "thread_count": "{n} 封邮件",
  "status_ai_planning": "AI 正在规划…",
  "status_ai_executing": "正在执行…",
  "status_ai_can_undo": "已执行 · 可撤销",
  "status_ai_summary_ready": "AI 摘要已生成",
  "status_ai_standby": "AI 待命",
  "undo_seconds": "撤销 {s}s",
  "pending_plans_n": "{n} 个 AI 计划",
  "thread_count_short": "{n} 封线程",
  "shortcuts_help": "所有快捷键",
  "shortcut_jk": "切换",
  "shortcut_e": "归档",
  "shortcut_z": "稍后",
  "shortcut_r": "回复",
  "shortcut_c": "新建",
  "shortcut_search": "搜索",
  "shortcut_command": "AI 命令",
  "shortcut_undo": "撤销",
  "shortcut_help": "帮助",
  "empty_today_done": "今日还没有已完成项 — 完成一些邮件后会显示在这里。",
  "empty_no_match": "没有匹配的邮件。",
  "detail_placeholder": "从列表中选择一封邮件，这里会显示 AI 自动摘要与回复建议。",
  "messages_placeholder": "这里会渲染原邮件消息 — EmailDetail 现有实现可平替，保持 UI 一致性。",
  "subject_empty": "（无主题）",
  "body_empty": "（无正文）",
  "undo_seconds_remaining": "撤销剩余 {s}s",
};

const EN_US: Record<string, string> = {
  "today": "Today · Action now",
  "later": "Later · This week",
  "done": "Done · Completed",
  "inbox": "Inbox",
  "drafts": "Drafts",
  "scheduled": "Scheduled",
  "snoozed": "Snoozed",
  "starred": "Starred",
  "important": "Important",
  "archive": "Archive",
  "trash": "Trash",
  "spam": "Spam",
  "connected": "Connected",
  "reauth_required": "Reauthorization required",
  "disconnected": "Disconnected",
  "unified_inbox": "Unified inbox",
  "ai_summary": "AI Summary",
  "ai_summarize_loading": "Generating summary…",
  "ai_summarize_idle": "Click to summarize",
  "ai_summarize_failed": "AI summary failed",
  "ai_recommendations": "AI recommended replies",
  "ai_regenerate": "Regenerate",
  "ai_loading_suggestions": "Drafting {count} reply candidates…",
  "ai_no_suggestions": "No AI suggestions — type your own reply.",
  "ai_adopt_to_composer": "Adopt into Composer",
  "ai_action_plan_n": "AI suggests {total} actions · {accepted} selected",
  "ai_action_apply_n": "Apply {accepted}",
  "ai_action_cancel": "Cancel",
  "ai_action_reject_all": "Reject all",
  "ai_action_accept_all": "Accept all",
  "ai_action_view_detail": "View details",
  "ai_action_planning": "AI analyzing emails…",
  "ai_action_executing": "Executing AI actions…",
  "ai_action_no_suggestion": "No actions needed.",
  "ai_receipt_executed": "{n} items executed",
  "ai_receipt_failed": "{n} items failed",
  "ai_receipt_partial": "{n} executed · {m} failed",
  "ai_receipt_undo": "Undo ({s}s)",
  "ai_receipt_dismiss": "Dismiss",
  "ai_command_placeholder": "Let AI handle your email…(⏎ to run, Esc to close)",
  "ai_command_starter_clean": "🧹 Clean noise",
  "ai_command_starter_clean_prompt": "Archive this week's marketing and notification emails",
  "ai_command_starter_needs_reply": "🔁 Needs reply",
  "ai_command_starter_needs_reply_prompt": "List all emails needing my reply and draft replies",
  "ai_command_starter_summary": "📅 Weekly summary",
  "ai_command_starter_summary_prompt": "Summarize this week's inbox in 5 sentences",
  "ai_command_starter_snooze": "⏰ Snooze low priority",
  "ai_command_starter_snooze_prompt": "Snooze all AI-flagged low-priority emails to next Monday",
  "ai_command_section_try": "Try",
  "ai_command_section_recent": "Recent",
  "ai_clean_inbox": "Clean inbox",
  "ai_command_button": "AI command",
  "new_mail": "New",
  "thread_count": "{n} emails",
  "status_ai_planning": "AI planning…",
  "status_ai_executing": "Executing…",
  "status_ai_can_undo": "Done · can undo",
  "status_ai_summary_ready": "AI summary ready",
  "status_ai_standby": "AI standby",
  "undo_seconds": "Undo {s}s",
  "pending_plans_n": "{n} AI plans",
  "thread_count_short": "{n} threads",
  "shortcuts_help": "All shortcuts",
  "shortcut_jk": "Next/Prev",
  "shortcut_e": "Archive",
  "shortcut_z": "Snooze",
  "shortcut_r": "Reply",
  "shortcut_c": "Compose",
  "shortcut_search": "Search",
  "shortcut_command": "AI cmd",
  "shortcut_undo": "Undo",
  "shortcut_help": "Help",
  "empty_today_done": "No completed items yet — finish some emails and they'll show here.",
  "empty_no_match": "No matching emails.",
  "detail_placeholder": "Select an email from the list to see AI summary and reply suggestions.",
  "messages_placeholder": "Original email messages render here.",
  "subject_empty": "(no subject)",
  "body_empty": "(no body)",
  "undo_seconds_remaining": "{s}s to undo",
};

const TABLES: Record<AiLocale, Record<string, string>> = { "zh-CN": ZH_CN, "en-US": EN_US };

export function detectAiLocale(): AiLocale {
  if (typeof navigator !== "undefined") {
    const lang = navigator.language;
    if (lang.startsWith("en")) return "en-US";
    if (lang.startsWith("zh")) return "zh-CN";
  }
  return "zh-CN";
}

export interface AiT9n {
  t(key: string, vars?: Record<string, string | number>): string;
  locale: AiLocale;
}

export function useAiT9n(locale?: AiLocale): AiT9n {
  const resolved = locale ?? detectAiLocale();
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const raw = TABLES[resolved]?.[key] ?? TABLES["zh-CN"][key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    [resolved],
  );
  return useMemo(() => ({ t, locale: resolved }), [t, resolved]);
}
