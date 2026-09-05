import { describe, expect, it } from "vitest"
import { extractEmailActionCandidates } from "./index"

const message = (id: string) => ({ id, from: "alice@example.com", date: "2026-09-01T10:00:00.000Z" })

describe("extractEmailActionCandidates", () => {
  it("returns noise for newsletter-style content", () => {
    const result = extractEmailActionCandidates({
      subject: "InfoQ 中文站 - 本周精选",
      body: "本周精选：1) OpenAI 发布 GPT-5 评测；2) Cloudflare Workers AI 价格调整；3) Rust 1.81 发布。",
      messages: [message("m-noise-1")],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(result.noise).toBe(true)
    expect(result.actions).toHaveLength(0)
    expect(result.stats.droppedNoise).toBe(1)
  })

  it("returns empty for rejection emails", () => {
    const result = extractEmailActionCandidates({
      subject: "Re: 报价回复",
      body: "经过评估，贵司报价高于预算 15%，本期暂不采购。未来有需要再联系。",
      messages: [message("m-reject-1")],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(result.actions).toHaveLength(0)
    expect(result.stats.droppedRejected).toBe(1)
  })

  it("returns empty for cancelled meetings", () => {
    const result = extractEmailActionCandidates({
      subject: "取消：原定周四的方案评审",
      body: "由于前置数据未到位，原定周四的方案评审取消，新时间稍后通知。",
      messages: [message("m-cancel-1")],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(result.actions).toHaveLength(0)
    expect(result.stats.droppedPassiveFollowup).toBe(1)
  })

  it("extracts imperative actions with absolute dates", () => {
    const result = extractEmailActionCandidates({
      subject: "Re: 2026 Q3 产品报价咨询",
      body: "您好，附件是我方对贵司 A100 产品的正式询价单（含 50 件、目标交付 9 月 15 日）。请于本周内反馈含税报价与付款条款。",
      messages: [message("m-quote-a")],
      baseDate: new Date("2026-08-30T00:00:00.000Z"),
    })
    expect(result.noise).toBe(false)
    expect(result.actions.length).toBeGreaterThan(0)
    const action = result.actions[0]!
    expect(action.messageId).toBe("m-quote-a")
    expect(action.owner).toBe("我")
    expect(action.citations.length).toBe(1)
    expect(action.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("uses LLM-provided phrases when supplied (real Pi Agent path)", () => {
    const result = extractEmailActionCandidates({
      subject: "Re: 8 月发票存在异议",
      body: "8 月发票 INV-088 金额与我方收货记录不一致，差额 1200 元。请核对并回复。",
      messages: [message("m-inv-a")],
      phrases: ["核对发票并回复差额"],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    const llmPhrase = result.actions.find((action) => action.source === "llm-phrase")
    expect(llmPhrase).toBeDefined()
    expect(llmPhrase!.confidence).toBeGreaterThanOrEqual(0.85)
    expect(llmPhrase!.messageId).toBe("m-inv-a")
  })

  it("truncates overly long content to 30 chars", () => {
    const result = extractEmailActionCandidates({
      subject: "Re: 长任务",
      body: "请帮我把这一段非常非常非常非常非常长的任务内容仔细地完整地执行一遍并附上截图说明",
      messages: [message("m-long-1")],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(result.actions.length).toBeGreaterThan(0)
    expect(result.actions[0]!.content.length).toBeLessThanOrEqual(30)
  })

  it("returns at most 5 candidates per email", () => {
    const result = extractEmailActionCandidates({
      subject: "多项任务",
      body: "请做A。请做B。请做C。请做D。请做E。请做F。请做G。",
      messages: [message("m-many-1")],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(result.actions.length).toBeLessThanOrEqual(5)
  })

  it("falls back to a synthesized messageId when no messages provided", () => {
    const result = extractEmailActionCandidates({
      subject: "请求",
      body: "请确认",
      messages: [],
      baseDate: new Date("2026-09-02T00:00:00.000Z"),
    })
    expect(result.actions.length).toBeGreaterThan(0)
    expect(result.actions[0]!.messageId.startsWith("m-")).toBe(true)
  })
})
