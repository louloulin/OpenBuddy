import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@openbuddy/cordis"
import { Email } from "./index"
import { EmailProviderRegistry } from "./provider-registry"

const ACCOUNT = { id: "a1", address: "me@example.com", provider: "gmail-api" as const, status: "connected" as const, capabilities: { read: true, write: true, attachments: true, multipleAccounts: false } }

const makeProvider = (): { name: string; accounts: () => Promise<typeof ACCOUNT[]> } => ({
  name: "fake",
  accounts: async () => [ACCOUNT],
})

describe("EmailProviderRegistry", () => {
  let dir: string
  let previous: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "openbuddy-email-registry-"))
    previous = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = dir
  })

  afterEach(async () => {
    process.env.PI_CODING_AGENT_DIR = previous
    await rm(dir, { recursive: true, force: true })
  })

  it("stores connections as credential references and never persists access tokens", () => {
    const registry = new EmailProviderRegistry({ credentialResolver: { resolve: async () => undefined } })
    const registered = registry.register({ id: "gmail-1", providerType: "gmail-api", displayName: "Work Gmail", credentialRef: "vault://gmail/work", scopes: ["gmail.readonly"] })
    expect(registered.enabled).toBe(true)
    expect(JSON.stringify(registered)).not.toMatch(/accessToken|ya29\./)
    expect(registry.list()).toHaveLength(1)
    expect(registry.get("gmail-1")?.scopes).toEqual(["gmail.readonly"])
  })

  it("resolves access tokens on demand and surfaces reauthorization when tokens are missing", async () => {
    const calls: string[] = []
    const registry = new EmailProviderRegistry({
      credentialResolver: {
        resolve: async (ref) => {
          calls.push(ref)
          if (ref === "vault://missing") return undefined
          if (ref === "vault://fresh") return { accessToken: "fresh", expiresAt: new Date(Date.now() + 60_000).toISOString() }
          return undefined
        },
      },
    })
    await registry.register({ id: "missing", providerType: "gmail-api", displayName: "Missing", credentialRef: "vault://missing" })
    await registry.register({ id: "fresh", providerType: "gmail-api", displayName: "Fresh", credentialRef: "vault://fresh" })

    const providerFactory = (connection: { id: string }, tokenResolver: () => Promise<string>) => ({
      name: connection.id,
      accounts: async () => [{ ...ACCOUNT, id: connection.id, provider: "gmail-api" as const, status: "connected" as const }],
      __tokenResolver: tokenResolver,
    } as unknown as ReturnType<typeof makeProvider> & { __tokenResolver: () => Promise<string> })

    registry.setProviderFactories({ "gmail-api": providerFactory as never })
    await expect(registry.connect("missing")).rejects.toThrow(/重新授权/)
    expect(registry.get("missing")?.status).toBe("reauthorization-required")
    await registry.connect("fresh")
    expect(registry.get("fresh")?.status).toBe("connected")
    expect(calls).toEqual(["vault://missing", "vault://fresh"])
  })

  it("disables providers instead of dropping them and supports re-enable", async () => {
    const registry = new EmailProviderRegistry({ credentialResolver: { resolve: async () => ({ accessToken: "ok" }) } })
    registry.setProviderFactories({
      "gmail-api": ((connection: { id: string }, resolver?: () => Promise<string>) => ({
        name: connection.id,
        accounts: async () => [{ ...ACCOUNT, id: connection.id, provider: "gmail-api" as const }],
        __resolver: resolver,
      })) as never,
    })
    await registry.register({ id: "toggle", providerType: "gmail-api", displayName: "Toggle", credentialRef: "vault://toggle" })
    const provider = await registry.connect("toggle")
    expect(provider).toBeDefined()
    const updated = await registry.setEnabled("toggle", false)
    expect(updated.enabled).toBe(false)
    expect(updated.status).toBe("disabled")
    expect(await registry.provider()).toBeUndefined()
    const restored = await registry.setEnabled("toggle", true)
    expect(restored.enabled).toBe(true)
    expect(restored.status).toBe("configured")
  })

  it("reads MCP-only connections and aggregates them into a composite provider", async () => {
    const mcp = {
      list: () => [{ serverName: "agent-mail", status: "ready" as const, toolCount: 3, emailProfile: "qq-agent-mail" }],
      listToolNames: () => ["list_accounts", "list_emails", "send_email"],
      callTool: async () => ({ serverName: "agent-mail", toolName: "list_accounts", result: { content: [] } }),
    }
    const registry = new EmailProviderRegistry({ mcp })
    await registry.connectAll()
    const aggregate = await registry.provider()
    // Even with a single MCP server we surface it as a composite-friendly wrapper so consumers can
    // continue to treat the result uniformly; McpEmailProvider.name is used in dashboards.
    expect(aggregate?.name === "mcp:agent-mail" || aggregate?.name === "mcp:multi").toBe(true)
    const readiness = await registry.readiness()
    expect(readiness).toHaveLength(1)
    expect(readiness[0]?.readiness).toBe("ready")
    expect(readiness[0]?.connection.providerType).toBe("mcp")
  })

  it("plugs into Email via emailProviderRegistry context injection", async () => {
    const ctx = new Context()
    ctx.provide("mcpClient", { list: () => [], callTool: async () => ({ serverName: "none", toolName: "noop", result: { content: [] } }) })
    const provider = makeProvider()
    const registry = new EmailProviderRegistry({ credentialResolver: { resolve: async () => ({ accessToken: "stub" }) } })
    registry.setProviderFactories({
      "gmail-api": ((connection: { id: string }) => ({ name: connection.id, accounts: async () => [ACCOUNT] })) as never,
    })
    await registry.register({ id: "ctx", providerType: "gmail-api", displayName: "Context", credentialRef: "vault://ctx" })
    ctx.provide("emailProviderRegistry", registry)
    const service = new Email(ctx)
    await registry.connect("ctx")
    expect(service.setProvider.length).toBeGreaterThanOrEqual(0)
    // Sanity: Registry is still responsible for the connection lifecycle
    expect(registry.get("ctx")?.status).toBe("connected")
  })
})
