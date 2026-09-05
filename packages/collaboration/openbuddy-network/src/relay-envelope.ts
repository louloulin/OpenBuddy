import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import type { BuddyScope, BuddyTaskEnvelope, FederatedRoomGrant } from "@openbuddy/collaboration-protocol"

export interface RelayEncryptedDeliveryRecord {
	deliveryId: string
	messageId: string
	recipientId: string
	scope: BuddyScope
	algorithm: "AES-256-GCM"
	keyRef: string
	nonce: string
	authTag: string
	ciphertext: string
	updatedAt: string
}

export interface RelayEnvelopeCodec {
	encrypt(input: { deliveryId: string; envelope: BuddyTaskEnvelope; scope: BuddyScope; grant?: FederatedRoomGrant; updatedAt: string }): RelayEncryptedDeliveryRecord
	decrypt(record: RelayEncryptedDeliveryRecord): { envelope: BuddyTaskEnvelope; scope: BuddyScope; grant?: FederatedRoomGrant }
}

function base64url(value: Buffer): string {
	return value.toString("base64url")
}

function fromBase64url(value: string): Buffer {
	return Buffer.from(value, "base64url")
}

function aad(record: Pick<RelayEncryptedDeliveryRecord, "deliveryId" | "messageId" | "recipientId" | "keyRef">): Buffer {
	return Buffer.from(`${record.deliveryId}:${record.messageId}:${record.recipientId}:${record.keyRef}`, "utf8")
}

export function createAes256GcmRelayEnvelopeCodec(secret: string, keyRef = "relay-aes256-gcm"): RelayEnvelopeCodec {
	if (!secret) throw new Error("relay envelope encryption secret is required")
	const key = createHash("sha256").update(secret, "utf8").digest()
	return {
		encrypt(input) {
			const nonce = randomBytes(12)
			const record = {
				deliveryId: input.deliveryId,
				messageId: input.envelope.messageId,
				recipientId: input.envelope.recipient?.id ?? "",
				keyRef,
			}
			const cipher = createCipheriv("aes-256-gcm", key, nonce)
			cipher.setAAD(aad(record))
			const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ envelope: input.envelope, scope: input.scope, ...(input.grant ? { grant: input.grant } : {}) }), "utf8"), cipher.final()])
			return {
				...record,
				scope: structuredClone(input.scope),
				algorithm: "AES-256-GCM",
				nonce: base64url(nonce),
				authTag: base64url(cipher.getAuthTag()),
				ciphertext: base64url(ciphertext),
				updatedAt: input.updatedAt,
			}
		},
		decrypt(record) {
			if (record.algorithm !== "AES-256-GCM" || record.keyRef !== keyRef) throw new Error("relay envelope codec does not match record")
			const decipher = createDecipheriv("aes-256-gcm", key, fromBase64url(record.nonce))
			decipher.setAAD(aad(record))
			decipher.setAuthTag(fromBase64url(record.authTag))
			const plaintext = Buffer.concat([decipher.update(fromBase64url(record.ciphertext)), decipher.final()]).toString("utf8")
			const decoded = JSON.parse(plaintext) as { envelope?: BuddyTaskEnvelope; scope?: BuddyScope; grant?: FederatedRoomGrant }
			if (!decoded.envelope || decoded.envelope.messageId !== record.messageId || decoded.envelope.recipient?.id !== record.recipientId || !decoded.scope?.communityId) throw new Error("relay encrypted envelope is invalid")
			return { envelope: structuredClone(decoded.envelope), scope: structuredClone(decoded.scope), ...(decoded.grant ? { grant: structuredClone(decoded.grant) } : {}) }
		},
	}
}
