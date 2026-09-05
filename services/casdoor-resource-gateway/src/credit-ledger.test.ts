import { describe, expect, it } from "vitest";
import { creditLedgerEntryHash, creditLedgerIntegrity } from "./credit-ledger.js";
import type { CreditLedgerEntry } from "./store.js";

function entry(id: string, amount = 1): CreditLedgerEntry {
  return { id, tenantId: "tenant-a", subject: "user-a", type: "grant", amount, unit: "points", createdAt: "2026-08-30T00:00:00.000Z" };
}

describe("credit ledger integrity", () => {
  it("backfills a legacy prefix without accepting a broken hashed suffix", () => {
    const legacy = entry("legacy");
    const hashed = entry("hashed", 2);
    hashed.previousHash = "";
    hashed.entryHash = creditLedgerEntryHash(hashed, "");
    const state = { creditLedger: [legacy, hashed] };

    expect(creditLedgerIntegrity(state)).toMatchObject({ status: "backfillable", checked: 2 });
    expect(creditLedgerIntegrity(state, true)).toMatchObject({ status: "verified", checked: 2 });
    expect(state.creditLedger.every((item) => /^[a-f0-9]{64}$/.test(item.entryHash ?? ""))).toBe(true);
    expect(creditLedgerIntegrity(state)).toMatchObject({ status: "verified", checked: 2 });
  });

  it("rejects a tampered hashed suffix during legacy migration", () => {
    const legacy = entry("legacy");
    const hashed = entry("hashed", 2);
    hashed.previousHash = "";
    hashed.entryHash = creditLedgerEntryHash(hashed, "");
    hashed.amount = 3;
    const state = { creditLedger: [legacy, hashed] };

    expect(creditLedgerIntegrity(state)).toMatchObject({ status: "invalid", firstInvalidId: "hashed" });
    expect(creditLedgerIntegrity(state, true)).toMatchObject({ status: "invalid", firstInvalidId: "hashed" });
    expect(legacy.entryHash).toBeUndefined();
  });

  it("starts verification from the retained-window anchor", () => {
    const hashed = entry("retained");
    hashed.previousHash = "a".repeat(64);
    hashed.entryHash = creditLedgerEntryHash(hashed, hashed.previousHash);
    const state = { creditLedger: [hashed], creditLedgerAnchorHash: "a".repeat(64) };

    expect(creditLedgerIntegrity(state)).toMatchObject({ status: "verified", creditLedgerAnchorHash: "a".repeat(64), headHash: hashed.entryHash });
  });
});
