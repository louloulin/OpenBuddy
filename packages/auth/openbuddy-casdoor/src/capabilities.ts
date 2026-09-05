export interface CasdoorApplicationProvider {
  name?: string;
  canSignIn?: boolean;
  provider?: {
    name?: string;
    category?: string;
    type?: string;
    clientId?: string;
    clientSecret?: string;
    clientId2?: string;
    clientSecret2?: string;
    accessKey?: string;
    accessKeySecret?: string;
    signName?: string;
    templateCode?: string;
    appId?: string;
    endpoint?: string;
    content?: string;
  };
}

export interface CasdoorSigninMethod {
  name?: string;
  rule?: string;
}

export interface CasdoorApplicationLoginInfo {
  enableCodeSignin?: boolean;
  signinMethods?: CasdoorSigninMethod[];
  providers?: CasdoorApplicationProvider[];
  scopes?: string[];
  redirectUris?: string[];
}

export interface CasdoorLoginCapabilities {
  status: "available" | "misconfigured" | "error";
  enterprise: { enabled: boolean; reason?: string };
  sms: { enabled: boolean; reason?: string };
  wechat: { enabled: boolean; providerHint?: string; reason?: string };
  scopes: string[];
  checkedAt: number;
  error?: string;
}

const REQUIRED_ENTERPRISE_SCOPES = ["openid", "profile", "email", "phone", "offline_access"] as const;

function enabledSigninMethod(methods: CasdoorSigninMethod[] | undefined, name: string): boolean {
  return methods?.some((method) => method.name === name && method.rule !== "None" && method.rule !== "Hide password") ?? false;
}

function hasProviderConfiguration(provider: CasdoorApplicationProvider["provider"] | undefined): boolean {
  if (!provider || !provider.type || ["Default", "Mock SMS"].includes(provider.type)) return false;
  return [
    provider.clientId,
    provider.clientSecret,
    provider.clientId2,
    provider.clientSecret2,
    provider.accessKey,
    provider.accessKeySecret,
    provider.signName,
    provider.templateCode,
    provider.appId,
    provider.endpoint,
    provider.content,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
}

export function deriveCasdoorLoginCapabilities(
  info: CasdoorApplicationLoginInfo,
  redirectUriOrNow: string | number = "",
  now = typeof redirectUriOrNow === "number" ? redirectUriOrNow : Date.now(),
): CasdoorLoginCapabilities {
  const redirectUri = typeof redirectUriOrNow === "string" ? redirectUriOrNow : "";
  const registeredRedirect = Array.isArray(info.redirectUris)
    && info.redirectUris.some((value) => typeof value === "string" && value.trim() === redirectUri.trim());
  const redirectConfigured = !redirectUri.trim() || registeredRedirect;
  const scopes = Array.isArray(info.scopes) ? info.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0) : [];
  const normalizedScopes = new Set(scopes.map((scope) => scope.trim().toLowerCase()));
  const scopesConfigured = !Array.isArray(info.scopes) || REQUIRED_ENTERPRISE_SCOPES.every((scope) => normalizedScopes.has(scope));
  const missingScopes = REQUIRED_ENTERPRISE_SCOPES.filter((scope) => !normalizedScopes.has(scope));
  const enterpriseReason = !redirectConfigured
    ? `Casdoor 应用未登记回调 URI ${redirectUri || "casdoor://localhost/callback"}；请在应用 Redirect URIs 中添加完全一致的地址`
    : !scopesConfigured
      ? `Casdoor 应用未配置必需 OIDC scopes：${missingScopes.join(", ")}；请在应用 scopes 中启用 openid、profile、email、phone、offline_access`
      : undefined;
  const smsMethodEnabled = enabledSigninMethod(info.signinMethods, "Verification code");
  const smsProvider = info.providers?.find((item) => item.canSignIn === true && item.provider?.category === "SMS");
  const smsEnabled = info.enableCodeSignin === true && smsMethodEnabled && Boolean(smsProvider) && hasProviderConfiguration(smsProvider?.provider);
  const smsReason = smsEnabled
    ? undefined
    : info.enableCodeSignin !== true
      ? "Casdoor 应用未启用 Verification code；请在应用 Sign-in methods 中启用短信验证码"
      : !smsMethodEnabled
        ? "Casdoor 应用未启用可用的 Verification code 登录规则"
        : "Casdoor 应用未绑定可用的真实 SMS Provider；请配置短信网关并绑定到应用";
  const wechatProvider = info.providers?.find((item) => item.canSignIn === true && item.provider?.category === "OAuth" && item.provider.type === "WeChat");
  const wechatCredentialsReady = Boolean(wechatProvider?.provider?.clientId?.trim() && wechatProvider.provider.clientSecret?.trim());
  const wechatEnabled = Boolean(wechatProvider && wechatCredentialsReady);
  const wechatReason = wechatEnabled
    ? undefined
    : !wechatProvider
      ? "Casdoor 应用未绑定可登录的 WeChat OAuth Provider；WeChat 与 WeCom 不可互换"
      : "Casdoor WeChat Provider 缺少 client ID 或 client secret";
  const enterpriseEnabled = redirectConfigured && scopesConfigured;
  return {
    status: enterpriseEnabled || smsEnabled || wechatEnabled ? "available" : "misconfigured",
    enterprise: { enabled: enterpriseEnabled, ...(enterpriseReason ? { reason: enterpriseReason } : {}) },
    sms: { enabled: smsEnabled, ...(smsReason ? { reason: smsReason } : {}) },
    wechat: { enabled: wechatEnabled, ...(wechatProvider?.provider?.name ? { providerHint: wechatProvider.provider.name } : {}), ...(wechatReason ? { reason: wechatReason } : {}) },
    scopes,
    checkedAt: now,
  };
}

export function casdoorCapabilityError(message: string, now = Date.now()): CasdoorLoginCapabilities {
  return {
    status: "error",
    enterprise: { enabled: false, reason: message },
    sms: { enabled: false, reason: message },
    wechat: { enabled: false, reason: message },
    scopes: [],
    checkedAt: now,
    error: message,
  };
}
