import { decodeTokenBody, encodeTokenBody, tokenSignature, tokenSignatureMatches } from "./harness-token-codec";

export type HarnessResumeCursor = {
  sequence?: number;
  sessions?: Record<string, number>;
};

type HarnessResumePayload = {
  version: 1 | 2;
  identity: string;
  audience?: string;
  expiresAt: number;
  cursor: HarnessResumeCursor;
};

function validCursor(value: unknown): value is HarnessResumeCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as { sequence?: unknown; sessions?: unknown };
  if (cursor.sequence !== undefined && (!Number.isSafeInteger(cursor.sequence) || (cursor.sequence as number) < 0)) return false;
  if (cursor.sessions !== undefined) {
    if (!cursor.sessions || typeof cursor.sessions !== "object" || Array.isArray(cursor.sessions)) return false;
    for (const [sessionId, sequence] of Object.entries(cursor.sessions)) {
      if (!sessionId || !Number.isSafeInteger(sequence) || sequence < -1) return false;
    }
  }
  return true;
}

export function issueHarnessResumeToken(
  secret: string,
  identity: string,
  cursor: HarnessResumeCursor,
  ttlMs = 24 * 60 * 60 * 1000,
  now = Date.now(),
  audience?: string,
): string {
  if (!secret) throw new Error("Harness resume token secret is required");
  if (!identity) throw new Error("Harness resume token identity is required");
  if (audience !== undefined && !audience) throw new Error("Harness resume token audience is required");
  if (!validCursor(cursor)) throw new Error("Harness resume cursor is invalid");
  const payload: HarnessResumePayload = {
    version: audience === undefined ? 1 : 2,
    identity,
    ...(audience === undefined ? {} : { audience }),
    expiresAt: now + ttlMs,
    cursor: {
      ...(cursor.sequence === undefined ? {} : { sequence: cursor.sequence }),
      ...(cursor.sessions === undefined ? {} : { sessions: { ...cursor.sessions } }),
    },
  };
  const body = encodeTokenBody(JSON.stringify(payload));
  return `${body}.${tokenSignature(secret, body)}`;
}

export function verifyHarnessResumeToken(
  token: string,
  secret: string,
  identity: string,
  now = Date.now(),
  audience?: string,
): HarnessResumeCursor | undefined {
  if (!token || !secret || !identity) return undefined;
  const [body, provided] = token.split(".");
  if (!body || !provided) return undefined;
  if (!tokenSignatureMatches(tokenSignature(secret, body), provided)) return undefined;
  const decoded = decodeTokenBody(body);
  if (!decoded) return undefined;
  try {
    const value = JSON.parse(decoded) as Partial<HarnessResumePayload>;
    const expiresAt = value.expiresAt;
    if (value.version !== 1 && value.version !== 2) return undefined;
    if (value.identity !== identity || value.version === 2 && (audience === undefined || value.audience !== audience) || value.version === 1 && audience !== undefined) return undefined;
    if (!Number.isSafeInteger(expiresAt) || (expiresAt as number) <= now || !validCursor(value.cursor)) return undefined;
    return value.cursor;
  } catch {
    return undefined;
  }
}
