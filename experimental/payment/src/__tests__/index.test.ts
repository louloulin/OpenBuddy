import { describe, expect, it } from "vitest";
import {
  assertValidPaymentInput,
  type PaymentSessionInput,
} from "../index";

describe("assertValidPaymentInput", () => {
  const valid: PaymentSessionInput = {
    orderNo: "ord_001",
    amountMinor: 9900,
    currency: "CNY",
    planId: "team",
    tenantId: "casdoor/enterprise",
    subject: "alice",
    returnUrl: "https://openbuddy.com/billing/return",
  };

  it("accepts a valid input", () => {
    expect(() => assertValidPaymentInput(valid)).not.toThrow();
  });

  it("rejects amountMinor = 0", () => {
    expect(() => assertValidPaymentInput({ ...valid, amountMinor: 0 })).toThrow(/正整数/);
  });

  it("rejects negative amountMinor", () => {
    expect(() => assertValidPaymentInput({ ...valid, amountMinor: -1 })).toThrow();
  });

  it("rejects non-integer amountMinor", () => {
    expect(() => assertValidPaymentInput({ ...valid, amountMinor: 1.5 })).toThrow();
  });

  it("rejects unsafe integer", () => {
    expect(() => assertValidPaymentInput({ ...valid, amountMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });

  it("rejects invalid currency code", () => {
    expect(() => assertValidPaymentInput({ ...valid, currency: "cny" as never })).toThrow(/ISO 4217/);
  });

  it("rejects malformed orderNo", () => {
    expect(() => assertValidPaymentInput({ ...valid, orderNo: "订单 001" })).toThrow(/OrderNo/);
  });

  it("rejects empty planId", () => {
    expect(() => assertValidPaymentInput({ ...valid, planId: "" })).toThrow(/planId/);
  });

  it("rejects empty tenantId", () => {
    expect(() => assertValidPaymentInput({ ...valid, tenantId: "" })).toThrow(/tenantId/);
  });

  it("rejects empty subject", () => {
    expect(() => assertValidPaymentInput({ ...valid, subject: "" })).toThrow(/subject/);
  });

  it("rejects non-https returnUrl", () => {
    expect(() => assertValidPaymentInput({ ...valid, returnUrl: "javascript:alert(1)" })).toThrow(/http\(s\)/);
  });

  it("accepts walletId", () => {
    expect(() => assertValidPaymentInput({ ...valid, walletId: "marketing-2026" })).not.toThrow();
  });
});
