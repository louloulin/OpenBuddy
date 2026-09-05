import { describe, expect, it } from "vitest"
import {
  casdoorCapabilityError,
  deriveCasdoorLoginCapabilities,
  type CasdoorApplicationLoginInfo,
} from "@openbuddy/auth-casdoor"

const now = 1_700_000_000_000

const fullScopes = ["openid", "profile", "email", "phone", "offline_access"]

function makeSmsProvider(overrides: Partial<{ type: string; clientId: string; clientSecret: string }> = {}) {
  return {
    name: "Aliyun SMS",
    canSignIn: true,
    provider: {
      name: "Aliyun SMS",
      category: "SMS",
      type: "Aliyun SMS",
      clientId: "key-1",
      clientSecret: "secret-1",
      ...overrides,
    },
  }
}

function makeWeChatProvider(overrides: Partial<{ clientId: string; clientSecret: string }> = {}) {
  return {
    name: "WeChat OAuth",
    canSignIn: true,
    provider: {
      name: "WeChat OAuth",
      category: "OAuth",
      type: "WeChat",
      clientId: "wx-id",
      clientSecret: "wx-secret",
      ...overrides,
    },
  }
}

function makeInfo(overrides: Partial<CasdoorApplicationLoginInfo> = {}): CasdoorApplicationLoginInfo {
  return {
    enableCodeSignin: true,
    signinMethods: [{ name: "Verification code", rule: "All" }],
    providers: [makeSmsProvider(), makeWeChatProvider()],
    scopes: fullScopes,
    redirectUris: ["casdoor://localhost/callback"],
    ...overrides,
  }
}

describe("casdoor-capabilities pure helpers", () => {
  describe("deriveCasdoorLoginCapabilities", () => {
    it("returns full available capabilities when fully configured", () => {
      const caps = deriveCasdoorLoginCapabilities(makeInfo(), "casdoor://localhost/callback", now)
      expect(caps.status).toBe("available")
      expect(caps.enterprise.enabled).toBe(true)
      expect(caps.sms.enabled).toBe(true)
      expect(caps.wechat.enabled).toBe(true)
      expect(caps.wechat.providerHint).toBe("WeChat OAuth")
      expect(caps.scopes).toEqual(fullScopes)
      expect(caps.checkedAt).toBe(now)
      expect(caps.error).toBeUndefined()
    })

    it("reports enterprise misconfigured when redirect URI is not registered", () => {
      const caps = deriveCasdoorLoginCapabilities(makeInfo(), "casdoor://other-host/callback", now)
      expect(caps.enterprise.enabled).toBe(false)
      expect(caps.enterprise.reason).toMatch(/回调 URI/)
    })

    it("treats empty redirectUri as not requiring registration", () => {
      const caps = deriveCasdoorLoginCapabilities(makeInfo(), "", now)
      expect(caps.enterprise.enabled).toBe(true)
    })

    it("reports enterprise misconfigured when scopes are missing", () => {
      const info = makeInfo({ scopes: ["openid", "profile"] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.enterprise.enabled).toBe(false)
      expect(caps.enterprise.reason).toMatch(/OIDC scopes/)
    })

    it("ignores empty and non-string scopes", () => {
      const info = makeInfo({ scopes: ["openid", "", 123, "email", "profile", "phone", "offline_access"] as unknown as string[] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.enterprise.enabled).toBe(true)
    })

    it("accepts undefined scopes (treated as configured)", () => {
      const info = makeInfo({ scopes: undefined })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.enterprise.enabled).toBe(true)
    })

    it("reports sms disabled when enableCodeSignin is false", () => {
      const info = makeInfo({ enableCodeSignin: false })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.sms.enabled).toBe(false)
      expect(caps.sms.reason).toMatch(/Verification code/)
    })

    it("reports sms disabled when signinMethods hides Verification code", () => {
      const info = makeInfo({ signinMethods: [{ name: "Verification code", rule: "None" }] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.sms.enabled).toBe(false)
      expect(caps.sms.reason).toMatch(/可用的 Verification code 登录规则/)
    })

    it("reports sms disabled when no SMS provider is bound", () => {
      const info = makeInfo({ providers: [makeWeChatProvider()] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.sms.enabled).toBe(false)
      expect(caps.sms.reason).toMatch(/SMS Provider/)
    })

    it("reports sms disabled when SMS provider is Default type", () => {
      const info = makeInfo({ providers: [makeSmsProvider({ type: "Default" }), makeWeChatProvider()] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.sms.enabled).toBe(false)
    })

    it("reports sms disabled when SMS provider lacks credentials", () => {
      const info = makeInfo({ providers: [makeSmsProvider({ clientId: "", clientSecret: "" }), makeWeChatProvider()] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.sms.enabled).toBe(false)
    })

    it("reports wechat disabled when no WeChat provider is bound", () => {
      const info = makeInfo({ providers: [makeSmsProvider()] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.wechat.enabled).toBe(false)
      expect(caps.wechat.reason).toMatch(/WeChat OAuth Provider/)
    })

    it("reports wechat disabled when WeChat provider lacks clientId or clientSecret", () => {
      const info = makeInfo({ providers: [makeSmsProvider(), makeWeChatProvider({ clientSecret: "" })] })
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://localhost/callback", now)
      expect(caps.wechat.enabled).toBe(false)
      expect(caps.wechat.reason).toMatch(/client ID/)
    })

    it("returns misconfigured status when nothing is enabled", () => {
      const info: CasdoorApplicationLoginInfo = {
        enableCodeSignin: false,
        signinMethods: [],
        providers: [],
        scopes: ["openid"],
        redirectUris: [],
      }
      const caps = deriveCasdoorLoginCapabilities(info, "casdoor://wrong/cb", now)
      expect(caps.status).toBe("misconfigured")
    })

    it("treats a numeric argument as now", () => {
      const caps = deriveCasdoorLoginCapabilities(makeInfo(), now)
      expect(caps.checkedAt).toBe(now)
    })
  })

  describe("casdoorCapabilityError", () => {
    it("returns error status with the same reason in every surface", () => {
      const caps = casdoorCapabilityError("upstream timeout", now)
      expect(caps.status).toBe("error")
      expect(caps.error).toBe("upstream timeout")
      expect(caps.enterprise.reason).toBe("upstream timeout")
      expect(caps.sms.reason).toBe("upstream timeout")
      expect(caps.wechat.reason).toBe("upstream timeout")
      expect(caps.scopes).toEqual([])
      expect(caps.checkedAt).toBe(now)
    })
  })
})
