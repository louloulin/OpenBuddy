import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type SessionAttachment = {
	attachmentId: string;
	sessionId: string;
	mediaType: string;
	bytes: number;
	sha256: string;
	createdAt: string;
	name?: string;
};

export type SaveSessionAttachment = {
	sessionId: string;
	mediaType: string;
	data: string;
	name?: string;
};

export type StoredSessionAttachment = {
	attachment: SessionAttachment;
	data: Uint8Array;
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ID_PATTERN = /^att-[0-9a-f-]{36}$/;

function safeSegment(value: string, label: string): string {
	if (!value || value === "." || value === ".." || /[\\/\0]/u.test(value)) {
		throw Object.assign(new Error(`${label} is invalid`), { code: "bad-request" });
	}
	return value;
}

function decodeBase64(value: string): Uint8Array {
	const normalized = value.replace(/\s+/gu, "");
	if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
		throw Object.assign(new Error("attachment data must be valid base64"), { code: "bad-request" });
	}
	const data = Buffer.from(normalized, "base64");
	if (data.length === 0) throw Object.assign(new Error("attachment data must not be empty"), { code: "bad-request" });
	return new Uint8Array(data);
}

function assertImageSignature(data: Uint8Array, mediaType: string): void {
	const startsWith = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
	const valid = mediaType === "image/png"
		? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
		: mediaType === "image/jpeg"
			? startsWith(0xff, 0xd8, 0xff)
			: mediaType === "image/gif"
				? startsWith(0x47, 0x49, 0x46, 0x38)
				: mediaType === "image/webp"
					? startsWith(0x52, 0x49, 0x46, 0x46) && data.length >= 12 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
						: false;
	if (mediaType === "image/webp") {
		if (!valid) throw Object.assign(new Error("attachment bytes do not match media type"), { code: "bad-request" });
		return;
	}
	if (!valid) throw Object.assign(new Error("attachment bytes do not match media type"), { code: "bad-request" });
}

function cleanName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const leaf = value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1)
		.replace(/[\u0000-\u001f\u007f]/gu, "")
		.trim()
		.slice(0, 255);
	return leaf || undefined;
}

export class SessionAttachmentStore {
	constructor(private readonly root: string, private readonly maxBytes = MAX_ATTACHMENT_BYTES) {}

	private directory(sessionId: string): string {
		return join(resolve(this.root), encodeURIComponent(safeSegment(sessionId, "sessionId")));
	}

	private metadataPath(sessionId: string, attachmentId: string): string {
		safeSegment(sessionId, "sessionId");
		if (!ID_PATTERN.test(attachmentId)) throw Object.assign(new Error("attachmentId is invalid"), { code: "bad-request" });
		return join(this.directory(sessionId), `${attachmentId}.json`);
	}

	private dataPath(sessionId: string, attachmentId: string): string {
		return this.metadataPath(sessionId, attachmentId).replace(/\.json$/u, ".bin");
	}

	async save(input: SaveSessionAttachment): Promise<SessionAttachment> {
		if (!MEDIA_TYPES.has(input.mediaType)) {
			throw Object.assign(new Error(`unsupported attachment media type: ${input.mediaType}`), { code: "bad-request" });
		}
		const data = decodeBase64(input.data);
		assertImageSignature(data, input.mediaType);
		if (data.byteLength > this.maxBytes) {
			throw Object.assign(new Error(`attachment exceeds ${this.maxBytes} bytes`), { code: "bad-request" });
		}
		const sessionId = safeSegment(input.sessionId, "sessionId");
		const attachmentId = `att-${randomUUID()}`;
		const attachment: SessionAttachment = {
			attachmentId,
			sessionId,
			mediaType: input.mediaType,
			bytes: data.byteLength,
			sha256: createHash("sha256").update(data).digest("hex"),
			createdAt: new Date().toISOString(),
			...(cleanName(input.name) ? { name: cleanName(input.name) } : {}),
		};
		const metadataPath = this.metadataPath(sessionId, attachmentId);
		const dataPath = this.dataPath(sessionId, attachmentId);
		await mkdir(dirname(metadataPath), { recursive: true, mode: 0o700 });
		const temporaryDataPath = `${dataPath}.${process.pid}.${randomUUID()}.tmp`;
		const temporaryMetadataPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryDataPath, data, { mode: 0o600 });
			await rename(temporaryDataPath, dataPath);
			await writeFile(temporaryMetadataPath, `${JSON.stringify(attachment)}\n`, { mode: 0o600 });
			await rename(temporaryMetadataPath, metadataPath);
			return attachment;
		} finally {
			await rm(temporaryDataPath, { force: true }).catch(() => undefined);
			await rm(temporaryMetadataPath, { force: true }).catch(() => undefined);
		}
	}

	async read(sessionId: string, attachmentId: string): Promise<StoredSessionAttachment> {
		const metadataPath = this.metadataPath(sessionId, attachmentId);
		const dataPath = this.dataPath(sessionId, attachmentId);
		let attachment: SessionAttachment;
		try {
			attachment = JSON.parse(await readFile(metadataPath, "utf8")) as SessionAttachment;
		} catch {
			throw Object.assign(new Error(`attachment not found: ${attachmentId}`), { code: "lookup-not-found" });
		}
		if (attachment.sessionId !== sessionId || attachment.attachmentId !== attachmentId) {
			throw Object.assign(new Error("attachment does not belong to this session"), { code: "lookup-not-found" });
		}
		const data = new Uint8Array(await readFile(dataPath));
		if (data.byteLength !== attachment.bytes || createHash("sha256").update(data).digest("hex") !== attachment.sha256) {
			throw Object.assign(new Error("attachment integrity check failed"), { code: "internal" });
		}
		return { attachment, data };
	}
}
