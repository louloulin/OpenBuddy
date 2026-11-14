import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElectronTransport, MemoryTransport, type Transport } from "../transport";

// ElectronTransport must reach the preload bridge only through ipc.ts.
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("../ipc", () => ipc);

/** What a contract case needs from a transport under test: the transport plus a way to play the host. */
interface Harness {
  transport: Transport;
  reply(command: string, handler: (payload: unknown) => unknown): void;
  emit(event: string, payload: unknown): void;
}

/** The behaviour every Transport (Electron, Memory, and later WebSocket) must share. */
function transportContract(name: string, make: () => Harness) {
  describe(`${name} — Transport contract`, () => {
    it("invokes a command with its payload and resolves with the host's reply", async () => {
      const { transport, reply } = make();
      const seen: unknown[] = [];
      reply("agent_list_sessions", payload => { seen.push(payload); return [{ id: "s1" }]; });
      await expect(transport.invoke("agent_list_sessions", { cwd: "/w" })).resolves.toEqual([{ id: "s1" }]);
      expect(seen).toEqual([{ cwd: "/w" }]);
    });

    it("rejects when the host fails the command", async () => {
      const { transport, reply } = make();
      reply("agent_send", () => { throw new Error("session_not_loaded: s1"); });
      await expect(transport.invoke("agent_send", { sessionId: "s1", text: "hi" })).rejects.toThrow("session_not_loaded");
    });

    it("delivers event payloads to a listener until it unsubscribes", async () => {
      const { transport, emit } = make();
      const got: unknown[] = [];
      const unlisten = await transport.listen("agent://session-status", payload => got.push(payload));
      emit("agent://session-status", { sessionId: "s1", status: "running" });
      emit("agent://other", { ignored: true });
      unlisten();
      emit("agent://session-status", { sessionId: "s1", status: "idle" });
      expect(got).toEqual([{ sessionId: "s1", status: "running" }]);
    });

    it("unsubscribing one listener leaves the others on the same event", async () => {
      const { transport, emit } = make();
      const a = vi.fn(), b = vi.fn();
      const stopA = await transport.listen("agent://artifacts", a);
      await transport.listen("agent://artifacts", b);
      stopA();
      emit("agent://artifacts", { sessionId: "s1" });
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledWith({ sessionId: "s1" });
    });

    it("starts open", () => {
      const { transport } = make();
      expect(transport.state()).toBe("open");
      expect(typeof transport.onState(() => {})).toBe("function");
    });
  });
}

transportContract("MemoryTransport", () => {
  const transport = new MemoryTransport();
  return { transport, reply: (command, handler) => { transport.handle(command, handler); }, emit: (event, payload) => { transport.emit(event, payload); } };
});

transportContract("ElectronTransport", () => {
  // A fake ipc.ts: invoke dispatches to registered handlers, listen keeps `{ payload }` envelope callbacks.
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
  ipc.invoke.mockImplementation(async (command: string, payload?: unknown) => handlers.get(command)!(payload));
  ipc.listen.mockImplementation(async (event: string, callback: (event: { payload: unknown }) => void) => {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    set.add(callback);
    return () => { set.delete(callback); };
  });
  return {
    transport: new ElectronTransport(),
    reply: (command, handler) => { handlers.set(command, handler); },
    emit: (event, payload) => { for (const callback of listeners.get(event) ?? []) callback({ payload }); },
  };
});

describe("ElectronTransport delegates to ipc.ts", () => {
  beforeEach(() => { ipc.invoke.mockReset(); ipc.listen.mockReset(); });

  it("passes command and payload straight to ipc.invoke and returns its promise's value", async () => {
    ipc.invoke.mockResolvedValue({ ok: true });
    await expect(new ElectronTransport().invoke("agent_init", { cwd: null })).resolves.toEqual({ ok: true });
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).toHaveBeenCalledWith("agent_init", { cwd: null });
  });

  it("surfaces ipc.invoke rejections unchanged (e.g. its not_implemented mapping)", async () => {
    const error = new Error("此功能在 Electron MVP 中暂不可用：session_search");
    ipc.invoke.mockRejectedValue(error);
    await expect(new ElectronTransport().invoke("session_search")).rejects.toBe(error);
  });

  it("subscribes through ipc.listen, unwraps the { payload } envelope and returns ipc's unlisten", async () => {
    const unlisten = vi.fn();
    ipc.listen.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const result = await new ElectronTransport().listen("agent://event", handler);
    expect(ipc.listen).toHaveBeenCalledWith("agent://event", expect.any(Function));
    const callback = ipc.listen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    callback({ payload: { sessionId: "s1" } });
    expect(handler).toHaveBeenCalledWith({ sessionId: "s1" });
    expect(result).toBe(unlisten);
  });
});

describe("MemoryTransport", () => {
  it("records every call and rejects commands without a handler", async () => {
    const transport = new MemoryTransport({ agent_init: () => ({ ok: true }) });
    await transport.invoke("agent_init", { cwd: null });
    await expect(transport.invoke("host_capabilities")).rejects.toThrow("no handler for host_capabilities");
    expect(transport.calls).toEqual([{ command: "agent_init", payload: { cwd: null } }, { command: "host_capabilities", payload: undefined }]);
  });

  it("awaits async handlers, and handle() returns a remover", async () => {
    const transport = new MemoryTransport();
    const remove = transport.handle("agent_get_queue", async () => ({ steering: [], followUp: ["next"] }));
    await expect(transport.invoke("agent_get_queue", { sessionId: "s1" })).resolves.toEqual({ steering: [], followUp: ["next"] });
    remove();
    await expect(transport.invoke("agent_get_queue", { sessionId: "s1" })).rejects.toThrow("no handler");
  });

  it("emit reports how many listeners got the event", async () => {
    const transport = new MemoryTransport();
    expect(transport.emit("agent://event", {})).toBe(0);
    const stop = await transport.listen("agent://event", () => {});
    await transport.listen("agent://event", () => {});
    expect(transport.listenerCount("agent://event")).toBe(2);
    stop();
    expect(transport.emit("agent://event", {})).toBe(1);
  });

  it("setState notifies onState listeners and invokes reject while not open", async () => {
    const transport = new MemoryTransport({ agent_list_workspaces: () => [] });
    const states: string[] = [];
    const stop = transport.onState(state => states.push(state));
    transport.setState("closed");
    await expect(transport.invoke("agent_list_workspaces")).rejects.toThrow("MemoryTransport is closed");
    transport.setState("closed");
    transport.setState("open");
    await expect(transport.invoke("agent_list_workspaces")).resolves.toEqual([]);
    stop();
    transport.setState("connecting");
    expect(states).toEqual(["closed", "open"]);
    expect(transport.state()).toBe("connecting");
  });
});
