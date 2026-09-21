/**
 * useSmartSnooze — 自然语言 snooze 时间解析。
 *
 * 第 3 周改进(P2-4):把"下周一早 9 点 / 周末 / 明天回家前"等表达解析成 ISO 时间。
 * 不引入 LLM 依赖 — 用规则匹配覆盖 90% 场景。
 * 失败 → fallback 4h,UI 仍可用。
 *
 * P0-fix:之前 pattern 2(中文)过宽 — 接受纯数字,误吞英文输入 "9am" / "8pm tonight"
 * 导致 display 掉成 "09:00" 而不是 "Mon 09:00"。现在改成必须带中文时间关键词。
 * 同样对英文 alternation 加入 \b 与长名前置,避免 "mon" 截断 "monday"。
 */
import { useCallback, useMemo } from "react";

const HOUR_MS = 60 * 60 * 1000;

import { recordTelemetry } from "../telemetry-store";

export interface SmartSnoozeResult {
  iso: string;
  /** 显示文案:"下周一 09:00" / "Tonight 18:00" */
  display: string;
  /** 相对现在的小时数,便于 status bar 倒计时。 */
  hoursFromNow: number;
}

const WEEKDAY_CN: Record<string, number> = {
  "周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6, "周日": 0,
  "星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4, "星期五": 5, "星期六": 6, "星期日": 0,
  "礼拜一": 1, "礼拜二": 2, "礼拜三": 3, "礼拜四": 4, "礼拜五": 5, "礼拜六": 6, "礼拜日": 0,
};

const WEEKDAY_EN: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4, th: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

interface ParsedSnooze {
  hour: number;
  minute: number;
  /** 加多少天;0 = 今天,1 = 明天。 */
  addDays: number;
  weekday?: number;
  /** 月末:跳到本月最后一天 17:00。 */
  endOfMonth?: boolean;
  /** 月初:跳到下个月 1 号 09:00。 */
  startOfNextMonth?: boolean;
  display: string;
}

export function resolveSmartSnooze(input: string, baseDate: Date = new Date()): SmartSnoozeResult {
  const parsed = parseChineseTime(input) ?? parseEnglishTime(input);
  if (!parsed) {
    return {
      iso: new Date(baseDate.getTime() + 4 * HOUR_MS).toISOString(),
      display: "4h 后",
      hoursFromNow: 4,
    };
  }
  const target = new Date(baseDate);
  target.setSeconds(0, 0);
  target.setHours(parsed.hour, parsed.minute, 0, 0);
  if (parsed.endOfMonth) {
    // 跳到本月最后一天。
    target.setMonth(target.getMonth() + 1, 0);
  } else if (parsed.startOfNextMonth) {
    // 跳到下个月 1 号。
    target.setMonth(target.getMonth() + 1, 1);
  } else if (parsed.weekday !== undefined) {
    const currentWeekday = target.getDay();
    let delta = (parsed.weekday - currentWeekday + 7) % 7;
    if (delta === 0 && target.getTime() <= baseDate.getTime()) delta = 7;
    target.setDate(target.getDate() + delta);
  } else if (parsed.addDays > 0) {
    target.setDate(target.getDate() + parsed.addDays);
  } else if (target.getTime() <= baseDate.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  const hoursFromNow = (target.getTime() - baseDate.getTime()) / HOUR_MS;
  return {
    iso: target.toISOString(),
    display: parsed.display,
    hoursFromNow: Math.max(0.1, hoursFromNow),
  };
}

function parseChineseTime(input: string): ParsedSnooze | null {
  // Pattern 1: weekday + period + time
  let match = input.match(/(下个?)?(周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天])\s*(早上?|上午|早|中午|下午|晚上|晚)?\s*(\d{1,2})\s*(:(\d{2}))?\s*(点|时)?/);
  if (match) {
    const [, prefix, weekdayStr, period, hourStr, , minuteStr] = match;
    const weekday = WEEKDAY_CN[weekdayStr];
    let hour = parseInt(hourStr!, 10);
    const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
    if (period === "下午" && hour < 12) hour += 12;
    if ((period === "晚上" || period === "晚") && hour < 12) hour += 12;
    if (period === "中午" && hour < 11) hour += 12;
    return {
      hour, minute, addDays: 0, weekday,
      display: `${prefix ?? ""}${weekdayStr} ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
    };
  }
  // Pattern 2: 必须包含中文时间关键词(period / 今晚 / 明天 / 点 / 时),不再吞纯英文数字。
  // 原 bug:"monday 9am" 走这条被误捕成 "09:00"。
  const hasChinesePeriod = /(早上?|上午|早|中午|下午|晚上|晚)/.test(input);
  const hasChineseTimeKeyword = /今晚|晚上|明天|明早|明晚|明日|点|时/.test(input);
  if (hasChinesePeriod || hasChineseTimeKeyword) {
    const hourMin = input.match(/(\d{1,2})(?:\s*[:点时]\s*(\d{1,2}))?/);
    if (hourMin) {
      let hour = parseInt(hourMin[1]!, 10);
      const minute = hourMin[2] ? parseInt(hourMin[2], 10) : 0;
      const periodMatch = input.match(/(早上?|上午|早|中午|下午|晚上|晚)/);
      const period = periodMatch?.[1];
      if (period === "下午" && hour < 12) hour += 12;
      if ((period === "晚上" || period === "晚") && hour < 12) hour += 12;
      if (period === "中午" && hour < 11) hour += 12;
      if (/明天|明早|明晚|明日/.test(input)) {
        return { hour, minute, addDays: 1, display: `明天 ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}` };
      }
      if (/今晚|晚上/.test(input)) {
        return { hour, minute, addDays: 0, display: `今晚 ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}` };
      }
      if (period) {
        return { hour, minute, addDays: 0, display: `${period} ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}` };
      }
    }
  }
  // 周末前 必须放在 周末 之前 — 否则被通用 /周末/ 截胡。
  if (/周末前|周五下午/.test(input)) {
    const hourMatch = input.match(/(\d{1,2})\s*(点|时)/);
    let hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 17;
    if (/下午/.test(input) && hour < 12) hour += 12;
    return { hour, minute: 0, addDays: 0, weekday: 5, display: `周五 ${hour.toString().padStart(2, "0")}:00` };
  }
  if (/周末/.test(input)) {
    const hourMatch = input.match(/(\d{1,2})\s*(点|时)/);
    const hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 10;
    return { hour, minute: 0, addDays: 0, weekday: 6, display: `周六 ${hour.toString().padStart(2, "0")}:00` };
  }
  if (/明天|明早|明晚|明日/.test(input)) {
    const hourMatch = input.match(/(\d{1,2})\s*(点|时)/);
    let hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 9;
    if (/晚/.test(input) && hour < 12) hour += 12;
    return { hour, minute: 0, addDays: 1, display: `明天 ${hour.toString().padStart(2, "0")}:00` };
  }
  if (/今晚|晚上/.test(input)) {
    const hourMatch = input.match(/(\d{1,2})\s*(点|时)/);
    const hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 18;
    return { hour, minute: 0, addDays: 0, display: `今晚 ${hour.toString().padStart(2, "0")}:00` };
  }
  // 第 5 周扩展(P3-7):
  if (/月底|月末/.test(input)) {
    return { hour: 17, minute: 0, addDays: 0, endOfMonth: true, display: `本月最后一天 17:00` };
  }
  if (/下个?月初|下月1号|下月1日/.test(input)) {
    return { hour: 9, minute: 0, addDays: 0, startOfNextMonth: true, display: `下月1号 09:00` };
  }
  if (/月初|月头/.test(input)) {
    return { hour: 9, minute: 0, addDays: 0, startOfNextMonth: true, display: `下月1号 09:00` };
  }
  if (/周末前|周五下午|周五/.test(input) && /下午|点|时/.test(input)) {
    const hourMatch = input.match(/(\d{1,2})\s*(点|时)/);
    let hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 17;
    if (/下午/.test(input) && hour < 12) hour += 12;
    return { hour, minute: 0, addDays: 0, weekday: 5, display: `周五 ${hour.toString().padStart(2, "0")}:00` };
  }
  if (/半个月后|两周后/.test(input)) {
    return { hour: 9, minute: 0, addDays: 14, display: `14 天后 09:00` };
  }
  if (/午饭后|午休后|after lunch/.test(input)) {
    return { hour: 14, minute: 0, addDays: 0, display: `今天 14:00` };
  }
  return null;
}

function parseEnglishTime(input: string): ParsedSnooze | null {
  const lower = input.toLowerCase();
  // 长名前置 + \b 防止 "mon" 截断 "monday"。
  let match = lower.match(/(next\s+)?\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thurs|fri|sat)\b(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (!match) {
    match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+((next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thurs|fri|sat)\b)/);
  }
  if (match) {
    let prefix: string | undefined;
    let weekdayKey: string | undefined;
    let hourStr: string | undefined;
    let minuteStr: string | undefined;
    let ampm: string | undefined;
    if (match[0].includes(" ") && /^\d/.test(match[0])) {
      // time-first 形如 "9am monday" — groups: [hour, minute, ampm, full, next, weekday]
      hourStr = match[1];
      minuteStr = match[2];
      ampm = match[3];
      prefix = match[5];
      weekdayKey = match[6];
    } else {
      // weekday-first 形如 "monday 9am" — groups: [next, weekday, hour, minute, ampm]
      prefix = match[1];
      weekdayKey = match[2];
      hourStr = match[3];
      minuteStr = match[4];
      ampm = match[5];
    }
    if (!weekdayKey) return null;
    const weekday = WEEKDAY_EN[weekdayKey];
    let hour = hourStr ? parseInt(hourStr, 10) : 9;
    const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const fullName = WEEKDAY_LONG_EN[weekdayKey] ?? weekdayKey;
    const leadingPrefix = prefix ? `${prefix} ` : "";
    return {
      hour, minute, addDays: 0, weekday,
      display: `${leadingPrefix}${fullName} ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
    };
  }
  if (/tomorrow/.test(lower)) {
    const hourMatch = lower.match(/(\d{1,2})\s*(am|pm)?/);
    let hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 9;
    if (hourMatch?.[2] === "pm" && hour < 12) hour += 12;
    return { hour, minute: 0, addDays: 1, display: `Tomorrow ${hour.toString().padStart(2, "0")}:00` };
  }
  if (/tonight|this evening/.test(lower)) {
    const hourMatch = lower.match(/(\d{1,2})\s*(am|pm)?/);
    let hour = hourMatch ? parseInt(hourMatch[1]!, 10) : 18;
    const ampm = hourMatch?.[2];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (!ampm && hour < 12) hour += 12;
    return { hour, minute: 0, addDays: 0, display: `Tonight ${hour.toString().padStart(2, "0")}:00` };
  }
  if (/next week/.test(lower)) {
    return { hour: 9, minute: 0, addDays: 7, display: "Next Monday 09:00" };
  }
  // 第 5 周扩展(P3-7):
  if (/end of (the )?month|eom/.test(lower)) {
    return { hour: 17, minute: 0, addDays: 0, endOfMonth: true, display: "End of month 17:00" };
  }
  if (/start of next month|next month start|1st of next month/.test(lower)) {
    return { hour: 9, minute: 0, addDays: 0, startOfNextMonth: true, display: "1st of next month 09:00" };
  }
  if (/start of month|1st of (the )?month/.test(lower)) {
    return { hour: 9, minute: 0, addDays: 0, startOfNextMonth: true, display: "1st of next month 09:00" };
  }
  if (/after lunch|post lunch/.test(lower)) {
    return { hour: 14, minute: 0, addDays: 0, display: "Today 14:00" };
  }
  if (/in two weeks|2 weeks/.test(lower)) {
    return { hour: 9, minute: 0, addDays: 14, display: "In 2 weeks 09:00" };
  }
  return null;
}

const WEEKDAY_LONG_EN: Record<string, string> = {
  sun: "Sun", mon: "Mon", tue: "Tue", tues: "Tue", wed: "Wed", thu: "Thu", thurs: "Thu", fri: "Fri", sat: "Sat",
  sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat",
};

export function useSmartSnooze(): {
  resolve: (input: string, baseDate?: Date) => SmartSnoozeResult;
} {
  const resolve = useCallback((input: string, baseDate?: Date) => resolveSmartSnooze(input, baseDate), []);
  return useMemo(() => ({ resolve }), [resolve]);
}

/**
 * resolveSmartSnoozeWithTelemetry — 在解析成功后记录埋点(用于评估 Smart Snooze 命中率)。
 */
export function resolveSmartSnoozeWithTelemetry(input: string, baseDate: Date = new Date()): SmartSnoozeResult {
  const result = resolveSmartSnooze(input, baseDate);
  recordTelemetry("smart_snooze_resolved", { matched: result !== null, length: input.length });
  return result;
}
