import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatRail } from "../ChatRail";

// Stub out the zustand store so ChatRail doesn't depend on a full app
// state tree. Tests can mutate the returned value via the setter.
const sessionsState = { currentSessionId: "test-session" as string | null };
vi.mock("@/stores/sessions-store", () => ({
  useSessionsStore: Object.assign(
    (sel: (s: typeof sessionsState) => unknown) => sel(sessionsState),
    { getState: () => sessionsState, setState: (p: Partial<typeof sessionsState>) => Object.assign(sessionsState, p) },
  ),
}));

// Stub the electron dialog bridge so pickFiles doesn't try to call IPC.
vi.mock("@/lib/platform/electron-api", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

const MENU_ITEM_SELECTOR = '[role="menuitem"]';

function openMenuAndGetItems(): NodeListOf<Element> {
  fireEvent.click(screen.getByTestId("chat-rail-trigger"));
  return screen.getByTestId("chat-rail-menu").querySelectorAll(MENU_ITEM_SELECTOR);
}

describe("ChatRail — dropdown panel (R6.8)", () => {
  it("renders a single trigger button when a session is active", () => {
    sessionsState.currentSessionId = "test-session";
    render(<ChatRail onToast={vi.fn()} />);
    expect(screen.getByTestId("chat-rail-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-rail-menu")).toBeNull();
  });

  it("does not render when there is no current session", () => {
    sessionsState.currentSessionId = null;
    const { container } = render(<ChatRail onToast={vi.fn()} />);
    expect(container.querySelector(".chat-rail")).toBeNull();
  });

  it("does not render when visible=false", () => {
    sessionsState.currentSessionId = "test-session";
    const { container } = render(<ChatRail visible={false} onToast={vi.fn()} />);
    expect(container.querySelector(".chat-rail")).toBeNull();
  });

  it("opens the menu and reveals all four actions when the trigger is clicked", () => {
    sessionsState.currentSessionId = "test-session";
    render(<ChatRail onToast={vi.fn()} />);
    fireEvent.click(screen.getByTestId("chat-rail-trigger"));
    const menu = screen.getByTestId("chat-rail-menu");
    expect(menu).toBeInTheDocument();
    expect(menu.querySelectorAll(MENU_ITEM_SELECTOR)).toHaveLength(4);
  });

  it("toggles aria-expanded on the trigger as the menu opens and closes", () => {
    sessionsState.currentSessionId = "test-session";
    render(<ChatRail onToast={vi.fn()} />);
    const trigger = screen.getByTestId("chat-rail-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  // closeAnd() unmounts the menu after each item click, so each callback
  // gets a fresh render + menu open to assert independently.
  it("invokes onSelectMode('working') and closes when the 模式 item is clicked", () => {
    sessionsState.currentSessionId = "test-session";
    const onSelectMode = vi.fn();
    render(<ChatRail onSelectMode={onSelectMode} />);
    const items = openMenuAndGetItems();
    fireEvent.click(items[1] as HTMLButtonElement);
    expect(onSelectMode).toHaveBeenCalledWith("working");
    expect(screen.queryByTestId("chat-rail-menu")).toBeNull();
  });

  it("invokes onSelectExpert when the 技能与指令 item is clicked", () => {
    sessionsState.currentSessionId = "test-session";
    const onSelectExpert = vi.fn();
    render(<ChatRail onSelectExpert={onSelectExpert} />);
    const items = openMenuAndGetItems();
    fireEvent.click(items[2] as HTMLButtonElement);
    expect(onSelectExpert).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("chat-rail-menu")).toBeNull();
  });

  it("invokes onNavigateConnectors when the 连接器 item is clicked", () => {
    sessionsState.currentSessionId = "test-session";
    const onNavigateConnectors = vi.fn();
    render(<ChatRail onNavigateConnectors={onNavigateConnectors} />);
    const items = openMenuAndGetItems();
    fireEvent.click(items[3] as HTMLButtonElement);
    expect(onNavigateConnectors).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("chat-rail-menu")).toBeNull();
  });

  it("closes the menu when Escape is pressed", () => {
    sessionsState.currentSessionId = "test-session";
    render(<ChatRail onToast={vi.fn()} />);
    fireEvent.click(screen.getByTestId("chat-rail-trigger"));
    expect(screen.getByTestId("chat-rail-menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("chat-rail-menu")).toBeNull();
  });

  it("closes the menu when an outside click lands on a non-rail element", () => {
    sessionsState.currentSessionId = "test-session";
    render(
      <div>
        <ChatRail onToast={vi.fn()} />
        <div data-testid="outside">elsewhere</div>
      </div>,
    );
    fireEvent.click(screen.getByTestId("chat-rail-trigger"));
    expect(screen.getByTestId("chat-rail-menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("chat-rail-menu")).toBeNull();
  });
});
