import { describe, expect, it } from "vitest"
import { Context, OpenBuddyService, brand, debug, forEach } from "./index"

describe("cordis service helpers (no mock)", () => {
  it("brand wraps strings without changing runtime identity", () => {
    const a = brand<"SessionId">("session-1")
    expect(a).toBe("session-1")
  })

  it("OpenBuddyService exposes a configurable name to its constructor", () => {
    const ctx = new Context()
    let received: string | undefined
    class Probe extends OpenBuddyService {
      static provide = "probe" as const
      constructor(c: Context) {
        super(c, "probe-override")
        received = "constructed"
      }
    }
    const instance = new Probe(ctx)
    expect(instance).toBeInstanceOf(Probe)
    expect(received).toBe("constructed")
  })

  it("debug falls back to console.debug when no logger is provided", () => {
    const ctx = new Context()
    const original = console.debug
    const captured: string[] = []
    console.debug = (...args: unknown[]) => { captured.push(args.map(String).join(" ")) }
    try {
      const log = debug(ctx, "tag")
      log("hello")
      expect(captured).toEqual(["[tag] hello"])
    } finally {
      console.debug = original
    }
  })

  it("debug routes through ctx.logger.debug when provided", () => {
    const ctx = new Context()
    const calls: Array<[string, string]> = []
    ;(ctx as unknown as { logger: { debug: (tag: string, msg: string) => void } }).logger = {
      debug: (tag, msg) => calls.push([tag, msg]),
    }
    const log = debug(ctx, "subsystem")
    log("pinged")
    expect(calls).toEqual([["subsystem", "pinged"]])
  })

  it("forEach runs handlers for matching keys and returns a working disposer", () => {
    const ctx = new Context()
    // Inject services into the context manually so forEach can discover them.
    const fakeA = { flag: "a" }
    const fakeB = { flag: "b" }
    ;(ctx as unknown as Record<string, unknown>)["alpha"] = fakeA
    ;(ctx as unknown as Record<string, unknown>)["beta"] = fakeB
    const seen: string[] = []
    const dispose = forEach<{ flag: string }>(ctx, (k) => k === "alpha" || k === "beta", (svc) => {
      seen.push(svc.flag)
    })
    expect(seen.sort()).toEqual(["a", "b"])
    // disposer should be idempotent and not throw even if there are no nested disposers.
    expect(() => dispose()).not.toThrow()
  })
})
