import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TruncationBanner } from "../TruncationBanner";
const item = { sessionId: "s1", truncatedAt: "2026-01-01", byteCount: 24000, originalName: "report.pdf" };
describe("TruncationBanner", () => {
  it("renders information and actions", () => { render(<TruncationBanner truncation={item} onDismiss={vi.fn()} onRestore={vi.fn()} />); expect(screen.getByText(/report.pdf/)).toBeTruthy(); expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy(); expect(screen.getByRole("button", { name: /ignore/i })).toBeTruthy(); });
  it("dismisses the current session", () => { const dismiss = vi.fn(); render(<TruncationBanner truncation={item} onDismiss={dismiss} onRestore={vi.fn()} />); fireEvent.click(screen.getByRole("button", { name: /ignore/i })); expect(dismiss).toHaveBeenCalledWith("s1"); });
  it("switches content when the session changes", () => { const { rerender } = render(<TruncationBanner truncation={item} onDismiss={vi.fn()} onRestore={vi.fn()} />); rerender(<TruncationBanner truncation={{ ...item, sessionId: "s2", originalName: "notes.docx" }} onDismiss={vi.fn()} onRestore={vi.fn()} />); expect(screen.getByText(/notes.docx/)).toBeTruthy(); expect(screen.queryByText(/report.pdf/)).toBeNull(); });
  it("calls typed restore action", () => { const restore = vi.fn(); render(<TruncationBanner truncation={item} onDismiss={vi.fn()} onRestore={restore} />); fireEvent.click(screen.getByRole("button", { name: /restore/i })); expect(restore).toHaveBeenCalledWith("s1"); });
  it("has polite status accessibility", () => { render(<TruncationBanner truncation={item} onDismiss={vi.fn()} onRestore={vi.fn()} />); expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite"); });
  it("renders the latest item supplied for one session", () => { const latest = { ...item, byteCount: 42 }; const { rerender } = render(<TruncationBanner truncation={item} onDismiss={vi.fn()} onRestore={vi.fn()} />); rerender(<TruncationBanner truncation={latest} onDismiss={vi.fn()} onRestore={vi.fn()} />); expect(screen.getByText(/42 bytes/)).toBeTruthy(); });
});
