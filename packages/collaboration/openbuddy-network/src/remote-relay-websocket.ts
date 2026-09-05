import type { BuddyEvent, BuddyIdentity, BuddyScope, BuddyTaskEnvelope, EventQueryScope, FederatedRoomGrant } from "@openbuddy/collaboration-protocol"
import {
	RemoteRelayServer,
	type RemoteRelayCredential,
	type RemoteRelayEndpoint,
	type RemoteRelayRequest,
	type RemoteRelayResponse,
	type RemoteRelayWire,
} from "./remote-relay"
import type { PresenceLease, RelayDeliveryContext } from "./index"
import type { BuddyRelayConnectionStatus } from "./index"

export interface RelayWebSocketLike {
	readonly readyState: number
	readonly OPEN: number
	readonly CONNECTING: number
	send(data: string): void
	close(code?: number, reason?: string): void
	addEventListener?: (type: string, listener: (event: { data?: unknown }) => void) => void
	removeEventListener?: (type: string, listener: (event: { data?: unknown }) => void) => void
	on?: (type: string, listener: (...args: any[]) => void) => void
	off?: (type: string, listener: (...args: any[]) => void) => void
}

export type RelayWebSocketFactory = (url: string) => RelayWebSocketLike

type RelayFrame =
	| { type: "buddy-relay/request"; requestId: string; request: RemoteRelayRequest }
	| { type: "buddy-relay/response"; requestId: string; response: RemoteRelayResponse }
	| { type: "buddy-relay/subscribe"; subscriptionId: string; credential: RemoteRelayCredential; scope: EventQueryScope; sinceEventId?: string; grant?: FederatedRoomGrant }
	| { type: "buddy-relay/subscribe-ack"; subscriptionId: string; ok: boolean; error?: string }
	| { type: "buddy-relay/unsubscribe"; subscriptionId: string }
	| { type: "buddy-relay/event"; subscriptionId: string; event: BuddyEvent }
	| { type: "buddy-relay/task"; deliveryId: string; envelope: BuddyTaskEnvelope; scope: BuddyScope }
	| { type: "buddy-relay/task-ack"; deliveryId: string; ok: boolean; error?: string }
	| { type: "buddy-relay/endpoint-ready"; identityId: string }

function id(prefix: string): string {
	const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
	return `${prefix}-${random}`
}

function parseFrame(value: unknown): RelayFrame | undefined {
	if (typeof value !== "string" && value instanceof Uint8Array) value = new TextDecoder().decode(value)
	if (typeof value === "string") {
		try { value = JSON.parse(value) } catch { return undefined }
	}
	if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return undefined
	return value as RelayFrame
}

function addSocketListener(socket: RelayWebSocketLike, type: string, listener: (event: { data?: unknown }) => void): () => void {
	if (socket.addEventListener) {
		socket.addEventListener(type, listener)
		return () => socket.removeEventListener?.(type, listener)
	}
	const nodeListener = (...args: any[]) => listener({ data: args[0] })
	socket.on?.(type, nodeListener)
	return () => socket.off?.(type, nodeListener)
}

function socketUrl(baseUrl: string | URL, path: string): string {
	const url = new URL(path, baseUrl.toString())
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
	return url.toString()
}

export interface WebSocketRemoteRelayWire extends RemoteRelayWire {
	readonly ready: Promise<void>
}

export type RemoteRelayConnectionStatus = "connecting" | "ready" | "degraded" | "closed"

export interface ResilientWebSocketRemoteRelayWire extends RemoteRelayWire {
	readonly ready: Promise<void>
	readonly status: Exclude<BuddyRelayConnectionStatus, "local" | "unknown">
	onStatus(listener: (status: RemoteRelayConnectionStatus) => void): () => void
}

/**
 * Client-side Buddy relay carrier. The wire carries only typed relay frames;
 * task execution remains inside the provider Runtime.
 */
export function createWebSocketRemoteRelayWire(options: {
	baseUrl: string | URL
	credential: RemoteRelayCredential
	webSocket?: RelayWebSocketFactory
	path?: string
	authToken?: string
	onClose?: (error: Error) => void
}): WebSocketRemoteRelayWire {
	const url = new URL(socketUrl(options.baseUrl, options.path ?? "/api/buddy-relay"))
	if (options.authToken) url.searchParams.set("token", options.authToken)
	const socket = (options.webSocket ?? ((value) => new WebSocket(value) as unknown as RelayWebSocketLike))(url.toString())
	const pending = new Map<string, { resolve: (response: RemoteRelayResponse) => void; reject: (error: Error) => void }>()
	const subscriptions = new Map<string, (event: BuddyEvent) => void>()
	const endpoints = new Map<string, { endpoint: RemoteRelayEndpoint; completed: Set<string>; inFlight: Map<string, Promise<void>> }>()
	const pendingDeliveries = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
	let resolveReady!: () => void
	let rejectReady!: (error: Error) => void
	const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
	const send = (frame: RelayFrame): void => {
		if (socket.readyState !== socket.OPEN) throw new Error("relay WebSocket is not open")
		socket.send(JSON.stringify(frame))
	}
	const rejectAll = (error: Error): void => {
		if (socket.readyState === socket.CONNECTING) rejectReady(error)
		for (const item of pending.values()) item.reject(error)
		pending.clear()
		for (const item of pendingDeliveries.values()) item.reject(error)
		pendingDeliveries.clear()
	}
	const removeMessage = addSocketListener(socket, "message", (event) => {
		try {
			const frame = parseFrame(event.data)
			if (!frame) return
			if (frame.type === "buddy-relay/response") {
				const item = pending.get(frame.requestId)
				if (!item) return
				pending.delete(frame.requestId)
				item.resolve(frame.response)
				return
			}
			if (frame.type === "buddy-relay/event") {
				subscriptions.get(frame.subscriptionId)?.(structuredClone(frame.event))
				return
			}
			if (frame.type === "buddy-relay/task") {
				const endpointState = endpoints.get(frame.envelope.recipient?.id ?? "")
				if (!endpointState) {
					send({ type: "buddy-relay/task-ack", deliveryId: frame.deliveryId, ok: false, error: "recipient endpoint is not registered" })
					return
				}
				const messageId = frame.envelope.messageId
				const delivery = endpointState.completed.has(messageId)
					? Promise.resolve()
					: endpointState.inFlight.get(messageId) ?? Promise.resolve().then(() => endpointState.endpoint.accept(structuredClone(frame.envelope)))
				if (!endpointState.completed.has(messageId) && !endpointState.inFlight.has(messageId)) endpointState.inFlight.set(messageId, delivery)
				delivery
					.then(() => {
						endpointState.inFlight.delete(messageId)
						endpointState.completed.add(messageId)
						send({ type: "buddy-relay/task-ack", deliveryId: frame.deliveryId, ok: true })
					})
					.catch((error) => {
						endpointState.inFlight.delete(messageId)
						send({ type: "buddy-relay/task-ack", deliveryId: frame.deliveryId, ok: false, error: error instanceof Error ? error.message : "endpoint rejected task" })
					})
				return
			}
			if (frame.type === "buddy-relay/task-ack") {
				const item = pendingDeliveries.get(frame.deliveryId)
				if (!item) return
				pendingDeliveries.delete(frame.deliveryId)
				if (frame.ok) item.resolve()
				else item.reject(new Error(frame.error ?? "remote endpoint rejected task"))
			}
		} catch {
			// Invalid carrier frames never escape the transport boundary.
		}
	})
	let disconnected = false
	const disconnect = (error: Error): void => {
		if (disconnected) return
		disconnected = true
		rejectAll(error)
		options.onClose?.(error)
	}
	const removeError = addSocketListener(socket, "error", (event) => disconnect(new Error(String(event.data ?? "relay WebSocket failed"))))
	const removeClose = addSocketListener(socket, "close", () => disconnect(new Error("relay WebSocket closed")))
	if (socket.readyState === socket.OPEN) resolveReady()
	else if (socket.readyState === socket.CONNECTING) {
		const removeOpen = addSocketListener(socket, "open", () => { removeOpen(); resolveReady() })
		void removeOpen
	} else rejectReady(new Error("relay WebSocket is not connectable"))

	const request = async (input: RemoteRelayRequest): Promise<RemoteRelayResponse> => {
		await ready
		const requestId = input.requestId
		const response = new Promise<RemoteRelayResponse>((resolve, reject) => pending.set(requestId, { resolve, reject }))
		send({ type: "buddy-relay/request", requestId, request: structuredClone(input) })
		return response
	}
	const registerEndpoint = (input: Extract<RemoteRelayRequest, { kind: "endpoint.register" }>, endpoint: RemoteRelayEndpoint): (() => void) => {
		endpoints.set(endpoint.identity.id, { endpoint, completed: new Set(), inFlight: new Map() })
		void ready.then(() => send({ type: "buddy-relay/endpoint-ready", identityId: endpoint.identity.id })).catch(() => undefined)
		return () => endpoints.delete(endpoint.identity.id)
	}
	const subscribe = (input: { requestId: string; credential: RemoteRelayCredential; scope: EventQueryScope; sinceEventId?: string; grant?: FederatedRoomGrant }, handler: (event: BuddyEvent) => void): (() => void) => {
		const subscriptionId = id("subscription")
		subscriptions.set(subscriptionId, handler)
		void ready.then(() => send({ type: "buddy-relay/subscribe", subscriptionId, credential: structuredClone(input.credential), scope: structuredClone(input.scope), sinceEventId: input.sinceEventId, ...(input.grant ? { grant: structuredClone(input.grant) } : {}) })).catch(() => undefined)
		return () => {
			subscriptions.delete(subscriptionId)
			if (socket.readyState === socket.OPEN) send({ type: "buddy-relay/unsubscribe", subscriptionId })
		}
	}
	const close = (): void => {
		removeMessage(); removeError(); removeClose(); socket.close()
	}
	const wire: WebSocketRemoteRelayWire = {
		ready,
		request,
		subscribe,
		registerEndpoint,
		close,
	}
	return wire
}

export function createResilientWebSocketRemoteRelayWire(options: {
	baseUrl: string | URL
	credential: RemoteRelayCredential
	webSocket?: RelayWebSocketFactory
	path?: string
	authToken?: string
	reconnect?: {
		enabled?: boolean
		maxAttempts?: number
		backoffMs?: number | ((attempt: number) => number)
	}
}): ResilientWebSocketRemoteRelayWire {
	const reconnect = options.reconnect ?? {}
	const enabled = reconnect.enabled ?? true
	const maxAttempts = Math.max(0, Math.floor(reconnect.maxAttempts ?? 5))
	const backoff = reconnect.backoffMs ?? 250
	type EndpointRecord = { request: Extract<RemoteRelayRequest, { kind: "endpoint.register" }>; endpoint: RemoteRelayEndpoint; unregister?: () => void }
	type SubscriptionRecord = { input: { requestId: string; credential: RemoteRelayCredential; scope: EventQueryScope; sinceEventId?: string; grant?: FederatedRoomGrant }; handler: (event: BuddyEvent) => void; sinceEventId?: string; unsubscribe?: () => void }
	const endpoints = new Map<string, EndpointRecord>()
	const subscriptions = new Map<string, SubscriptionRecord>()
	const listeners = new Set<(status: RemoteRelayConnectionStatus) => void>()
	let current: WebSocketRemoteRelayWire | undefined
	let status: RemoteRelayConnectionStatus = "connecting"
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined
	let attempts = 0
	let intentionallyClosed = false
	let initialSettled = false
	let resolveReady!: () => void
	let rejectReady!: (error: Error) => void
	const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })

	const setStatus = (next: RemoteRelayConnectionStatus): void => {
		if (status === next) return
		status = next
		for (const listener of listeners) listener(next)
	}
	const failure = (message: string): Error => new Error(`relay WebSocket ${message}`)
	const nextDelay = (attempt: number): number => Math.max(0, typeof backoff === "function" ? backoff(attempt) : backoff)
	const scheduleReconnect = (error: Error): void => {
		if (intentionallyClosed || status === "closed") return
		setStatus("degraded")
		if (!enabled || attempts >= maxAttempts) {
			setStatus("closed")
			settleInitial(error)
			return
		}
		attempts += 1
		reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect() }, nextDelay(attempts))
	}

	const settleInitial = (error?: Error): void => {
		if (initialSettled) return
		initialSettled = true
		if (error) rejectReady(error)
		else resolveReady()
	}

	const attachSubscription = (record: SubscriptionRecord, wire: WebSocketRemoteRelayWire): void => {
		record.unsubscribe?.()
		record.unsubscribe = wire.subscribe({
			...record.input,
			requestId: id("subscribe"),
			sinceEventId: record.sinceEventId ?? record.input.sinceEventId,
		}, (event) => {
			record.sinceEventId = event.id
			record.handler(structuredClone(event))
		})
	}

	const connect = (): void => {
		if (intentionallyClosed || status === "closed") return
		setStatus(attempts === 0 ? "connecting" : "degraded")
		let wire: WebSocketRemoteRelayWire
		try {
			wire = createWebSocketRemoteRelayWire({
				baseUrl: options.baseUrl,
				credential: structuredClone(options.credential),
				webSocket: options.webSocket,
				path: options.path,
				authToken: options.authToken,
					onClose: (error) => {
					if (current !== wire || intentionallyClosed) return
					current = undefined
					for (const endpoint of endpoints.values()) endpoint.unregister = undefined
					for (const subscription of subscriptions.values()) subscription.unsubscribe = undefined
					scheduleReconnect(error)
				},
			})
		} catch (error) {
				const failureError = error instanceof Error ? error : failure("could not be created")
				if (!enabled || attempts >= maxAttempts) {
					setStatus("closed")
					settleInitial(failureError)
					return
				}
				attempts += 1
				reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect() }, nextDelay(attempts))
				return
		}
		current = wire
		void wire.ready.then(async () => {
			if (current !== wire || intentionallyClosed) return
			for (const endpoint of endpoints.values()) {
				const result = await wire.request({ ...endpoint.request, requestId: id("endpoint") })
				if (!result.ok) throw new Error(result.error?.message ?? "relay endpoint registration failed")
				endpoint.unregister = await wire.registerEndpoint({ ...endpoint.request, requestId: id("endpoint") }, endpoint.endpoint)
			}
			for (const subscription of subscriptions.values()) attachSubscription(subscription, wire)
			attempts = 0
			setStatus("ready")
			settleInitial()
		}).catch((error) => {
			if (current !== wire || intentionallyClosed) return
			current = undefined
			wire.close()
			scheduleReconnect(error instanceof Error ? error : failure("connection setup failed"))
		})
	}

	const request = async (input: RemoteRelayRequest): Promise<RemoteRelayResponse> => {
		const wire = current
		if (!wire) throw failure("is unavailable")
		return wire.request(input)
	}
	const registerEndpoint = async (input: Extract<RemoteRelayRequest, { kind: "endpoint.register" }>, endpoint: RemoteRelayEndpoint): Promise<() => void> => {
		endpoints.get(endpoint.identity.id)?.unregister?.()
		const record: EndpointRecord = { request: structuredClone(input), endpoint }
		endpoints.set(endpoint.identity.id, record)
		if (current && status === "ready") record.unregister = await current.registerEndpoint(input, endpoint)
		return () => {
			if (endpoints.get(endpoint.identity.id) === record) {
				record.unregister?.()
				endpoints.delete(endpoint.identity.id)
			}
		}
	}
	const subscribe = (input: { requestId: string; credential: RemoteRelayCredential; scope: EventQueryScope; sinceEventId?: string }, handler: (event: BuddyEvent) => void): (() => void) => {
		const record: SubscriptionRecord = { input: structuredClone(input), handler, sinceEventId: input.sinceEventId }
		subscriptions.set(input.requestId, record)
		if (current && status === "ready") attachSubscription(record, current)
		return () => {
			if (subscriptions.get(input.requestId) === record) {
				record.unsubscribe?.()
				subscriptions.delete(input.requestId)
			}
		}
	}
	const close = (): void => {
		if (intentionallyClosed) return
		intentionallyClosed = true
		if (reconnectTimer) clearTimeout(reconnectTimer)
		reconnectTimer = undefined
		for (const endpoint of endpoints.values()) endpoint.unregister?.()
		for (const subscription of subscriptions.values()) subscription.unsubscribe?.()
		current?.close()
		current = undefined
		setStatus("closed")
		settleInitial(failure("was closed"))
	}

	connect()
	return {
		ready,
		get status() { return status },
		onStatus(listener) { listeners.add(listener); return () => listeners.delete(listener) },
		request,
		subscribe,
		registerEndpoint,
		close,
	}
}

/** Attach a Relay server connection to a browser/Node WebSocket. */
export function attachRemoteRelayWebSocket(socket: RelayWebSocketLike, server: RemoteRelayServer): () => void {
	let connection: RemoteRelayWire | undefined
	const subscriptions = new Map<string, () => void>()
	const endpointDisposers = new Map<string, () => void>()
	const registeredEndpoints = new Map<string, RemoteRelayEndpoint>()
	const deliveryWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
	const send = (frame: RelayFrame): void => {
		if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
	}
	const ensureConnection = (credential: RemoteRelayCredential): RemoteRelayWire => connection ?? (connection = server.connect(credential))
	const removeMessage = addSocketListener(socket, "message", (event) => {
		void (async () => {
			try {
				const frame = parseFrame(event.data)
				if (!frame) return
				if (frame.type === "buddy-relay/request") {
					const response = await ensureConnection(frame.request.credential).request(frame.request)
					if (frame.request.kind === "endpoint.register" && response.ok) {
						const endpointRequest = frame.request
							const remoteEndpoint: RemoteRelayEndpoint = {
							identity: structuredClone(endpointRequest.identity),
							scope: structuredClone(endpointRequest.scope),
							...(endpointRequest.lease ? { lease: structuredClone(endpointRequest.lease as PresenceLease) } : {}),
							accept: (envelope, context?: RelayDeliveryContext) => new Promise<void>((resolve, reject) => {
								const deliveryId = context?.deliveryId ?? id("delivery")
								deliveryWaiters.set(deliveryId, { resolve, reject })
								send({ type: "buddy-relay/task", deliveryId, envelope: structuredClone(envelope), scope: structuredClone(endpointRequest.scope) })
								}),
						}
						const identityId = endpointRequest.identity.id
						endpointDisposers.get(identityId)?.()
						const unregister = server.registerEndpoint(remoteEndpoint, { replay: false, grant: endpointRequest.grant })
						registeredEndpoints.set(identityId, remoteEndpoint)
						endpointDisposers.set(identityId, () => {
							registeredEndpoints.delete(identityId)
							unregister()
						})
					}
					send({ type: "buddy-relay/response", requestId: frame.requestId, response })
					return
				}
				if (frame.type === "buddy-relay/endpoint-ready") {
					const endpoint = registeredEndpoints.get(frame.identityId)
					if (endpoint) server.replayEndpoint(endpoint)
					return
				}
				if (frame.type === "buddy-relay/subscribe") {
					const unsubscribe = ensureConnection(frame.credential).subscribe({ requestId: id("subscribe"), credential: frame.credential, scope: frame.scope, sinceEventId: frame.sinceEventId, ...(frame.grant ? { grant: frame.grant } : {}) }, (event) => send({ type: "buddy-relay/event", subscriptionId: frame.subscriptionId, event }))
					subscriptions.set(frame.subscriptionId, unsubscribe)
					send({ type: "buddy-relay/subscribe-ack", subscriptionId: frame.subscriptionId, ok: true })
					return
				}
				if (frame.type === "buddy-relay/unsubscribe") {
					subscriptions.get(frame.subscriptionId)?.()
					subscriptions.delete(frame.subscriptionId)
					return
				}
				if (frame.type === "buddy-relay/task-ack") {
					const waiter = deliveryWaiters.get(frame.deliveryId)
					if (!waiter) return
					deliveryWaiters.delete(frame.deliveryId)
					if (frame.ok) waiter.resolve()
					else waiter.reject(new Error(frame.error ?? "remote endpoint rejected task"))
				}
			} catch (error) {
				if (frameIsRequest(event.data)) send({ type: "buddy-relay/response", requestId: frameIsRequest(event.data)?.requestId ?? "unknown", response: { requestId: frameIsRequest(event.data)?.requestId ?? "unknown", ok: false, error: { code: "relay_error", message: error instanceof Error ? error.message : "relay request failed" } } })
			}
		})()
	})
	const cleanup = (): void => {
		removeMessage()
		for (const unsubscribe of subscriptions.values()) unsubscribe()
		subscriptions.clear()
		for (const unregister of endpointDisposers.values()) unregister()
		endpointDisposers.clear()
		for (const waiter of deliveryWaiters.values()) waiter.reject(new Error("relay WebSocket closed"))
		deliveryWaiters.clear()
	}
	addSocketListener(socket, "close", cleanup)
	addSocketListener(socket, "error", cleanup)
	return cleanup
}

function frameIsRequest(value: unknown): Extract<RelayFrame, { type: "buddy-relay/request" }> | undefined {
	try {
		const frame = parseFrame(typeof value === "string" ? JSON.parse(value) : value)
		return frame?.type === "buddy-relay/request" ? frame : undefined
	} catch {
		return undefined
	}
}
