import { describe, expect, it } from "vitest";
import { productionAudienceStrong, productionAudienceValid, productionCapabilityDirectoryFresh, productionCapabilityDirectoryVerified, productionConfigurationErrors, productionTargetGrossMarginValid } from "./production-config.js";

const validConfiguration = {
  nodeEnv: "production",
  casdoorAudience: "005d6839fe25abd6696f",
  casdoorAudienceValid: true,
  casdoorAudienceStrong: true,
  store: "postgres",
  postgresConnectionString: "postgres://gateway:secret@postgres/openbuddy",
  newApiBaseUrl: "https://new-api.example.com",
  groupTokensValid: true,
  groupTokensStrong: true,
  defaultGroup: "default",
  defaultGroupToken: "new-api-token",
  groupCapabilitiesMatch: true,
  capabilitiesConfigured: true,
  capabilitiesVerified: true,
  capabilitiesFresh: true,
  capabilityMaxAgeHoursValid: true,
  newApiBaseUrlSecure: true,
  webhookSecret: "webhook-secret",
  billingCallbackSecret: "billing-secret",
  newApiCostImportSecret: "import-secret",
  creditExpirySecret: "credit-expiry-secret",
  backchannelLogoutSecret: "logout-secret",
  weknoraExchangeSecret: "weknora-exchange-secret-012345678901234567890123456789",
  weknoraExchangeSecretStrong: true,
  weknoraTenantMapConfigured: true,
  signingSecretsStrong: true,
  allowEstimatedUsage: false,
  targetGrossMarginValid: true,
};

describe("production gateway configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(productionConfigurationErrors(validConfiguration)).toEqual([]);
  });

  it("rejects missing persistence, credentials, capabilities, and signing secrets", () => {
    const errors = productionConfigurationErrors({ ...validConfiguration, casdoorAudience: "", casdoorAudienceValid: false, casdoorAudienceStrong: false, store: "json", postgresConnectionString: "", groupTokensValid: false, groupTokensStrong: false, defaultGroupToken: "", groupCapabilitiesMatch: false, capabilitiesConfigured: false, capabilitiesVerified: false, capabilitiesFresh: false, capabilityMaxAgeHoursValid: false, newApiBaseUrlSecure: false, webhookSecret: "", billingCallbackSecret: "", newApiCostImportSecret: "", creditExpirySecret: "", backchannelLogoutSecret: "", weknoraExchangeSecret: "", weknoraExchangeSecretStrong: false, weknoraTenantMapConfigured: false, signingSecretsStrong: false, allowEstimatedUsage: true });
    expect(errors).toEqual(expect.arrayContaining([
      "CASDOOR_AUDIENCE (must be an explicit valid client ID)",
      "CASDOOR_AUDIENCE (must not be a placeholder/default value)",
      "RESOURCE_GATEWAY_STORE=postgres|mysql",
      "NEW_API_GROUP_TOKENS_JSON (valid non-empty Group→Token JSON)",
      "NEW_API_GROUP_TOKENS_JSON (real non-placeholder tokens, minimum 32 characters)",
      "NEW_API_GROUP (must exist in NEW_API_GROUP_TOKENS_JSON)",
      "NEW_API_GROUP_TOKENS_JSON/NEW_API_CAPABILITIES_JSON (Group sets must match)",
      "NEW_API_CAPABILITIES_JSON (verified capability directory)",
      "NEW_API_CAPABILITIES_JSON (supported protocols require usage=required and verifiedAt=YYYY-MM-DD)",
      "NEW_API_CAPABILITY_MAX_AGE_HOURS (must be a positive number)",
      "NEW_API_CAPABILITIES_JSON (verifiedAt is older than the configured freshness window)",
      "NEW_API_BASE_URL (HTTPS required in production)",
      "RESOURCE_GATEWAY_WEBHOOK_SECRET",
      "RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET",
      "RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET",
      "RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET",
      "RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET",
      "RESOURCE_GATEWAY_*_SECRET (minimum 32 characters and no placeholders)",
      "NEW_API_ALLOW_ESTIMATED_USAGE=0",
    ]));
  });

  it("allows the optional WeKnora bridge to remain disabled, but requires both settings when enabled", () => {
    expect(productionConfigurationErrors({ ...validConfiguration, weknoraExchangeSecret: "", weknoraExchangeSecretStrong: false, weknoraTenantMapConfigured: false })).toEqual([]);
    expect(productionConfigurationErrors({ ...validConfiguration, weknoraExchangeSecret: "bridge-secret", weknoraExchangeSecretStrong: false, weknoraTenantMapConfigured: false })).toEqual(expect.arrayContaining([
      "RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET (minimum 32 characters and no placeholders)",
      "RESOURCE_GATEWAY_WEKNORA_TENANT_MAP_JSON",
    ]));
    expect(productionConfigurationErrors({ ...validConfiguration, weknoraExchangeSecret: "", weknoraExchangeSecretStrong: false, weknoraTenantMapConfigured: true })).toContain("RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET");
  });

  it("rejects a default or placeholder audience in production", () => {
    expect(productionAudienceValid("openbuddy")).toBe(true);
    expect(productionAudienceValid("bad audience")).toBe(false);
    expect(productionAudienceStrong("openbuddy")).toBe(false);
    expect(productionAudienceStrong("replace-with-client-id")).toBe(false);
    expect(productionConfigurationErrors({ ...validConfiguration, casdoorAudience: "openbuddy", casdoorAudienceStrong: false })).toContain("CASDOOR_AUDIENCE (must not be a placeholder/default value)");
    expect(productionConfigurationErrors({ ...validConfiguration, casdoorAudience: "not valid", casdoorAudienceValid: false })).toContain("CASDOOR_AUDIENCE (must be an explicit valid client ID)");
  });

  it("rejects an invalid target gross margin in production", () => {
    expect(productionTargetGrossMarginValid(undefined)).toBe(true);
    expect(productionTargetGrossMarginValid("70")).toBe(true);
    expect(productionTargetGrossMarginValid("99.9")).toBe(true);
    expect(productionTargetGrossMarginValid("100")).toBe(false);
    expect(productionTargetGrossMarginValid("not-a-number")).toBe(false);
    expect(productionConfigurationErrors({ ...validConfiguration, targetGrossMarginValid: false })).toContain("RESOURCE_GATEWAY_TARGET_GROSS_MARGIN_PERCENT (must be a number in [0, 100))");
  });

  it("requires real usage and verification metadata for supported protocols", () => {
    expect(productionCapabilityDirectoryVerified({ default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-29" } } } })).toBe(true);
    expect(productionCapabilityDirectoryVerified({ default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "optional", verifiedAt: "2026-08-29" } } } })).toBe(false);
    expect(productionCapabilityDirectoryVerified({ default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "YYYY-MM-DD" } } } })).toBe(false);
    expect(productionCapabilityDirectoryVerified({ default: { "MiniMax-M3": { responses: { supported: false, reason: "not implemented" } } } })).toBe(false);
  });

  it("rejects stale, future, and invalid capability verification dates", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z");
    const fresh = { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-30" } } } };
    const previousDay = { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-29" } } } };
    const old = { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-28" } } } };
    const future = { default: { "MiniMax-M3": { "chat.completions": { supported: true, usage: "required", verifiedAt: "2026-08-31" } } } };
    expect(productionCapabilityDirectoryFresh(fresh, now, 24)).toBe(true);
    expect(productionCapabilityDirectoryFresh(previousDay, now, 24)).toBe(true);
    expect(productionCapabilityDirectoryFresh(old, now, 24)).toBe(false);
    expect(productionCapabilityDirectoryFresh(future, now, 24)).toBe(false);
    expect(productionCapabilityDirectoryFresh(fresh, now, 0)).toBe(false);
  });

  it("does not block development and test fixtures", () => {
    expect(productionConfigurationErrors({ ...validConfiguration, nodeEnv: "development", store: "json", groupTokensValid: false })).toEqual([]);
    expect(productionConfigurationErrors({ ...validConfiguration, nodeEnv: "test", store: "memory", groupTokensValid: false })).toEqual([]);
  });
});
