import {
	EmailError,
	CompositeEmailProvider,
	createGmailApiEmailProvider,
	createJmapEmailProvider,
	createMcpEmailProvider,
	createMicrosoftGraphEmailProvider,
	inferEmailMcpProfile,
	inferEmailMcpProfileFromTools,
	type EmailAccount,
	type EmailProvider,
	type EmailProviderReadiness,
} from "./index"
import type { McpClient, McpCredential } from "@openbuddy/capability-mcp-client"

export type EmailRegistryProviderType = "mcp" | "gmail-api" | "graph-api" | "jmap-api"

export interface EmailConnection {
	id: string
	providerType: EmailRegistryProviderType
	accountId?: string
	displayName: string
	credentialRef?: string
	mcpServerName?: string
	scopes?: string[]
	enabledCapabilities?: string[]
	enabled?: boolean
	status?: "configured" | "connected" | "reauthorization-required" | "disabled" | "error"
	lastError?: string
	updatedAt?: string
}

export interface EmailCredentialResolver {
	resolve(ref: string): Promise<McpCredential | undefined>
	authorize?(ref: string): Promise<void>
}

export interface EmailProviderRegistryOptions {
	mcp?: Pick<McpClient, "list" | "callTool"> & { listToolNames?: (serverName: string) => string[] }
	credentialResolver?: EmailCredentialResolver
	providerFactories?: Partial<Record<EmailRegistryProviderType, (connection: EmailConnection, accessToken?: () => Promise<string>) => EmailProvider>>
}

export interface EmailConnectionReadiness {
	connection: EmailConnection
	readiness: EmailProviderReadiness
	provider?: string
	accountCount: number
	message?: string
}

export interface EmailProviderRegistryDiagnostic {
	provider: "registry"
	serverName: string
	profile: "composite"
	toolDiscovery: "discovered" | "not-available"
	discoveredTools: string[]
	accounts: EmailAccount[]
	operations: []
	availableCapabilities: string[]
	missingCapabilities: string[]
	readiness: EmailProviderReadiness
	connections: EmailConnectionReadiness[]
}

const now = (): string => new Date().toISOString()
const supportedMcpServer = (serverName: string): boolean => /mail|email|qq|gmail|google|outlook|microsoft|graph|imap|smtp|jmap|fastmail/i.test(serverName)

function readinessFor(status: EmailConnection["status"] | undefined): EmailProviderReadiness {
	if (status === "connected") return "ready"
	if (status === "reauthorization-required") return "reauthorization-required"
	if (status === "configured") return "partial"
	return "unavailable"
}

function unique<T>(values: T[]): T[] { return [...new Set(values)] }

export class EmailProviderRegistry {
	private readonly connectionsById = new Map<string, EmailConnection>()
	private readonly providersById = new Map<string, EmailProvider>()
	private readonly options: EmailProviderRegistryOptions
	private mcpSynced = false

	constructor(options: EmailProviderRegistryOptions = {}) {
		this.options = options
	}

	register(connection: EmailConnection): EmailConnection {
		if (!connection.id.trim()) throw new EmailError("invalid_input", "邮箱连接 id 不能为空")
		if (!connection.displayName.trim()) throw new EmailError("invalid_input", "邮箱连接 displayName 不能为空")
		if (connection.providerType !== "mcp" && !connection.credentialRef?.trim()) throw new EmailError("invalid_input", "API 邮箱连接必须配置 credentialRef")
		if (connection.providerType === "mcp" && !connection.mcpServerName?.trim()) throw new EmailError("invalid_input", "MCP 邮箱连接必须配置 mcpServerName")
		const next: EmailConnection = {
			...connection,
		enabled: connection.enabled !== false,
			status: connection.enabled === false ? "disabled" : connection.status ?? "configured",
			updatedAt: now(),
		}
		this.connectionsById.set(next.id, next)
		this.providersById.delete(next.id)
		return { ...next, scopes: next.scopes ? [...next.scopes] : undefined, enabledCapabilities: next.enabledCapabilities ? [...next.enabledCapabilities] : undefined }
	}

	registerMany(connections: readonly EmailConnection[]): EmailConnection[] {
		return connections.map((connection) => this.register(connection))
	}

	list(): EmailConnection[] {
		return [...this.connectionsById.values()].map((connection) => ({ ...connection, scopes: connection.scopes ? [...connection.scopes] : undefined, enabledCapabilities: connection.enabledCapabilities ? [...connection.enabledCapabilities] : undefined }))
	}

	get(id: string): EmailConnection | undefined {
		const connection = this.connectionsById.get(id)
		return connection ? { ...connection, scopes: connection.scopes ? [...connection.scopes] : undefined, enabledCapabilities: connection.enabledCapabilities ? [...connection.enabledCapabilities] : undefined } : undefined
	}

	remove(id: string): boolean {
		this.providersById.delete(id)
		return this.connectionsById.delete(id)
	}

	async setEnabled(id: string, enabled: boolean): Promise<EmailConnection> {
		const connection = this.requireConnection(id)
		connection.enabled = enabled
		connection.status = enabled ? "configured" : "disabled"
		connection.lastError = undefined
		connection.updatedAt = now()
		this.providersById.delete(id)
		return this.get(id)!
	}

	async reauthorize(id: string): Promise<EmailConnection> {
		const connection = this.requireConnection(id)
		if (!connection.credentialRef || !this.options.credentialResolver?.authorize) throw new EmailError("operation_not_supported", "当前邮箱连接未配置可用的重授权流程")
		await this.options.credentialResolver.authorize(connection.credentialRef)
		return this.connect(id).then(() => this.get(id)!)
	}

	setProviderFactories(factories: EmailProviderRegistryOptions["providerFactories"]): void {
		this.options.providerFactories = { ...(this.options.providerFactories ?? {}), ...factories }
		for (const [id] of [...this.providersById.keys()]) this.providersById.delete(id)
	}

	async connect(id: string): Promise<EmailProvider> {
		const connection = this.requireConnection(id)
		if (connection.enabled === false || connection.status === "disabled") throw new EmailError("provider_unavailable", `邮箱连接已禁用: ${id}`)
		try {
			let provider: EmailProvider
			if (connection.providerType === "mcp") {
				const mcp = this.options.mcp
				if (!mcp || !connection.mcpServerName) throw new EmailError("provider_unavailable", `MCP 邮箱连接不可用: ${id}`)
				const tools = mcp.listToolNames?.(connection.mcpServerName) ?? []
				const profile = inferEmailMcpProfileFromTools(tools) ?? inferEmailMcpProfile(connection.mcpServerName)
				provider = createMcpEmailProvider(mcp, { serverName: connection.mcpServerName, profile, availableTools: tools.length ? tools : undefined })
			} else {
				const accessToken = await this.resolveAccessToken(connection)
				const tokenResolver = async (): Promise<string> => {
					const latest = await this.resolveAccessToken(connection)
					return latest
				}
				const factory = this.options.providerFactories?.[connection.providerType]
				provider = factory
					? factory(connection, tokenResolver)
					: this.createDirectProvider(connection, accessToken, tokenResolver)
			}
			this.providersById.set(id, provider)
			connection.status = "connected"
			connection.lastError = undefined
			connection.updatedAt = now()
			return provider
		} catch (error) {
			connection.status = this.isReauthorizationError(error) ? "reauthorization-required" : "error"
			connection.lastError = error instanceof Error ? error.message : String(error)
			connection.updatedAt = now()
			throw error
		}
	}

	provider(): EmailProvider | undefined {
		this.syncMcpConnections()
		const providers = [...this.providersById.entries()].filter(([id]) => this.connectionsById.get(id)?.enabled !== false).map(([, provider]) => provider)
		if (providers.length === 0) return undefined
		return providers.length === 1 ? providers[0] : new CompositeEmailProvider(providers)
	}

	async connectAll(): Promise<EmailProvider | undefined> {
		this.syncMcpConnections()
		for (const connection of this.connectionsById.values()) {
			if (connection.enabled !== false && connection.status !== "connected") {
				try { await this.connect(connection.id) } catch { /* readiness retains the concrete error */ }
			}
		}
		return this.provider()
	}

	async readiness(): Promise<EmailConnectionReadiness[]> {
		this.syncMcpConnections()
		return Promise.all([...this.connectionsById.values()].map(async (connection) => {
			const provider = this.providersById.get(connection.id)
			if (!provider && connection.enabled !== false && connection.status !== "reauthorization-required") {
				try { await this.connect(connection.id) } catch { /* return the classified status */ }
			}
			const current = this.connectionsById.get(connection.id)!
			let accountCount = 0
			if (this.providersById.has(connection.id)) {
				try { accountCount = (await this.providersById.get(connection.id)!.accounts()).length } catch { accountCount = 0 }
			}
			return { connection: this.get(connection.id)!, readiness: readinessFor(current.status), ...(this.providersById.get(connection.id) ? { provider: this.providersById.get(connection.id)!.name } : {}), accountCount, ...(current.lastError ? { message: current.lastError } : {}) }
		}))
	}

	async diagnostics(): Promise<EmailProviderRegistryDiagnostic> {
		const connections = await this.readiness()
		const accounts = (await Promise.all([...this.providersById.values()].map(async (provider) => { try { return await provider.accounts() } catch { return [] } }))).flat()
		const discoveredTools = unique([...this.connectionsById.values()].flatMap((connection) => connection.mcpServerName && this.options.mcp?.listToolNames ? this.options.mcp.listToolNames(connection.mcpServerName) : []))
		const readiness = connections.some((item) => item.readiness === "ready") ? (connections.some((item) => item.readiness !== "ready" && item.readiness !== "unavailable") ? "partial" : "ready") : connections.some((item) => item.readiness === "reauthorization-required") ? "reauthorization-required" : "unavailable"
		return { provider: "registry", serverName: "openbuddy-email-registry", profile: "composite", toolDiscovery: discoveredTools.length ? "discovered" : "not-available", discoveredTools, accounts, operations: [], availableCapabilities: unique(accounts.flatMap((account) => Object.entries(account.capabilities).filter(([, value]) => value === true).map(([key]) => key))), missingCapabilities: [], readiness, connections }
	}

	private syncMcpConnections(): void {
		if (this.mcpSynced || !this.options.mcp) return
		this.mcpSynced = true
		for (const status of this.options.mcp.list()) {
			if (status.status !== "ready" || !supportedMcpServer(status.serverName) || this.list().some((item) => item.mcpServerName === status.serverName)) continue
			const mcpConnectionId = `mcp:${status.serverName}`
			try {
				this.register({ id: mcpConnectionId, providerType: "mcp", displayName: status.serverName, mcpServerName: status.serverName, status: "connected" })
				const connection = this.connectionsById.get(mcpConnectionId)
				if (!connection) continue
				const tools = this.options.mcp.listToolNames?.(status.serverName) ?? []
				const profile = inferEmailMcpProfileFromTools(tools) ?? inferEmailMcpProfile(status.serverName)
				this.providersById.set(connection.id, createMcpEmailProvider(this.options.mcp, { serverName: status.serverName, profile, availableTools: tools.length ? tools : undefined }))
				connection.status = "connected"
				connection.updatedAt = now()
			} catch (error) {
				this.connectionsById.get(mcpConnectionId)!.status = "error"
				this.connectionsById.get(mcpConnectionId)!.lastError = error instanceof Error ? error.message : String(error)
			}
		}
	}

	private requireConnection(id: string): EmailConnection {
		const connection = this.connectionsById.get(id)
		if (!connection) throw new EmailError("invalid_input", `邮箱连接不存在: ${id}`)
		return connection
	}

	private async resolveAccessToken(connection: EmailConnection): Promise<string> {
		if (!connection.credentialRef || !this.options.credentialResolver) throw new EmailError("provider_unavailable", `邮箱连接缺少 credentialRef: ${connection.id}`)
		const credential = await this.options.credentialResolver.resolve(connection.credentialRef)
		if (!credential?.accessToken) throw new EmailError("provider_unavailable", `邮箱连接需要重新授权: ${connection.id}`)
		if (credential.expiresAt && Number.isFinite(Date.parse(credential.expiresAt)) && Date.parse(credential.expiresAt) <= Date.now()) throw new EmailError("provider_unavailable", `邮箱连接凭据已过期: ${connection.id}`)
		return credential.accessToken
	}

	private createDirectProvider(connection: EmailConnection, accessToken: string, tokenResolver: () => Promise<string>): EmailProvider {
		const options = { accessToken: tokenResolver, accountId: connection.accountId }
		if (connection.providerType === "gmail-api") return createGmailApiEmailProvider(options)
		if (connection.providerType === "graph-api") return createMicrosoftGraphEmailProvider(options)
		if (connection.providerType === "jmap-api") return createJmapEmailProvider(options)
		void accessToken
		throw new EmailError("invalid_input", `不支持的邮箱 provider: ${connection.providerType}`)
	}

	private isReauthorizationError(error: unknown): boolean {
		return error instanceof EmailError && error.code === "provider_unavailable" && /授权|凭据|token|credential/i.test(error.message)
	}
}

