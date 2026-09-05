import { describe, expect, it } from "vitest";
import { auditCommercialModel, costForUsage, pointsForUsage } from "./audit-commercial-model.mjs";

const pricing = [{ model: "MiniMax-M3", inputPointsPerThousand: 12, outputPointsPerThousand: 40, inputCostPerMillion: 2.1, outputCostPerMillion: 8.4, costCurrency: "CNY" }];

describe("OpenBuddy commercial model audit", () => {
  it("uses the Gateway's exact points formula and keeps provider cost separate", () => {
    expect(pointsForUsage(pricing[0], 1_000_000, 1_000_000)).toBe(52_000);
    expect(costForUsage(pricing[0], 1_000_000, 1_000_000)).toBe(10.5);
  });

  it("passes a paid plan with a healthy margin and reports free acquisition cost", () => {
    const report = auditCommercialModel({
      plans: [
        { id: "free", name: "Free", currency: "CNY", priceMinor: 0, points: 100, active: true },
        { id: "team", name: "Team", currency: "CNY", priceMinor: 9900, points: 10000, active: true },
      ],
      pricing,
      targetGrossMarginPercent: 70,
    });
    expect(report.ok).toBe(true);
    expect(report.warnings).toContain("active plan free is free; its provider cost is an acquisition expense");
    expect(report.results.find((entry) => entry.planId === "team")).toMatchObject({ points: 52000, revenueCurrency: "CNY", costCurrency: "CNY" });
  });

  it("fails a paid plan below the configured margin target", () => {
    const report = auditCommercialModel({
      plans: [{ id: "loss-making", name: "Loss", currency: "CNY", priceMinor: 100, points: 100000, active: true }],
      pricing,
      targetGrossMarginPercent: 70,
    });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain("gross margin");
  });

  it("fails when one token direction is underpriced even if the blended scenario looks healthy", () => {
    const report = auditCommercialModel({
      plans: [{ id: "imbalanced", name: "Imbalanced", currency: "CNY", priceMinor: 9900, points: 10000, active: true }],
      pricing: [{ model: "imbalanced-model", inputPointsPerThousand: 1, outputPointsPerThousand: 1000, inputCostPerMillion: 100, outputCostPerMillion: 0.1, costCurrency: "CNY" }],
      targetGrossMarginPercent: 70,
    });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain("gross margin");
  });

  it("rejects an entitlement lifetime outside the Gateway contract", () => {
    expect(() => auditCommercialModel({
      plans: [{ id: "team", name: "Team", currency: "CNY", priceMinor: 9900, points: 10000, entitlementsValidDays: 3651, active: true }],
      pricing,
    })).toThrow("at most 3650");
  });

  it("validates optional entitlement lifetime as an independent commercial dimension", () => {
    const report = auditCommercialModel({
      plans: [{ id: "team", name: "Team", currency: "CNY", priceMinor: 9900, points: 10000, entitlementsValidDays: 90, active: true }],
      pricing,
      targetGrossMarginPercent: 70,
    });
    expect(report.ok).toBe(true);
    expect(report.warnings).toHaveLength(0);
  });

  it("fails closed on missing provider costs", () => {
    expect(() => auditCommercialModel({ plans: [{ id: "team", name: "Team", currency: "CNY", priceMinor: 9900, points: 10000 }], pricing: [{ model: "MiniMax-M3", inputPointsPerThousand: 12, outputPointsPerThousand: 40 }] })).toThrow("requires non-negative");
  });
});
