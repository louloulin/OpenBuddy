#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const number = (value, fallback = undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInteger = (value, name) => {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`);
  return parsed;
};

const nonNegativeInteger = (value, name) => {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return parsed;
};

const validDays = (value, name) => {
  const parsed = positiveInteger(value, name);
  if (parsed > 3650) throw new Error(`${name} must be at most 3650`);
  return parsed;
};

const currency = (value, fallback = "CNY") => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : fallback;
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("currency must be an ISO 4217 code");
  return normalized;
};

const unique = (values) => [...new Set(values)];

const normalizePlans = (value) => {
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
  return entries.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("each plan must be an object");
    const plan = raw;
    const id = typeof plan.id === "string" ? plan.id.trim() : "";
    const name = typeof plan.name === "string" ? plan.name.trim() : id;
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) throw new Error(`invalid plan id: ${id || "<empty>"}`);
    const priceMinor = nonNegativeInteger(plan.priceMinor, `${id}.priceMinor`);
    const points = positiveInteger(plan.points, `${id}.points`);
    const planCurrency = currency(plan.currency);
    const pointsValidDays = plan.pointsValidDays === undefined ? undefined : validDays(plan.pointsValidDays, `${id}.pointsValidDays`);
    const entitlementsValidDays = plan.entitlementsValidDays === undefined ? undefined : validDays(plan.entitlementsValidDays, `${id}.entitlementsValidDays`);
    return { id, name, priceMinor, points, currency: planCurrency, active: plan.active !== false, ...(pointsValidDays === undefined ? {} : { pointsValidDays }), ...(entitlementsValidDays === undefined ? {} : { entitlementsValidDays }) };
  });
};

const normalizePricing = (value) => {
  const entries = Array.isArray(value) ? value.map((item) => [item?.model, item]) : value && typeof value === "object" ? Object.entries(value) : [];
  return entries.map(([key, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`invalid pricing entry: ${key}`);
    const pricing = raw;
    const model = typeof pricing.model === "string" && pricing.model.trim() ? pricing.model.trim() : String(key).trim();
    if (!model || model.length > 200) throw new Error("pricing model must be non-empty and at most 200 characters");
    const inputPointsPerThousand = positiveInteger(pricing.inputPointsPerThousand, `${model}.inputPointsPerThousand`);
    const outputPointsPerThousand = positiveInteger(pricing.outputPointsPerThousand, `${model}.outputPointsPerThousand`);
    const inputCostPerMillion = number(pricing.inputCostPerMillion);
    const outputCostPerMillion = number(pricing.outputCostPerMillion);
    if (inputCostPerMillion === undefined || inputCostPerMillion < 0 || outputCostPerMillion === undefined || outputCostPerMillion < 0) {
      throw new Error(`${model} requires non-negative inputCostPerMillion and outputCostPerMillion`);
    }
    return { model, inputPointsPerThousand, outputPointsPerThousand, inputCostPerMillion, outputCostPerMillion, costCurrency: currency(pricing.costCurrency) };
  });
};

export const pointsForUsage = (pricing, promptTokens, completionTokens) => {
  const prompt = nonNegativeInteger(promptTokens, "promptTokens");
  const completion = Number.isSafeInteger(Number(completionTokens)) && Number(completionTokens) >= 0 ? Number(completionTokens) : 0;
  return Math.max(1, Math.ceil(prompt * pricing.inputPointsPerThousand / 1000) + Math.ceil(completion * pricing.outputPointsPerThousand / 1000));
};

export const costForUsage = (pricing, promptTokens, completionTokens) => Number(((promptTokens * pricing.inputCostPerMillion + completionTokens * pricing.outputCostPerMillion) / 1_000_000).toFixed(9));

export const auditCommercialModel = ({ plans, pricing, scenarios = [{ name: "balanced-1m", promptTokens: 1_000_000, completionTokens: 1_000_000 }], targetGrossMarginPercent = 70 }) => {
  const normalizedPlans = normalizePlans(plans);
  const normalizedPricing = normalizePricing(pricing);
  const models = unique(normalizedPricing.map((entry) => entry.model));
  const errors = [];
  const warnings = [];
  const ids = new Set();
  for (const plan of normalizedPlans) {
    if (ids.has(plan.id)) errors.push(`duplicate plan id: ${plan.id}`);
    ids.add(plan.id);
    if (plan.active && plan.priceMinor === 0) warnings.push(`active plan ${plan.id} is free; its provider cost is an acquisition expense`);
  }
  if (!Number.isFinite(Number(targetGrossMarginPercent)) || Number(targetGrossMarginPercent) < 0 || Number(targetGrossMarginPercent) >= 100) throw new Error("targetGrossMarginPercent must be in [0, 100)");
  const results = [];
  for (const plan of normalizedPlans.filter((entry) => entry.active)) {
    for (const model of normalizedPricing) {
      for (const rawScenario of scenarios) {
        const scenario = rawScenario && typeof rawScenario === "object" ? rawScenario : {};
        const promptTokens = positiveInteger(scenario.promptTokens ?? 1_000_000, "scenario.promptTokens");
        const completionTokens = Number.isSafeInteger(Number(scenario.completionTokens ?? 1_000_000)) && Number(scenario.completionTokens ?? 1_000_000) >= 0 ? Number(scenario.completionTokens ?? 1_000_000) : 0;
        const points = pointsForUsage(model, promptTokens, completionTokens);
        const revenueMajor = points * (plan.priceMinor / 100) / plan.points;
        const providerCost = costForUsage(model, promptTokens, completionTokens);
        const sameCurrency = plan.currency === model.costCurrency;
        const componentMargins = [
          { revenue: promptTokens * model.inputPointsPerThousand / 1000 * (plan.priceMinor / 100) / plan.points, cost: promptTokens * model.inputCostPerMillion / 1_000_000 },
          { revenue: completionTokens * model.outputPointsPerThousand / 1000 * (plan.priceMinor / 100) / plan.points, cost: completionTokens * model.outputCostPerMillion / 1_000_000 },
        ].map((component) => component.cost === 0 ? 100 : component.revenue <= 0 ? -100 : (component.revenue - component.cost) / component.revenue * 100);
        const marginPercent = revenueMajor === 0 ? null : Number(Math.min(...componentMargins).toFixed(2));
        const result = {
          planId: plan.id,
          model: model.model,
          scenario: typeof scenario.name === "string" && scenario.name.trim() ? scenario.name.trim() : "scenario",
          promptTokens,
          completionTokens,
          points,
          revenueMajor: Number(revenueMajor.toFixed(6)),
          providerCost: Number(providerCost.toFixed(6)),
          revenueCurrency: plan.currency,
          costCurrency: model.costCurrency,
          marginPercent,
        };
        if (!sameCurrency) {
          warnings.push(`${plan.id}/${model.model}: revenue currency ${plan.currency} differs from cost currency ${model.costCurrency}; margin is informational until FX is provided`);
        } else if (marginPercent !== null && marginPercent < Number(targetGrossMarginPercent)) {
          errors.push(`${plan.id}/${model.model}/${result.scenario}: gross margin ${marginPercent}% is below target ${targetGrossMarginPercent}%`);
        }
        results.push(result);
      }
    }
  }
  return {
    ok: errors.length === 0,
    targetGrossMarginPercent: Number(targetGrossMarginPercent),
    planCount: normalizedPlans.length,
    modelCount: normalizedPricing.length,
    errors,
    warnings,
    results,
  };
};

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

export const main = async () => {
  const configPath = argument("--config") ?? process.env.OPENBUDDY_COMMERCIAL_MODEL_CONFIG;
  if (!configPath) throw new Error("--config or OPENBUDDY_COMMERCIAL_MODEL_CONFIG is required");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const report = auditCommercialModel(config);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
};

if (process.argv[1]?.endsWith("audit-commercial-model.mjs")) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 2;
  });
}
