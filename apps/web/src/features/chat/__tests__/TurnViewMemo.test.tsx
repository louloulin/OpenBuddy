import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ChatMessage } from "@/features/chat/state/session-store";

const renders = vi.fn();
vi.mock("../../../shared/agent-ui/ToolCallCard", () => ({ ToolCallCard: (props: { tc: { toolCallId: string } }) => { renders(props.tc.toolCallId); return <div>{props.tc.toolCallId}</div>; } }));
import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { useUiPrefs } from "@/app/state/ui-prefs-store";

const turn: ChatMessage = {
  id: "a1", role: "assistant", complete: true, meta: { timestamp: 1 },
  parts: [{ kind: "tool_call", contentIndex: 0, toolCall: { toolCallId: "t1", title: "bash", kind: "bash", status: "completed", content: [], rawInput: { command: "ls" } } }, { kind: "text", text: "完成", contentIndex: 1 }],
};
const onToast = () => {};

describe("TurnView memo (U0.4)", () => {
  it("does not re-render a finished turn when only the array holding its messages is new", () => {
    useUiPrefs.getState().setPrefs({ conciseMode: false });
    const view = render(<ThemeProvider><TurnView messages={[turn]} running={false} isLast={false} sessionId="s" onToast={onToast} /></ThemeProvider>);
    expect(renders).toHaveBeenCalledTimes(1);
    view.rerender(<ThemeProvider><TurnView messages={[turn]} running={false} isLast={false} sessionId="s" onToast={onToast} /></ThemeProvider>);
    expect(renders).toHaveBeenCalledTimes(1);
    view.rerender(<ThemeProvider><TurnView messages={[{ ...turn }]} running={false} isLast={false} sessionId="s" onToast={onToast} /></ThemeProvider>);
    expect(renders).toHaveBeenCalledTimes(2);
  });
});
