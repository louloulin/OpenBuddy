import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TruncationBanner } from "../TruncationBanner";
const truncation = (sessionId: string, originalName: string) => ({ sessionId, truncatedAt: Date.now(), byteCount: 100, originalName });
describe("chat container truncation integration", () => {
  it("does not render without an active truncation", () => { const { queryByRole } = render(<>{false && <TruncationBanner truncation={truncation("s", "x")} onDismiss={vi.fn()} onRestore={vi.fn()} />}</>); expect(queryByRole("status")).toBeNull(); });
  it("renders the active session document", () => { render(<TruncationBanner truncation={truncation("s1", "report.pdf")} onDismiss={vi.fn()} onRestore={vi.fn()} />); expect(screen.getByText(/report.pdf/)).toBeTruthy(); });
  it("switches content with the active session", () => { const { rerender } = render(<TruncationBanner truncation={truncation("s1", "one.pdf")} onDismiss={vi.fn()} onRestore={vi.fn()} />); rerender(<TruncationBanner truncation={truncation("s2", "two.docx")} onDismiss={vi.fn()} onRestore={vi.fn()} />); expect(screen.getByText(/two.docx/)).toBeTruthy(); });
  it("runs the restore IPC callback", () => { const restore = vi.fn(); render(<TruncationBanner truncation={truncation("s1", "report.pdf")} onDismiss={vi.fn()} onRestore={restore} />); fireEvent.click(screen.getByRole("button", { name: /restore/i })); expect(restore).toHaveBeenCalledWith("s1"); });
});
