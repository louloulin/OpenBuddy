import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GlobalConfirmHost } from "../GlobalConfirmHost";
import { useGlobalConfirmStore } from "@/stores/global-confirm-store";

/**
 * GlobalConfirmHost renders the workbuddy-style `ConfirmDialog` from the
 * shared global store. The component is mounted once near the top of the
 * React tree, replacing the legacy `await confirm(message)` helper that
 * surfaced the unsightly native `dialog.showMessageBox` confirmation.
 */

beforeEach(() => {
  useGlobalConfirmStore.setState({ pending: null });
});

describe("GlobalConfirmHost", () => {
  it("renders nothing when no confirmation is pending", () => {
    const { container } = render(<GlobalConfirmHost />);
    expect(container.querySelector(".request-modal")).toBeNull();
  });

  it("renders the workbuddy `ConfirmDialog` for a pending request", async () => {
    render(<GlobalConfirmHost />);
    let resolvePromise: ((value: boolean) => void) | undefined;
    const pendingPromise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    act(() => {
      void useGlobalConfirmStore.getState().show({ title: "确定卸载「demo」？" });
      // Re-bind to the actual pending resolver so we can drive the result below.
      const pending = useGlobalConfirmStore.getState().pending;
      if (pending && resolvePromise) pending.resolve = resolvePromise;
    });
    expect(screen.getByRole("alertdialog", { name: "确定卸载「demo」？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(useGlobalConfirmStore.getState().pending).toBeNull());
    await expect(pendingPromise).resolves.toBe(true);
  });

  it("closes and resolves false when the user picks 取消", async () => {
    render(<GlobalConfirmHost />);
    let resolvePromise: ((value: boolean) => void) | undefined;
    const pendingPromise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    act(() => {
      void useGlobalConfirmStore.getState().show({ title: "delete draft?" });
      const pending = useGlobalConfirmStore.getState().pending;
      if (pending && resolvePromise) pending.resolve = resolvePromise;
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(useGlobalConfirmStore.getState().pending).toBeNull());
    await expect(pendingPromise).resolves.toBe(false);
  });

  afterEach(() => {
    useGlobalConfirmStore.setState({ pending: null });
  });
});