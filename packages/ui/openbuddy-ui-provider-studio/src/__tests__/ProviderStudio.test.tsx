import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { ProviderStudio } from "../components/index.js";

const providers = [
  { id: "openai", name: "OpenAI", kind: "openai-compatible" as const, status: "configured" as const },
  { id: "anthropic", name: "Anthropic", kind: "anthropic" as const, status: "missing" as const, connectLabel: "Connect with Anthropic" },
  { id: "azure", name: "Azure OpenAI", kind: "azure-openai" as const, status: "error" as const, errorMessage: "Invalid endpoint" },
];

describe("ProviderStudio", () => {
  it("renders a card per provider", () => {
    render(<ProviderStudio providers={providers} />);
    expect(screen.getByTestId("provider-openai")).toBeTruthy();
    expect(screen.getByTestId("provider-anthropic")).toBeTruthy();
    expect(screen.getByTestId("provider-azure")).toBeTruthy();
  });

  it("calls onConfigure when Configure is clicked", () => {
    const fn = vi.fn();
    render(<ProviderStudio providers={providers} onConfigure={fn} />);
    fireEvent.click(screen.getByTestId("provider-configure-openai"));
    expect(fn).toHaveBeenCalledWith("openai");
  });

  it("calls onConnect when the OAuth connect button is clicked", () => {
    const fn = vi.fn();
    render(<ProviderStudio providers={providers} onConnect={fn} />);
    fireEvent.click(screen.getByTestId("provider-connect-anthropic"));
    expect(fn).toHaveBeenCalledWith("anthropic");
  });

  it("calls onTest and disables the button while testing", async () => {
    let resolve: () => void = () => {};
    const fn = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<ProviderStudio providers={providers} onTest={fn} />);
    fireEvent.click(screen.getByTestId("provider-test-openai"));
    expect(screen.getByTestId("provider-test-openai").textContent).toBe("Testing…");
    resolve();
    await waitFor(() => {
      expect(screen.getByTestId("provider-test-openai").textContent).toBe("Test");
    });
    expect(fn).toHaveBeenCalledWith("openai");
  });

  it("renders the error message verbatim", () => {
    render(<ProviderStudio providers={providers} />);
    expect(screen.getByText("Invalid endpoint")).toBeTruthy();
  });
});
