export interface ProductionConfigurationInput {
  nodeEnv?: string;
  casdoorAudience?: string;
  casdoorAudienceValid: boolean;
  casdoorAudienceStrong: boolean;
  store?: string;
  postgresConnectionString?: string;
  mysqlConnectionString?: string;
  newApiBaseUrl?: string;
  groupTokensValid: boolean;
  groupTokensStrong: boolean;
  defaultGroup?: string;
  defaultGroupToken?: string;
  groupCapabilitiesMatch: boolean;
  capabilitiesConfigured: boolean;
  capabilitiesVerified: boolean;
  capabilitiesFresh: boolean;
  capabilityMaxAgeHoursValid: boolean;
  newApiBaseUrlSecure: boolean;
  webhookSecret?: string;
  billingCallbackSecret?: string;
  newApiCostImportSecret?: string;
  creditExpirySecret?: string;
  backchannelLogoutSecret?: string;
  weknoraExchangeSecret?: string;
  weknoraExchangeSecretStrong?: boolean;
  weknoraTenantMapConfigured?: boolean;
  signingSecretsStrong: boolean;
  allowEstimatedUsage: boolean;
  targetGrossMarginValid: boolean;
}

type CapabilityEntry = { supported?: unknown; usage?: unknown; verifiedAt?: unknown };

export function productionAudienceValid(value: string | undefined): boolean {
  return Boolean(value?.trim() && /^[a-zA-Z0-9._:-]{1,160}$/.test(value.trim()));
}

export function productionAudienceStrong(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length >= 3 && normalized !== "openbuddy" && !["replace-with", "placeholder", "example", "changeme", "change-me", "your-"].some((marker) => normalized.includes(marker));
}

export function productionTargetGrossMarginValid(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 100;
}

function isVerifiedDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function verifiedDateAgeHours(value: unknown, now: number): number {
  if (!isVerifiedDate(value)) return Number.POSITIVE_INFINITY;
  return (now - Date.parse(`${value}T00:00:00.000Z`)) / (60 * 60 * 1000);
}

export function productionCapabilityDirectoryVerified(directory: unknown): boolean {
  if (!directory || typeof directory !== "object" || Array.isArray(directory)) return false;
  let hasSupportedProtocol = false;
  for (const models of Object.values(directory as Record<string, unknown>)) {
    if (!models || typeof models !== "object" || Array.isArray(models)) return false;
    for (const protocols of Object.values(models as Record<string, unknown>)) {
      if (!protocols || typeof protocols !== "object" || Array.isArray(protocols)) return false;
      for (const rawCapability of Object.values(protocols as Record<string, unknown>)) {
        if (!rawCapability || typeof rawCapability !== "object" || Array.isArray(rawCapability)) return false;
        const capability = rawCapability as CapabilityEntry;
        if (capability.supported !== true) continue;
        hasSupportedProtocol = true;
        if (capability.usage !== "required" || !isVerifiedDate(capability.verifiedAt)) return false;
      }
    }
  }
  return hasSupportedProtocol;
}

export function productionCapabilityDirectoryFresh(directory: unknown, now = Date.now(), maxAgeHours = 24): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return false;
  if (!directory || typeof directory !== "object" || Array.isArray(directory)) return false;
  let hasSupportedProtocol = false;
  for (const models of Object.values(directory as Record<string, unknown>)) {
    if (!models || typeof models !== "object" || Array.isArray(models)) return false;
    for (const protocols of Object.values(models as Record<string, unknown>)) {
      if (!protocols || typeof protocols !== "object" || Array.isArray(protocols)) return false;
      for (const rawCapability of Object.values(protocols as Record<string, unknown>)) {
        if (!rawCapability || typeof rawCapability !== "object" || Array.isArray(rawCapability)) return false;
        const capability = rawCapability as CapabilityEntry;
        if (capability.supported !== true) continue;
        hasSupportedProtocol = true;
        const ageHours = verifiedDateAgeHours(capability.verifiedAt, now);
        if (ageHours < 0 || ageHours > maxAgeHours) return false;
      }
    }
  }
  return hasSupportedProtocol;
}

export function productionConfigurationErrors(input: ProductionConfigurationInput): string[] {
  if (input.nodeEnv === "development" || input.nodeEnv === "test") return [];

  const missing: string[] = [];
  if (!input.casdoorAudienceValid || !input.casdoorAudience?.trim()) missing.push("CASDOOR_AUDIENCE (must be an explicit valid client ID)");
  if (!input.casdoorAudienceStrong || !productionAudienceStrong(input.casdoorAudience)) missing.push("CASDOOR_AUDIENCE (must not be a placeholder/default value)");
  if (input.store !== "postgres" && input.store !== "mysql") missing.push("RESOURCE_GATEWAY_STORE=postgres|mysql");
  if (input.store === "postgres" && !input.postgresConnectionString?.trim()) missing.push("POSTGRES_CONNECTION_STRING");
  if (input.store === "mysql" && !input.mysqlConnectionString?.trim()) missing.push("MYSQL_CONNECTION_STRING");
  if (!input.newApiBaseUrl?.trim()) missing.push("NEW_API_BASE_URL");
  if (!input.newApiBaseUrlSecure) missing.push("NEW_API_BASE_URL (HTTPS required in production)");
  if (!input.groupTokensValid) missing.push("NEW_API_GROUP_TOKENS_JSON (valid non-empty Group→Token JSON)");
  if (!input.groupTokensStrong) missing.push("NEW_API_GROUP_TOKENS_JSON (real non-placeholder tokens, minimum 32 characters)");
  if (!input.defaultGroup?.trim() || !input.defaultGroupToken?.trim()) missing.push("NEW_API_GROUP (must exist in NEW_API_GROUP_TOKENS_JSON)");
  if (!input.groupCapabilitiesMatch) missing.push("NEW_API_GROUP_TOKENS_JSON/NEW_API_CAPABILITIES_JSON (Group sets must match)");
  if (!input.capabilitiesConfigured) missing.push("NEW_API_CAPABILITIES_JSON (verified capability directory)");
  if (!input.capabilitiesVerified) missing.push("NEW_API_CAPABILITIES_JSON (supported protocols require usage=required and verifiedAt=YYYY-MM-DD)");
  if (!input.capabilityMaxAgeHoursValid) missing.push("NEW_API_CAPABILITY_MAX_AGE_HOURS (must be a positive number)");
  if (!input.capabilitiesFresh) missing.push("NEW_API_CAPABILITIES_JSON (verifiedAt is older than the configured freshness window)");
  if (!input.webhookSecret?.trim()) missing.push("RESOURCE_GATEWAY_WEBHOOK_SECRET");
  if (!input.billingCallbackSecret?.trim()) missing.push("RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET");
  if (!input.newApiCostImportSecret?.trim()) missing.push("RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET");
  if (!input.creditExpirySecret?.trim()) missing.push("RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET");
  if (!input.backchannelLogoutSecret?.trim()) missing.push("RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET");
  const weknoraExchangeConfigured = Boolean(input.weknoraExchangeSecret?.trim()) || Boolean(input.weknoraTenantMapConfigured);
  if (weknoraExchangeConfigured && !input.weknoraExchangeSecret?.trim()) missing.push("RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET");
  if (weknoraExchangeConfigured && !input.weknoraExchangeSecretStrong) missing.push("RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET (minimum 32 characters and no placeholders)");
  if (weknoraExchangeConfigured && !input.weknoraTenantMapConfigured) missing.push("RESOURCE_GATEWAY_WEKNORA_TENANT_MAP_JSON");
  if (!input.signingSecretsStrong) missing.push("RESOURCE_GATEWAY_*_SECRET (minimum 32 characters and no placeholders)");
  if (input.allowEstimatedUsage) missing.push("NEW_API_ALLOW_ESTIMATED_USAGE=0");
  if (!input.targetGrossMarginValid) missing.push("RESOURCE_GATEWAY_TARGET_GROSS_MARGIN_PERCENT (must be a number in [0, 100))");
  return missing;
}

export function assertProductionConfiguration(input: ProductionConfigurationInput): void {
  const missing = productionConfigurationErrors(input);
  if (missing.length) throw new Error(`生产配置不完整，拒绝启动：${missing.join(", ")}`);
}
