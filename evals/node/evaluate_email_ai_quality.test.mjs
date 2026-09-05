import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = path.join(process.cwd(), "evals/node/evaluate_email_ai_quality.mjs");
const dataset = path.join(process.cwd(), "evals/datasets/email_ai_quality_cases.json");

async function run(predictions, extraEnv = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openbuddy-email-ai-quality-"));
  const predictionsPath = path.join(directory, "predictions.json");
  await writeFile(predictionsPath, JSON.stringify(predictions));
  try {
    const result = await execFileAsync(process.execPath, [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENBUDDY_EMAIL_AI_QUALITY_DATASET: dataset,
        OPENBUDDY_EMAIL_AI_QUALITY_PREDICTIONS: predictionsPath,
        ...extraEnv,
      },
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ...result, exitCode: 0 };
  } catch (error) {
    return { ...error, exitCode: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function outputOf(result) {
  return JSON.parse(result.stdout || "{}");
}

describe("email AI quality evaluation", () => {
// All expected actions, as predicted by the fixture dataset. Used to exercise
// the metrics pipeline against the full 51-case dataset.
const allPredictions = [
      { id: "quote-request-customer-a", actions: [{ content: "回复报价单与付款条款", owner: "我", dueAt: "2026-09-04", messageId: "m-quote-a" }] },
      { id: "quote-followup-b", actions: [{ content: "回复报价是否确认", owner: "我", dueAt: "2026-09-04", messageId: "m-quote-b" }] },
      { id: "contract-approval-pending", actions: [{ content: "审批框架协议 v3 并回签", owner: "我", dueAt: "2026-09-05", messageId: "m-contract-a" }] },
      { id: "quote-negotiation", actions: [{ content: "回复是否接受降价", owner: "我", dueAt: "2026-09-04", messageId: "m-quote-c" }] },
      { id: "contract-renewal", actions: [{ content: "回复续签流程与新报价", owner: "我", dueAt: "2026-09-15", messageId: "m-contract-b" }] },
      { id: "purchase-order-confirm", actions: [{ content: "确认 PO 交付日期", owner: "我", dueAt: "2026-09-06", messageId: "m-po-a" }] },
      { id: "invoice-dispute", actions: [{ content: "核对发票并回复差额", owner: "我", dueAt: "2026-09-04", messageId: "m-inv-a" }] },
      { id: "rfi-product-spec", actions: [{ content: "回复认证证书与规格书", owner: "我", dueAt: "2026-09-07", messageId: "m-rfi-a" }] },
      { id: "quote-rejected", actions: [] },
      { id: "quote-accepted", actions: [{ content: "提供采购合同与发票模板", owner: "我", dueAt: "2026-09-04", messageId: "m-quote-win" }] },
      { id: "meeting-proposal-1", actions: [{ content: "回复是否可参加启动会", owner: "我", dueAt: "2026-09-03", messageId: "m-meet-a" }] },
      { id: "meeting-reschedule-conflict", actions: [{ content: "回复改期时间", owner: "我", dueAt: "2026-09-03", messageId: "m-meet-b" }] },
      { id: "meeting-accept", actions: [{ content: "发送评审材料", owner: "我", dueAt: "2026-09-02", messageId: "m-meet-c" }] },
      { id: "meeting-cancel", actions: [] },
      { id: "meeting-join-info", actions: [{ content: "加入周三会议", owner: "我", dueAt: "2026-09-03", messageId: "m-meet-d" }] },
      { id: "meeting-recap", actions: [{ content: "审阅会议纪要并确认行动项", owner: "我", dueAt: "2026-09-04", messageId: "m-meet-e" }] },
      { id: "meeting-customer-on-site", actions: [{ content: "回复现场拜访安排", owner: "我", dueAt: "2026-09-05", messageId: "m-meet-f" }] },
      { id: "meeting-demo", actions: [{ content: "回复 demo 时间", owner: "我", dueAt: "2026-09-04", messageId: "m-meet-g" }] },
      { id: "meeting-quarterly-review", actions: [{ content: "准备 Q3 评审材料", owner: "我", dueAt: "2026-09-13", messageId: "m-meet-h" }] },
      { id: "meeting-training", actions: [{ content: "回复是否参加培训", owner: "我", dueAt: "2026-09-20", messageId: "m-meet-i" }] },
      { id: "task-urgent-deploy", actions: [{ content: "回滚生产到 v2.3.0", owner: "我", dueAt: "2026-09-02", messageId: "m-urgent-a" }] },
      { id: "task-review-pr", actions: [{ content: "Review PR #1248", owner: "我", dueAt: "2026-09-03", messageId: "m-pr-a" }] },
      { id: "task-data-export", actions: [{ content: "导出 9 月分诊数据", owner: "我", dueAt: "2026-09-08", messageId: "m-data-a" }] },
      { id: "task-bug-triage", actions: [{ content: "修复 Bug #891 附件下载", owner: "我", dueAt: "2026-09-05", messageId: "m-bug-a" }] },
      { id: "task-doc-update", actions: [{ content: "补充批量管理 API 文档", owner: "我", dueAt: "2026-09-06", messageId: "m-doc-a" }] },
      { id: "task-translate", actions: [{ content: "翻译 README 为英文", owner: "我", dueAt: "2026-09-15", messageId: "m-translate-a" }] },
      { id: "task-perf-review", actions: [{ content: "提交邮件列表性能优化方案", owner: "我", dueAt: "2026-09-09", messageId: "m-perf-a" }] },
      { id: "task-release-notes", actions: [{ content: "撰写 v2.4 Release Notes", owner: "我", dueAt: "2026-09-05", messageId: "m-release-a" }] },
      { id: "task-onboard", actions: [{ content: "为新员工开通邮箱与权限", owner: "我", dueAt: "2026-09-07", messageId: "m-onboard-a" }] },
      { id: "task-vendor-renew", actions: [{ content: "确认 AWS 续费预算", owner: "我", dueAt: "2026-09-20", messageId: "m-renew-a" }] },
      { id: "info-newsletter-industry", actions: [] },
      { id: "info-build-notification", actions: [] },
      { id: "info-monitoring", actions: [] },
      { id: "info-team-announce", actions: [] },
      { id: "info-blog-post", actions: [] },
      { id: "info-webinar-invite", actions: [] },
      { id: "info-version-release", actions: [] },
      { id: "info-thanks", actions: [] },
      { id: "complaint-service-slow", actions: [{ content: "回复工单 #4421", owner: "我", dueAt: "2026-09-03", messageId: "m-comp-a" }] },
      { id: "complaint-quality-issue", actions: [{ content: "安排 RMA 流程", owner: "我", dueAt: "2026-09-04", messageId: "m-comp-b" }] },
      { id: "complaint-billing-error", actions: [{ content: "提供 9 月账单明细", owner: "我", dueAt: "2026-09-05", messageId: "m-comp-c" }] },
      { id: "complaint-spam-from-us", actions: [{ content: "检查发件域名信誉与认证", owner: "我", dueAt: "2026-09-04", messageId: "m-comp-d" }] },
      { id: "complaint-security", actions: [{ content: "回复安全事件调查", owner: "我", dueAt: "2026-09-03", messageId: "m-comp-e" }] },
      { id: "followup-pending-decision", actions: [] },
      { id: "followup-payment-overdue", actions: [{ content: "跟进 7 月账款付款", owner: "我", dueAt: "2026-09-04", messageId: "m-fu-a" }] },
      { id: "followup-quote-pending", actions: [] },
      { id: "followup-shipment", actions: [] },
      { id: "followup-onboarding-progress", actions: [{ content: "完成 Zhang San 邮箱与门禁", owner: "我", dueAt: "2026-09-04", messageId: "m-fu-b" }] },
      { id: "social-invite-conference", actions: [{ content: "回复演讲邀请", owner: "我", dueAt: "2026-09-15", messageId: "m-soc-a" }] },
      { id: "social-thanks-birthday", actions: [] },
      { id: "social-referral", actions: [{ content: "审阅候选人简历", owner: "我", dueAt: "2026-09-08", messageId: "m-soc-b" }] },
    ];
  it("reports v2 metrics and passes a complete fixture prediction", async () => {
    const result = await run(allPredictions);
    expect(result.exitCode).toBe(0);
    const report = outputOf(result);
    expect(report.schema).toBe("openbuddy.email-ai-quality.v2");
    expect(report.metrics).toMatchObject({ actionPrecision: 1, actionRecall: 1, dueDateAccuracy: 1, citationCoverage: 1, noActionAccuracy: 1 });
    expect(report.qualityGate).toMatchObject({ passed: true, failures: [], missingPredictionCases: [] });
  });

  it("fails closed when a case prediction is missing under the quality gate", async () => {
    const withoutOne = allPredictions.filter((prediction) => prediction.id !== "info-newsletter-industry");
    const result = await run(withoutOne, { OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS: "1" });
    expect(result.exitCode).toBe(1);
    const report = outputOf(result);
    expect(report.qualityGate.failures).toContain("missing-predictions");
    expect(report.qualityGate.missingPredictionCases).toEqual(["info-newsletter-industry"]);
  });

  it("rejects malformed actions instead of silently scoring them", async () => {
    const corrupted = allPredictions.map((prediction) => prediction.id === "quote-followup-b"
      ? { id: prediction.id, actions: [{ content: "回复报价是否确认", dueAt: "tomorrow", messageId: "m-quote-b" }] }
      : prediction);
    const result = await run(corrupted, { OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS: "1" });
    expect(result.exitCode).toBe(1);
    const report = outputOf(result);
    expect(report.qualityGate.failures).toContain("invalid-predictions");
    expect(report.qualityGate.invalidPredictionCount).toBe(1);
  });

  it("does not penalize metrics with no predicted-action denominator", async () => {
    const empty = allPredictions.map((prediction) => ({ id: prediction.id, actions: [] }));
    const result = await run(empty);
    expect(result.exitCode).toBe(0);
    const report = outputOf(result);
    expect(report.metrics).toMatchObject({ citationCoverage: 1, citationAccuracy: 1, noActionAccuracy: 1 });
    expect(report.metrics.dueDateAccuracy).toBe(0);
  });
});
