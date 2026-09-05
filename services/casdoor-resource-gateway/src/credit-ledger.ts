import { createHash } from "node:crypto";
import type { CreditLedgerEntry, ResourceStoreState } from "./store.js";

export type CreditLedgerIntegrityResult = {
  status: "verified" | "backfillable" | "invalid";
  checked: number;
  creditLedgerAnchorHash?: string;
  headHash?: string;
  firstInvalidId?: string;
};

function creditLedgerHashInput(entry: CreditLedgerEntry): Record<string, unknown> {
  const { entryHash: _entryHash, ...withoutHash } = entry;
  return withoutHash;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function creditLedgerEntryHash(entry: CreditLedgerEntry, previousHash: string): string {
  return createHash("sha256").update(canonicalJson({ ...creditLedgerHashInput(entry), previousHash })).digest("hex");
}

export function creditLedgerIntegrity(state: Pick<ResourceStoreState, "creditLedger" | "creditLedgerAnchorHash">, repairLegacy = false): CreditLedgerIntegrityResult {
  const anchor = state.creditLedgerAnchorHash ? { creditLedgerAnchorHash: state.creditLedgerAnchorHash } : {};
  let previousHash = state.creditLedgerAnchorHash ?? "";
  let hashedEntries = 0;
  let unhashEntries = 0;
  let legacyPrefix = true;
  let firstInvalidId: string | undefined;
  for (const entry of state.creditLedger) {
    const legacy = !entry.previousHash && !entry.entryHash;
    if (legacy) {
      if (!legacyPrefix) firstInvalidId ??= entry.id;
      unhashEntries += 1;
      continue;
    }
    legacyPrefix = false;
    hashedEntries += 1;
    if (entry.previousHash !== previousHash || entry.entryHash !== creditLedgerEntryHash(entry, entry.previousHash ?? "")) firstInvalidId ??= entry.id;
    previousHash = entry.entryHash ?? previousHash;
  }
  if (firstInvalidId) return { status: "invalid", checked: state.creditLedger.length, ...anchor, ...(previousHash ? { headHash: previousHash } : {}), firstInvalidId };
  if (unhashEntries > 0) {
    if (repairLegacy) {
      previousHash = state.creditLedgerAnchorHash ?? "";
      for (const entry of state.creditLedger) {
        entry.previousHash = previousHash;
        entry.entryHash = creditLedgerEntryHash(entry, previousHash);
        previousHash = entry.entryHash;
      }
      return { status: "verified", checked: state.creditLedger.length, ...anchor, ...(previousHash ? { headHash: previousHash } : {}) };
    }
    return { status: "backfillable", checked: state.creditLedger.length, ...anchor, ...(previousHash ? { headHash: previousHash } : {}) };
  }
  if (hashedEntries === 0) return { status: "verified", checked: 0, ...anchor };
  return { status: "verified", checked: state.creditLedger.length, ...anchor, ...(previousHash ? { headHash: previousHash } : {}) };
}

export function trimCreditLedger(state: Pick<ResourceStoreState, "creditLedger" | "creditLedgerAnchorHash">): void {
  if (state.creditLedger.length <= 200_000) return;
  const removedCount = state.creditLedger.length - 200_000;
  const removedTailHash = state.creditLedger[removedCount - 1]?.entryHash;
  if (removedTailHash) state.creditLedgerAnchorHash = removedTailHash;
  state.creditLedger = state.creditLedger.slice(-200_000);
}
