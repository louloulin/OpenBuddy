import { describe, expect, it } from "vitest";
import { authorizeUrl, generatePKCE, generateState, normalizeOidcIssuer } from "../oidc-client";

describe("generatePKCE", () => {
  it("returns verifier + challenge (different)", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier.length).toBeGreaterThan(20);
    expect(challenge.length).toBeGreaterThan(20);
    expect(verifier).not.toBe(challenge);
  });
});

describe("generateState", () => {
  it("returns a non-empty random string", () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1.length).toBeGreaterThan(10);
    expect(s1).not.toBe(s2);
  });
});

describe("authorizeUrl", () => {
  const base = {
    issuer: "https://casdoor.example.com",
    clientId: "my-client",
    redirectUri: "https://app.example.com/cb",
    scope: "openid profile email",
  };

  it("builds a valid authorize URL with PKCE + state", () => {
    const url = authorizeUrl(base, "challenge-abc", "state-xyz");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://casdoor.example.com/login/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("my-client");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.example.com/cb");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("openid profile email");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state-xyz");
  });
});

describe("normalizeOidcIssuer", () => {
  it("strips trailing slash", () => {
    expect(normalizeOidcIssuer("https://x/")).toBe("https://x");
    expect(normalizeOidcIssuer("https://x")).toBe("https://x");
  });
  it("rejects empty", () => {
    expect(() => normalizeOidcIssuer("")).toThrow();
  });
});
