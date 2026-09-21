import { describe, expect, it, beforeEach } from "vitest";
import { useComposerStore } from "./composer-store";

describe("composer-store", () => {
  beforeEach(() => {
    useComposerStore.setState({ open: false, initial: null });
  });

  it("starts closed with null initial", () => {
    const state = useComposerStore.getState();
    expect(state.open).toBe(false);
    expect(state.initial).toBeNull();
  });

  it("openComposer({subject}) sets open=true and forwards the field", () => {
    useComposerStore.getState().openComposer({ subject: "回复客户报价", threadId: "t-1" });
    const state = useComposerStore.getState();
    expect(state.open).toBe(true);
    expect(state.initial?.subject).toBe("回复客户报价");
    expect(state.initial?.threadId).toBe("t-1");
    expect(state.initial?.body).toBeUndefined();
  });

  it("openComposer with no args opens with null initial (still usable)", () => {
    useComposerStore.getState().openComposer();
    const state = useComposerStore.getState();
    expect(state.open).toBe(true);
    expect(state.initial).toBeNull();
  });

  it("closeComposer resets back to closed state", () => {
    useComposerStore.getState().openComposer({ subject: "X" });
    expect(useComposerStore.getState().open).toBe(true);
    useComposerStore.getState().closeComposer();
    const state = useComposerStore.getState();
    expect(state.open).toBe(false);
    expect(state.initial).toBeNull();
  });

  it("multiple openComposer calls keep only the latest initial", () => {
    useComposerStore.getState().openComposer({ subject: "old" });
    useComposerStore.getState().openComposer({ subject: "new", body: "hi" });
    expect(useComposerStore.getState().initial?.subject).toBe("new");
    expect(useComposerStore.getState().initial?.body).toBe("hi");
  });

  it("forwards full set of fields (subject/body/threadId/to/cc/bcc/draftId)", () => {
    useComposerStore.getState().openComposer({
      subject: "S",
      body: "B",
      threadId: "T",
      to: "alice@example.com",
      cc: "bob@example.com",
      bcc: "eve@example.com",
      draftId: "draft-99",
    });
    const initial = useComposerStore.getState().initial;
    expect(initial?.subject).toBe("S");
    expect(initial?.body).toBe("B");
    expect(initial?.threadId).toBe("T");
    expect(initial?.to).toBe("alice@example.com");
    expect(initial?.cc).toBe("bob@example.com");
    expect(initial?.bcc).toBe("eve@example.com");
    expect(initial?.draftId).toBe("draft-99");
  });
});
