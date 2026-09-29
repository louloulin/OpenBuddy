/**
 * @openbuddy/ui-audit-center/types — 纯过滤/统计契约测试。
 *
 * 覆盖:
 *   - filterAuditEvents:source / outcome / event / subject / 时间范围 6 维
 *   - summarizeAuditEvents:总数 + 按 source / outcome 分桶
 *   - formatAuditAt / formatAuditDetail:展示格式化
 *   - toggleSource / toggleOutcome:工厂函数
 *   - isFiltersEmpty:状态判定
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_OUTCOMES,
  AUDIT_SOURCES,
  EMPTY_FILTERS,
  filterAuditEvents,
  formatAuditAt,
  formatAuditDetail,
  isFiltersEmpty,
  OUTCOME_LABEL,
  SOURCE_LABEL,
  summarizeAuditEvents,
  toggleOutcome,
  toggleSource,
  type AuditEvent,
  type AuditFilters,
  type AuditSource,
} from "../types.js";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "e-1",
    at: "2026-09-24T10:00:00.000Z",
    event: "settings.open",
    outcome: "info",
    source: "renderer",
    subject: "user-1",
    detail: { ip: "127.0.0.1" },
    hash: "h-1",
    ...overrides,
  };
}

const sampleEvents: AuditEvent[] = [
  makeEvent({ id: "e1", at: "2026-09-24T08:00:00.000Z", event: "settings.open", outcome: "info", source: "renderer" }),
  makeEvent({ id: "e2", at: "2026-09-24T09:00:00.000Z", event: "auth.login", outcome: "success", source: "main", subject: "user-1" }),
  makeEvent({ id: "e3", at: "2026-09-24T10:00:00.000Z", event: "permission.deny", outcome: "deny", source: "ipc", subject: "user-1", detail: { tool: "bash" } }),
  makeEvent({ id: "e4", at: "2026-09-24T11:00:00.000Z", event: "permission.allow", outcome: "allow", source: "plugin" }),
  makeEvent({ id: "e5", at: "2026-09-24T12:00:00.000Z", event: "casdoor.authorize", outcome: "deny", source: "casdoor", subject: "tenant-a" }),
];

// ===========================================================================
// filterAuditEvents
// ===========================================================================

describe("filterAuditEvents — 多维过滤", () => {
  it("空 filters = 返回全部", () => {
    expect(filterAuditEvents(sampleEvents, EMPTY_FILTERS)).toEqual(sampleEvents);
  });

  it("按 source 过滤:多选 = 任一命中即可", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, sources: ["main", "ipc"] });
    expect(r.map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("按 source 过滤:不存在的 source → 空数组", () => {
    // type 层不接受任意 string;但运行时 sourceSet.has() 对未知字符串返回 false
    expect(filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, sources: ["unknown" as AuditSource] })).toEqual([]);
  });

  it("按 outcome 过滤:deny 命中 e3 + e5", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, outcomes: ["deny"] });
    expect(r.map((e) => e.id)).toEqual(["e3", "e5"]);
  });

  it("event 子串匹配:大小写不敏感", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, eventQuery: "PERMISSION" });
    expect(r.map((e) => e.id)).toEqual(["e3", "e4"]);
  });

  it("event 子串匹配:前后空格被忽略", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, eventQuery: "   permission   " });
    expect(r.map((e) => e.id)).toEqual(["e3", "e4"]);
  });

  it("event 空查询(全空白) = 不过滤", () => {
    expect(filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, eventQuery: "   " })).toEqual(sampleEvents);
  });

  it("subject 子串匹配:大小写不敏感,只保留匹配的", () => {
    // sampleEvents 中 e2/e3 subject="user-1",e5 subject="tenant-a"
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, subjectQuery: "user" });
    expect(r.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("subject 子串匹配:查询 tenant 时只命中 e5", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, subjectQuery: "tenant" });
    expect(r.map((e) => e.id)).toEqual(["e5"]);
  });

  it("时间范围:from 闭区间", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, fromIso: "2026-09-24T10:00:00.000Z" });
    expect(r.map((e) => e.id)).toEqual(["e3", "e4", "e5"]);
  });

  it("时间范围:to 闭区间", () => {
    const r = filterAuditEvents(sampleEvents, { ...EMPTY_FILTERS, toIso: "2026-09-24T09:00:00.000Z" });
    expect(r.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("时间范围:from + to 同时(窗口 [09:00, 11:00] 闭区间)", () => {
    const r = filterAuditEvents(sampleEvents, {
      ...EMPTY_FILTERS,
      fromIso: "2026-09-24T09:00:00.000Z",
      toIso: "2026-09-24T11:00:00.000Z",
    });
    expect(r.map((e) => e.id)).toEqual(["e2", "e3", "e4"]);
  });

  it("组合过滤:source + outcome + eventQuery 三维联合", () => {
    const r = filterAuditEvents(sampleEvents, {
      ...EMPTY_FILTERS,
      sources: ["ipc"],
      outcomes: ["deny"],
      eventQuery: "permission",
    });
    expect(r.map((e) => e.id)).toEqual(["e3"]);
  });

  it("非法时间字符串:实现选择不抛 + 非法 at 视为无时间过滤", () => {
    // 当前实现:非法 at → atMs=NaN → 不进入时间范围判断 → 直接保留
    // 理由:用户可能手工导入历史数据,at 字段可能是 epoch 或空,粗暴丢弃不友好
    const events = [
      makeEvent({ id: "x", at: "not-an-iso" }),
      makeEvent({ id: "y", at: "2026-09-24T10:00:00.000Z" }),
    ];
    const r = filterAuditEvents(events, { ...EMPTY_FILTERS, fromIso: "also-bad" });
    expect(r.map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("空 events 数组返回空数组(无 throw)", () => {
    expect(filterAuditEvents([], EMPTY_FILTERS)).toEqual([]);
  });
});

// ===========================================================================
// summarizeAuditEvents
// ===========================================================================

describe("summarizeAuditEvents — 统计分桶", () => {
  it("空数组:total=0,所有 bucket=0", () => {
    const s = summarizeAuditEvents([]);
    expect(s.total).toBe(0);
    for (const src of AUDIT_SOURCES) expect(s.bySource[src]).toBe(0);
    for (const out of AUDIT_OUTCOMES) expect(s.byOutcome[out]).toBe(0);
  });

  it("sample 数据:source / outcome 桶计数正确", () => {
    const s = summarizeAuditEvents(sampleEvents);
    expect(s.total).toBe(5);
    expect(s.bySource.renderer).toBe(1);
    expect(s.bySource.main).toBe(1);
    expect(s.bySource.ipc).toBe(1);
    expect(s.bySource.plugin).toBe(1);
    expect(s.bySource.casdoor).toBe(1);
    expect(s.byOutcome.deny).toBe(2);
    expect(s.byOutcome.info).toBe(1);
    expect(s.byOutcome.success).toBe(1);
    expect(s.byOutcome.allow).toBe(1);
    expect(s.byOutcome.failure).toBe(0);
  });
});

// ===========================================================================
// 格式化函数
// ===========================================================================

describe("formatAuditAt — 时间本地化", () => {
  it("合法 ISO 输出 YYYY-MM-DD HH:mm:ss(本地时区)", () => {
    // 不绑定具体时区,只验证格式
    expect(formatAuditAt("2026-09-24T10:00:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("非法 ISO 原样返回", () => {
    expect(formatAuditAt("not-an-iso")).toBe("not-an-iso");
  });
});

describe("formatAuditDetail — detail JSON 化", () => {
  it("无 detail → '—'", () => {
    expect(formatAuditDetail(undefined)).toBe("—");
  });

  it("空对象 → '{}'", () => {
    expect(formatAuditDetail({})).toBe("{}");
  });

  it("正常对象 → JSON.stringify", () => {
    expect(formatAuditDetail({ ip: "1.2.3.4", port: 8080 })).toBe('{"ip":"1.2.3.4","port":8080}');
  });
});

// ===========================================================================
// 工厂函数 / 状态判定
// ===========================================================================

describe("toggleSource / toggleOutcome — 工厂函数", () => {
  it("toggleSource:不存在的 source 加入", () => {
    const next = toggleSource(EMPTY_FILTERS, "main");
    expect(next.sources).toEqual(["main"]);
  });

  it("toggleSource:已存在的 source 移除", () => {
    const next = toggleSource({ ...EMPTY_FILTERS, sources: ["main", "ipc"] }, "main");
    expect(next.sources).toEqual(["ipc"]);
  });

  it("toggleSource:不影响其他字段(outcomes/eventQuery 等原样)", () => {
    const f: AuditFilters = { ...EMPTY_FILTERS, outcomes: ["deny"], eventQuery: "x" };
    const next = toggleSource(f, "main");
    expect(next.outcomes).toEqual(["deny"]);
    expect(next.eventQuery).toBe("x");
  });

  it("toggleOutcome:行为对称", () => {
    const next = toggleOutcome(EMPTY_FILTERS, "deny");
    expect(next.outcomes).toEqual(["deny"]);
    const again = toggleOutcome(next, "deny");
    expect(again.outcomes).toEqual([]);
  });
});

describe("isFiltersEmpty — 状态判定", () => {
  it("EMPTY_FILTERS 是空", () => {
    expect(isFiltersEmpty(EMPTY_FILTERS)).toBe(true);
  });

  it("有任何 source → 非空", () => {
    expect(isFiltersEmpty({ ...EMPTY_FILTERS, sources: ["main"] })).toBe(false);
  });

  it("有非空白 query → 非空", () => {
    expect(isFiltersEmpty({ ...EMPTY_FILTERS, eventQuery: "x" })).toBe(false);
  });

  it("纯空白 query 视为空", () => {
    expect(isFiltersEmpty({ ...EMPTY_FILTERS, eventQuery: "   " })).toBe(true);
  });

  it("有 fromIso → 非空", () => {
    expect(isFiltersEmpty({ ...EMPTY_FILTERS, fromIso: "2026-01-01" })).toBe(false);
  });
});

// ===========================================================================
// 静态标签 / 枚举完整性
// ===========================================================================

describe("静态标签映射", () => {
  it("OUTCOME_LABEL 覆盖所有 AUDIT_OUTCOMES", () => {
    for (const o of AUDIT_OUTCOMES) {
      expect(OUTCOME_LABEL[o]).toBeTruthy();
    }
  });

  it("SOURCE_LABEL 覆盖所有 AUDIT_SOURCES", () => {
    for (const s of AUDIT_SOURCES) {
      expect(SOURCE_LABEL[s]).toBeTruthy();
    }
  });

  it("AUDIT_OUTCOMES / AUDIT_SOURCES 不可为空", () => {
    expect(AUDIT_OUTCOMES.length).toBeGreaterThan(0);
    expect(AUDIT_SOURCES.length).toBeGreaterThan(0);
  });
});
