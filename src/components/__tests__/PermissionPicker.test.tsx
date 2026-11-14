import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { permissionModeSet } from "@/lib/agent-client";
import { PermissionPicker } from "../PermissionPicker";
import { AppDialogHost } from "../AppDialog";

vi.mock("@/lib/ipc", () => ({ invoke: vi.fn(), save: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("@/lib/agent-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent-client")>()),
  permissionModeGet: vi.fn(async () => "ask"),
  permissionModeSet: vi.fn(async () => {}),
}));
beforeEach(() => vi.clearAllMocks());

it("asks twice, with a ticked risk box, before 完全访问", async () => {
  render(<><PermissionPicker /><AppDialogHost /></>);
  fireEvent.click(await screen.findByRole("button", { name: /审批模式/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
  const confirm = await screen.findByRole("button", { name: "切换到完全访问" });
  expect(confirm).toBeDisabled();
  expect(permissionModeSet).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/我了解风险/));
  fireEvent.click(confirm);
  await waitFor(() => expect(permissionModeSet).toHaveBeenCalledWith("always-approve"));
  expect(await screen.findByRole("button", { name: /完全访问/ })).toHaveClass("permission-picker__trigger--full");
});

it("switching to a safer mode needs no confirmation", async () => {
  render(<><PermissionPicker /><AppDialogHost /></>);
  fireEvent.click(await screen.findByRole("button", { name: /审批模式/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /自动模式/ }));
  await waitFor(() => expect(permissionModeSet).toHaveBeenCalledWith("auto"));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
