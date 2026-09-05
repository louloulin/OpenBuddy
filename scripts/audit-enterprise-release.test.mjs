import { describe, expect, it } from "vitest";
import { auditEnterpriseRelease } from "./audit-enterprise-release.mjs";

const snapshot = {
  schema: "openbuddy.new-api-capability-snapshot.v1",
  generatedAt: "2026-08-30T00:00:00.000Z",
  status: { quotaPerUnit: 500000 },
  groups: [{ name: "default" }],
  models: [{ id: "MiniMax-M3" }],
  channels: [{ id: "2", group: "default", models: ["MiniMax-M3"] }],
};

const commercialModel = {
  targetGrossMarginPercent: 70,
  plans: [{ id: "team", name: "Team", priceMinor: 10000, points: 100000, currency: "CNY" }],
  pricing: { "MiniMax-M3": { inputPointsPerThousand: 20, outputPointsPerThousand: 80, inputCostPerMillion: 2.1, outputCostPerMillion: 8.4, costCurrency: "CNY" } },
};

const capabilities = { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-30" } } } };
const reconciliationStatus = { schemaVersion: 1, runId: "reconciliation-test", status: "succeeded", completedAt: "2026-08-30T05:00:00.000Z" };

describe("enterprise release audit", () => {
  it("passes a complete HTTPS production evidence set", async () => {
    const report = await auditEnterpriseRelease({
      snapshot,
      commercialModel,
      capabilities,
      reconciliationStatus,
      expectedGatewayVersion: "release",
      mode: "production",
      now: Date.parse("2026-08-30T06:00:00.000Z"),
      gatewayUrl: "https://gateway.example.com",
      newApiBaseUrl: "https://new-api.example.com",
      casdoorIssuer: "https://casdoor.example.com",
      gatewayHealth: { status: "ok", data: { ok: true, store: "postgres", version: "release" } },
      expectedGroups: ["default"],
      expectedModels: ["MiniMax-M3"],
      expectedChannels: ["2"],
    });
    expect(report.ok).toBe(true);
    expect(report.failures).toBe(0);
    expect(report.blocked).toBe(0);
  });

  it("fails production readiness for HTTP and missing external evidence", async () => {
    const report = await auditEnterpriseRelease({ snapshot, commercialModel, capabilities, reconciliationStatus, expectedGatewayVersion: "b796ced3da69", mode: "production", now: Date.parse("2026-08-30T06:00:00.000Z"), gatewayUrl: "http://127.0.0.1:8787", newApiBaseUrl: "http://124.221.146.145:3000", casdoorIssuer: "http://124.221.146.145:8000" });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((item) => item.status === "failed").map((item) => item.name)).toEqual(expect.arrayContaining(["openbuddy.gateway-transport", "new_api_base_url.transport", "casdoor_issuer.transport", "openbuddy.gateway-health"]));
  });

  it("fails production readiness when reconciliation has no fresh success", async () => {
    const report = await auditEnterpriseRelease({ snapshot, commercialModel, capabilities, expectedGatewayVersion: "release", mode: "production", now: Date.parse("2026-08-30T06:00:00.000Z"), gatewayUrl: "https://gateway.example.com", newApiBaseUrl: "https://new-api.example.com", casdoorIssuer: "https://casdoor.example.com", gatewayHealth: { status: "ok", data: { ok: true, version: "release" } } });
    expect(report.ok).toBe(false);
    expect(report.checks.find((item) => item.name === "openbuddy.reconciliation-heartbeat")).toMatchObject({ status: "failed" });
  });

  it("applies the reconciliation freshness limit independently from capability freshness", async () => {
    const report = await auditEnterpriseRelease({ snapshot, commercialModel, capabilities, reconciliationStatus, expectedGatewayVersion: "release", reconciliationMaxAgeHours: 1, mode: "production", now: Date.parse("2026-08-30T06:01:00.000Z"), gatewayUrl: "https://gateway.example.com", newApiBaseUrl: "https://new-api.example.com", casdoorIssuer: "https://casdoor.example.com", gatewayHealth: { status: "ok", data: { ok: true, version: "release" } } });
    expect(report.checks.find((item) => item.name === "openbuddy.reconciliation-heartbeat")).toMatchObject({ status: "failed", detail: "reconciliation status is older than 1 hours" });
  });

  it("keeps development mode explicit when external evidence is omitted", async () => {
    const report = await auditEnterpriseRelease({ snapshot, commercialModel, capabilities, mode: "development", now: Date.parse("2026-08-30T06:00:00.000Z") });
    expect(report.ok).toBe(false);
    expect(report.blocked).toBe(5);
    expect(report.checks.filter((item) => item.status === "failed")).toHaveLength(0);
  });

  it("reports an unavailable Gateway without leaking network details", async () => {
    const report = await auditEnterpriseRelease({
      snapshot,
      commercialModel,
      capabilities,
      reconciliationStatus,
      expectedGatewayVersion: "dev",
      mode: "development",
      now: Date.parse("2026-08-30T06:00:00.000Z"),
      gatewayUrl: "http://127.0.0.1:1",
      newApiBaseUrl: "http://new-api.test",
      casdoorIssuer: "http://casdoor.test",
      gatewayHealth: { status: "error", data: { ok: false } },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((item) => item.name === "openbuddy.gateway-health")).toMatchObject({ status: "failed", detail: "Gateway health payload is not ready" });
  });

  it("blocks models discovered in New API until pricing is explicitly configured", async () => {
    const report = await auditEnterpriseRelease({ snapshot: { ...snapshot, models: [...snapshot.models, { id: "deepseek-v4-pro" }] }, commercialModel, capabilities, mode: "development", now: Date.parse("2026-08-30T06:00:00.000Z") });
    expect(report.checks.find((item) => item.name === "openbuddy.model-commercial-coverage")).toMatchObject({ status: "blocked", detail: "missing pricing or exclusion for deepseek-v4-pro" });
  });

  it("fails closed when a supported model lacks verified usage evidence", async () => {
    const report = await auditEnterpriseRelease({ snapshot, commercialModel, capabilities: { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "optional", verifiedAt: "2026-08-30" } } } }, reconciliationStatus, expectedGatewayVersion: "release", mode: "production", now: Date.parse("2026-08-30T06:00:00.000Z"), gatewayUrl: "https://gateway.example.com", newApiBaseUrl: "https://new-api.example.com", casdoorIssuer: "https://casdoor.example.com", gatewayHealth: { status: "ok", data: { ok: true, version: "release" } } });
    expect(report.checks.find((item) => item.name === "new-api.capability-snapshot")).toMatchObject({ status: "failed" });
  });

  it("fails production readiness when the running Gateway version drifts", async () => {
    const report = await auditEnterpriseRelease({ snapshot, commercialModel, capabilities, reconciliationStatus, expectedGatewayVersion: "b796ced3da69", mode: "production", now: Date.parse("2026-08-30T06:00:00.000Z"), gatewayUrl: "https://gateway.example.com", newApiBaseUrl: "https://new-api.example.com", casdoorIssuer: "https://casdoor.example.com", gatewayHealth: { status: "ok", data: { ok: true, version: "b253c81" } } });
    expect(report.checks.find((item) => item.name === "openbuddy.gateway-version")).toMatchObject({ status: "failed" });
  });
});
