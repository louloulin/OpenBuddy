/**
 * email-error.test.ts — Phase H.2 tests for the EmailError extraction.
 *
 * Verifies the extracted EmailError class behaves the same as the
 * in-file declaration: typed code, message preservation, name
 * preservation, optional retryAfterMs.
 */

import { describe, expect, it } from "vitest";

import { EmailError } from "./email-error";
import { EmailError as ReExportedEmailError } from "./index";

describe("email-error (Phase H.2)", () => {
  it("preserves the message and sets the name to EmailError", () => {
    const error = new EmailError("invalid_input", "邮件附件必须是绝对路径");
    expect(error.message).toBe("邮件附件必须是绝对路径");
    expect(error.name).toBe("EmailError");
    expect(error.code).toBe("invalid_input");
    expect(error.retryAfterMs).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EmailError);
  });

  it("preserves the optional retryAfterMs", () => {
    const error = new EmailError("provider_unavailable", "请稍后重试", 5000);
    expect(error.code).toBe("provider_unavailable");
    expect(error.retryAfterMs).toBe(5000);
  });

  it("supports all 5 code literals", () => {
    const codes: Array<"provider_unavailable" | "confirmation_required" | "invalid_input" | "operation_failed" | "operation_not_supported"> = [
      "provider_unavailable",
      "confirmation_required",
      "invalid_input",
      "operation_failed",
      "operation_not_supported",
    ];
    for (const code of codes) {
      const error = new EmailError(code, `error: ${code}`);
      expect(error.code).toBe(code);
    }
  });

  it("is also re-exported from ./index for backward compatibility", () => {
    // Phase H.2 contract: external callers keep importing EmailError
    // from "./index" unchanged.
    expect(ReExportedEmailError).toBe(EmailError);
  });
});