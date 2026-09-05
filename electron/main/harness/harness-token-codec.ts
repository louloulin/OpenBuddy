import { createHmac, timingSafeEqual } from "node:crypto";

/** base64url-encode a UTF-8 string (matches Node's "base64url" encoding). */
export function encodeTokenBody(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

/** base64url-decode a UTF-8 string; returns undefined on malformed input. */
export function decodeTokenBody(value: string): string | undefined {
	try {
		return Buffer.from(value, "base64url").toString("utf8");
	} catch {
		return undefined;
	}
}

/** HMAC-SHA256 body signature in base64url form. */
export function tokenSignature(secret: string, body: string): string {
	return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Compare two base64url signatures in constant time, returning true only when
 * they are the same length and byte-for-byte equal.
 */
export function tokenSignatureMatches(expected: string, provided: string): boolean {
	const expectedBytes = Buffer.from(expected);
	const providedBytes = Buffer.from(provided);
	return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}
