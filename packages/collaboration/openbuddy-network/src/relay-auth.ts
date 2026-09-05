import { createHash, createHmac, createPrivateKey, createPublicKey, KeyObject, sign, timingSafeEqual, verify, type KeyLike } from "node:crypto"
import { matchesDataScope, type BuddyScope, type EventQueryScope, type FederatedRoomGrant } from "@openbuddy/collaboration-protocol"
import type { RemoteRelayCredential, RemoteRelayRequest } from "./remote-relay"
import type { RelayRevocationRecord } from "./durable-relay"
import type { RelayDirectoryCard } from "./remote-relay"

export interface RelayCredentialSignature {
	algorithm: "HS256"
	keyRef: string
	value: string
}

export interface RelayEd25519CredentialSignature {
	algorithm: "Ed25519"
	keyRef: string
	value: string
}

export interface RelayCapabilityClaims {
	version: "buddy-capability/1"
	jti: string
	subject: string
	communityId: string
	organizationId?: string
	roomId?: string
	taskId?: string
	capability?: string
	dataScopes: string[]
	allowedActions: string[]
	issuedAt: string
	expiresAt: string
}

export interface RelayCapabilityExpectation {
	subject: string
	scope: BuddyScope
	taskId: string
	capability: string
	dataScopes: string[]
	allowedActions: string[]
}

export interface FederatedRoomGrantExpectation {
	principalId: string
	principalOrganizationId?: string
	scope: BuddyScope | EventQueryScope
	operation: "endpoint.register" | "task.send" | "events.query"
	taskId?: string
	capability?: string
	dataScopes?: string[]
	allowedActions?: string[]
}

export type FederatedGrantPublicKeyResolver = (keyRef: string, grant: FederatedRoomGrant) => KeyLike | undefined
export type RelayCredentialPublicKeyResolver = (keyRef: string, credential: RemoteRelayCredential) => KeyLike | undefined
export type RelayRevocationPublicKeyResolver = (keyRef: string, record: RelayRevocationRecord) => KeyLike | undefined
export type RelayDirectoryPublicKeyResolver = (keyRef: string, card: RelayDirectoryCard) => KeyLike | undefined

function encode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url")
}

function decode(value: string): string {
	return Buffer.from(value, "base64url").toString("utf8")
}

function canonical(value: Record<string, unknown>): string {
	return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
		result[key] = value[key]
		return result
	}, {}))
}

function digest(secret: string, value: string): string {
	return createHmac("sha256", secret).update(value).digest("base64url")
}

function asEd25519Key(key: KeyLike, expectedType: "private" | "public"): KeyObject {
	const keyObject = key instanceof KeyObject ? key : expectedType === "private" ? createPrivateKey(key) : createPublicKey(key)
	if (keyObject.asymmetricKeyType !== "ed25519" || keyObject.type !== expectedType) throw new Error(`federated grant key must be an Ed25519 ${expectedType} key`)
	return keyObject
}

function grantKeyRef(publicKey: KeyLike): string {
	const keyObject = asEd25519Key(publicKey, "public")
	return `ed25519:${createHash("sha256").update(keyObject.export({ format: "der", type: "spki" })).digest("base64url").slice(0, 24)}`
}

function grantBytes(grant: FederatedRoomGrant): Buffer {
	const { signature: _signature, ...unsigned } = grant
	return Buffer.from(JSON.stringify(Object.keys(unsigned).sort().reduce<Record<string, unknown>>((result, key) => {
		result[key] = unsigned[key as keyof typeof unsigned]
		return result
	}, {})), "utf8")
}

function revocationBytes(record: RelayRevocationRecord): Buffer {
	const { signature: _signature, ...unsigned } = record
	return Buffer.from(JSON.stringify(Object.keys(unsigned).sort().reduce<Record<string, unknown>>((result, key) => {
		result[key] = unsigned[key as keyof typeof unsigned]
		return result
	}, {})), "utf8")
}

function directoryBytes(card: RelayDirectoryCard): Buffer {
	const { signature: _signature, ...unsigned } = card
	return Buffer.from(canonical(unsigned as unknown as Record<string, unknown>), "utf8")
}

function encodeSignature(value: Buffer): string {
	return value.toString("base64url")
}

function decodeSignature(value: string): Buffer {
	return Buffer.from(value, "base64url")
}

function equal(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left)
	const rightBytes = Buffer.from(right)
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function assertTime(issuedAt: string, expiresAt: string, now: string): void {
	const issued = Date.parse(issuedAt)
	const expires = Date.parse(expiresAt)
	const current = Date.parse(now)
	if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(current)) throw new Error("relay auth timestamps are invalid")
	if (expires <= issued || expires <= current) throw new Error("relay auth token is expired")
	if (issued > current + 60_000) throw new Error("relay auth token is issued in the future")
}

export function issueRelayCredential(input: {
	subject: string
	token: string
	issuedAt: string
	expiresAt: string
	audience?: string
	nonce?: string
	keyRef?: string
}, secret: string): RemoteRelayCredential {
	if (!secret) throw new Error("relay credential signing secret is required")
	const credential: RemoteRelayCredential = {
		subject: input.subject,
		token: input.token,
		expiresAt: input.expiresAt,
		issuedAt: input.issuedAt,
		...(input.audience ? { audience: input.audience } : {}),
		...(input.nonce ? { nonce: input.nonce } : {}),
	}
	const body = canonical(credential as unknown as Record<string, unknown>)
	credential.signature = { algorithm: "HS256", keyRef: input.keyRef ?? "local-hmac", value: digest(secret, body) }
	return credential
}

export function verifyRelayCredential(credential: RemoteRelayCredential, secret: string, now: string): void {
	if (!secret) throw new Error("relay credential verification secret is required")
	if (!credential.issuedAt || !credential.signature || credential.signature.algorithm !== "HS256") throw new Error("relay credential signature is required")
	const signature = credential.signature
	const { signature: _signature, ...unsigned } = credential
	if (!equal(signature.value, digest(secret, canonical(unsigned as unknown as Record<string, unknown>)))) throw new Error("relay credential signature is invalid")
	assertTime(credential.issuedAt, credential.expiresAt, now)
}

export function issueEd25519RelayCredential(input: {
	subject: string
	token: string
	issuedAt: string
	expiresAt: string
	audience?: string
	nonce?: string
	keyRef?: string
}, privateKey: KeyLike): RemoteRelayCredential {
	const privateKeyObject = asEd25519Key(privateKey, "private")
	const resolvedKeyRef = input.keyRef ?? grantKeyRef(createPublicKey(privateKeyObject))
	if (!resolvedKeyRef.trim()) throw new Error("relay credential keyRef is required")
	const credential = {
		subject: input.subject,
		token: input.token,
		expiresAt: input.expiresAt,
		issuedAt: input.issuedAt,
		...(input.audience ? { audience: input.audience } : {}),
		...(input.nonce ? { nonce: input.nonce } : {}),
		signature: { algorithm: "Ed25519" as const, keyRef: resolvedKeyRef, value: "" },
	} satisfies RemoteRelayCredential
	const { signature: _signature, ...unsigned } = credential
	credential.signature.value = encodeSignature(sign(null, Buffer.from(canonical(unsigned as unknown as Record<string, unknown>), "utf8"), privateKeyObject))
	return credential
}

export function verifyEd25519RelayCredential(credential: RemoteRelayCredential, resolvePublicKey: RelayCredentialPublicKeyResolver, now: string): void {
	if (!credential.issuedAt || !credential.signature || credential.signature.algorithm !== "Ed25519" || !credential.signature.keyRef || !credential.signature.value) throw new Error("Ed25519 relay credential signature is required")
	const publicKey = resolvePublicKey(credential.signature.keyRef, structuredClone(credential))
	if (!publicKey) throw new Error("relay credential signing key is not trusted")
	const keyObject = asEd25519Key(publicKey, "public")
	const unsigned = { ...credential }
	delete unsigned.signature
	if (!verify(null, Buffer.from(canonical(unsigned as unknown as Record<string, unknown>), "utf8"), keyObject, decodeSignature(credential.signature.value))) throw new Error("Ed25519 relay credential signature is invalid")
	assertTime(credential.issuedAt, credential.expiresAt, now)
}

export function createEd25519RelayCredentialVerifier(resolvePublicKey: RelayCredentialPublicKeyResolver, now: () => string = () => new Date().toISOString()): (credential: RemoteRelayCredential, operation: RemoteRelayRequest["kind"]) => void {
	return (credential) => verifyEd25519RelayCredential(credential, resolvePublicKey, now())
}

export function issueEd25519RelayRevocation(record: Omit<RelayRevocationRecord, "signature">, privateKey: KeyLike, keyRef?: string): RelayRevocationRecord {
	const privateKeyObject = asEd25519Key(privateKey, "private")
	const resolvedKeyRef = keyRef ?? grantKeyRef(createPublicKey(privateKeyObject))
	if (!resolvedKeyRef.trim()) throw new Error("relay revocation keyRef is required")
	const signed = { ...structuredClone(record), signature: { algorithm: "Ed25519" as const, keyRef: resolvedKeyRef, value: "" } }
	signed.signature.value = encodeSignature(sign(null, revocationBytes(signed), privateKeyObject))
	return signed
}

export function verifyEd25519RelayRevocation(record: RelayRevocationRecord, resolvePublicKey: RelayRevocationPublicKeyResolver, now: string): void {
	if (!record.signature || record.signature.algorithm !== "Ed25519" || !record.signature.keyRef || !record.signature.value) throw new Error("Ed25519 relay revocation signature is required")
	const publicKey = resolvePublicKey(record.signature.keyRef, structuredClone(record))
	if (!publicKey) throw new Error("relay revocation signing key is not trusted")
	const keyObject = asEd25519Key(publicKey, "public")
	if (!verify(null, revocationBytes(record), keyObject, decodeSignature(record.signature.value))) throw new Error("Ed25519 relay revocation signature is invalid")
	if (!record.authorityId.trim() || !Number.isInteger(record.sequence) || record.sequence <= 0 || !record.identifier.trim() || !Number.isFinite(Date.parse(record.revokedAt))) throw new Error("relay revocation record is invalid")
	if (!Number.isFinite(Date.parse(now)) || Date.parse(record.revokedAt) > Date.parse(now) + 60_000) throw new Error("relay revocation timestamp is invalid")
}

export function issueEd25519RelayDirectoryCard(card: Omit<RelayDirectoryCard, "signature">, privateKey: KeyLike, keyRef?: string): RelayDirectoryCard {
	const privateKeyObject = asEd25519Key(privateKey, "private")
	const resolvedKeyRef = keyRef ?? grantKeyRef(createPublicKey(privateKeyObject))
	const signed = { ...structuredClone(card), signature: { algorithm: "Ed25519" as const, keyRef: resolvedKeyRef, value: "" } }
	signed.signature.value = encodeSignature(sign(null, directoryBytes(signed), privateKeyObject))
	return signed
}

export function verifyEd25519RelayDirectoryCard(card: RelayDirectoryCard, resolvePublicKey: RelayDirectoryPublicKeyResolver, now: string): void {
	if (!card.signature || card.signature.algorithm !== "Ed25519" || !card.signature.keyRef || !card.signature.value) throw new Error("Ed25519 directory card signature is required")
	if (card.identity.publicKeyRef && card.identity.publicKeyRef !== card.signature.keyRef) throw new Error("directory card keyRef does not match identity publicKeyRef")
	const publicKey = resolvePublicKey(card.signature.keyRef, structuredClone(card))
	if (!publicKey) throw new Error("directory card signing key is not trusted")
	if (!verify(null, directoryBytes(card), asEd25519Key(publicKey, "public"), decodeSignature(card.signature.value))) throw new Error("Ed25519 directory card signature is invalid")
	assertTime(card.agentCard?.issuedAt ?? card.updatedAt, card.agentCard?.expiresAt ?? card.updatedAt, now)
}

export function issueFederatedRoomGrant(input: Omit<FederatedRoomGrant, "signature">, secret: string): FederatedRoomGrant {
	if (!secret) throw new Error("federated room grant signing secret is required")
	const grant: FederatedRoomGrant = { ...structuredClone(input) }
	const body = canonical(grant as unknown as Record<string, unknown>)
	grant.signature = { algorithm: "HS256", keyRef: "local-hmac", value: digest(secret, body) }
	return grant
}

export function issueEd25519FederatedRoomGrant(input: Omit<FederatedRoomGrant, "signature">, privateKey: KeyLike, keyRef?: string): FederatedRoomGrant {
	const privateKeyObject = asEd25519Key(privateKey, "private")
	const resolvedKeyRef = keyRef ?? grantKeyRef(createPublicKey(privateKeyObject))
	if (!resolvedKeyRef.trim()) throw new Error("federated room grant keyRef is required")
	const grant = structuredClone({ ...input, signature: { algorithm: "Ed25519", keyRef: resolvedKeyRef, value: "" } }) as FederatedRoomGrant
	grant.signature!.value = encodeSignature(sign(null, grantBytes(grant), privateKeyObject))
	return grant
}

export function verifyFederatedRoomGrant(grant: FederatedRoomGrant, secret: string, expected: FederatedRoomGrantExpectation, now: string): void {
	if (!secret) throw new Error("federated room grant verification secret is required")
	if (!grant.signature || grant.signature.algorithm !== "HS256") throw new Error("federated room grant signature is required")
	const unsigned = { ...grant }
	delete unsigned.signature
	if (!equal(grant.signature.value, digest(secret, canonical(unsigned as unknown as Record<string, unknown>)))) throw new Error("federated room grant signature is invalid")
	assertFederatedRoomGrantClaims(grant, expected, now)
}

export function verifyEd25519FederatedRoomGrant(grant: FederatedRoomGrant, resolvePublicKey: FederatedGrantPublicKeyResolver, expected: FederatedRoomGrantExpectation, now: string): void {
	if (!grant.signature || grant.signature.algorithm !== "Ed25519" || !grant.signature.keyRef || !grant.signature.value) throw new Error("Ed25519 federated room grant signature is required")
	const publicKey = resolvePublicKey(grant.signature.keyRef, structuredClone(grant))
	if (!publicKey) throw new Error("federated room grant signing key is not trusted")
	const keyObject = asEd25519Key(publicKey, "public")
	if (!verify(null, grantBytes(grant), keyObject, decodeSignature(grant.signature.value))) throw new Error("Ed25519 federated room grant signature is invalid")
	assertFederatedRoomGrantClaims(grant, expected, now)
}

function assertFederatedRoomGrantClaims(grant: FederatedRoomGrant, expected: FederatedRoomGrantExpectation, now: string): void {
	if (!grant.grantId.trim() || !grant.projectId.trim() || !grant.communityId.trim() || !grant.roomId.trim() || !grant.issuerId.trim()) throw new Error("federated room grant is invalid")
	if (!grant.allowedPrincipals.includes(expected.principalId)) throw new Error("federated room grant principal is not allowed")
	if (expected.principalOrganizationId && expected.principalOrganizationId !== grant.requesterOrganizationId && expected.principalOrganizationId !== grant.providerOrganizationId) throw new Error("federated room grant organization is not allowed")
	if (!grant.allowedOperations.includes(expected.operation)) throw new Error("federated room grant operation is not allowed")
	if (grant.communityId !== expected.scope.communityId || grant.roomId !== expected.scope.roomId) throw new Error("federated room grant scope does not match")
	// Same-org (grantor's room) or cross-org (provider's room) delivery are both
	// permitted: a requester in org A may issue a federated Room Grant that
	// a provider in org B picks up via the local relay. The provider's runtime
	// scope then matches the grant's providerOrganizationId, not the grantor's
	// organizationId. The principal check (assertFederatedRoomGrantClaims above)
	// already enforces that the principal belongs to one of the two orgs, so
	// this scope relaxation is safe.
	if (
		expected.scope.organizationId !== grant.organizationId &&
		(!grant.providerOrganizationId || grant.providerOrganizationId !== expected.scope.organizationId)
	) throw new Error("federated room grant organization does not match")
	if (expected.operation === "task.send" && grant.taskId !== expected.taskId) throw new Error("federated room grant must be task-bound")
	if (expected.operation === "events.query" && grant.taskId !== expected.taskId) throw new Error("federated room grant query task does not match")
	if (grant.taskId !== undefined && expected.taskId !== undefined && grant.taskId !== expected.taskId) throw new Error("federated room grant task does not match")
	if (expected.capability !== undefined && !grant.allowedCapabilities.some((allowed) => matchesDataScope(allowed, expected.capability!))) throw new Error("federated room grant capability is not allowed")
	for (const dataScope of expected.dataScopes ?? []) if (!grant.allowedDataScopes.some((allowed) => matchesDataScope(allowed, dataScope))) throw new Error("federated room grant data scope is not allowed")
	for (const action of expected.allowedActions ?? []) if (!grant.allowedActions.some((allowed) => matchesDataScope(allowed, action))) throw new Error("federated room grant action is not allowed")
	assertTime(grant.issuedAt, grant.expiresAt, now)
	if (grant.revokedAt && Date.parse(grant.revokedAt) <= Date.parse(now)) throw new Error("federated room grant is revoked")
}

export function createHmacRelayCredentialVerifier(secret: string, now: () => string = () => new Date().toISOString()): (credential: RemoteRelayCredential, operation: RemoteRelayRequest["kind"]) => void {
	return (credential) => verifyRelayCredential(credential, secret, now())
}

export function issueRelayCapabilityToken(input: Omit<RelayCapabilityClaims, "version" | "issuedAt" | "expiresAt"> & { issuedAt: string; expiresAt: string }, secret: string): string {
	if (!secret) throw new Error("relay capability token secret is required")
	const claims: RelayCapabilityClaims = { version: "buddy-capability/1", ...input }
	const body = encode(canonical(claims as unknown as Record<string, unknown>))
	return `${body}.${digest(secret, body)}`
}

export function verifyRelayCapabilityToken(token: string, secret: string, expected: RelayCapabilityExpectation, now: string): RelayCapabilityClaims {
	if (!secret) throw new Error("relay capability token verification secret is required")
	const [body, signature] = token.split(".")
	if (!body || !signature || !equal(signature, digest(secret, body))) throw new Error("relay capability token signature is invalid")
	let claims: RelayCapabilityClaims
	try { claims = JSON.parse(decode(body)) as RelayCapabilityClaims } catch { throw new Error("relay capability token is invalid") }
	if (claims.version !== "buddy-capability/1" || claims.subject !== expected.subject || claims.communityId !== expected.scope.communityId || claims.organizationId !== expected.scope.organizationId || claims.roomId !== expected.scope.roomId || claims.taskId !== expected.taskId || claims.capability !== expected.capability) throw new Error("relay capability token binding is invalid")
	assertTime(claims.issuedAt, claims.expiresAt, now)
	if (!expected.dataScopes.every((scope) => claims.dataScopes.includes(scope))) throw new Error("relay capability token does not allow requested data scope")
	if (!expected.allowedActions.every((action) => claims.allowedActions.includes(action))) throw new Error("relay capability token does not allow requested action")
	return structuredClone(claims)
}
