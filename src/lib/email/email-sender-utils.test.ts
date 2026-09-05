import { describe, expect, it } from "vitest"
import { senderInitials, senderHue, senderAvatar } from "./email-sender-utils"

const sender = (address: string, name?: string) => ({ address, name } as never)

describe("email-sender-utils pure helpers", () => {
  it("senderInitials derives initials from name", () => {
    expect(senderInitials(sender("alice@example.com", "Alice Smith"))).toBe("AS")
    expect(senderInitials(sender("bob@example.com", "Bob"))).toBe("BO")
    expect(senderInitials(sender("eve@example.com"))).toBe("E")
  })
  it("senderInitials falls back to address prefix when no name", () => {
    const initials = senderInitials(sender("carol@example.com"))
    expect(initials.length).toBeGreaterThan(0)
    expect(initials.length).toBeLessThanOrEqual(2)
  })
  it("senderHue returns a stable number for the same address", () => {
    expect(senderHue(sender("alice@example.com"))).toBe(senderHue(sender("alice@example.com")))
    expect(senderHue(sender("alice@example.com"))).not.toBe(senderHue(sender("bob@example.com")))
  })
  it("senderHue is in [0, 360)", () => {
    for (const addr of ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]) {
      const hue = senderHue(sender(addr))
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })
  it("senderAvatar returns initials + background", () => {
    const avatar = senderAvatar(sender("a@x.com", "Alice"))
    expect(avatar.initials).toBe("AL")
    expect(avatar.background).toMatch(/linear-gradient|hsl/)
  })
  it("senderAvatar supports muted palette", () => {
    const macro = senderAvatar(sender("a@x.com", "Alice"), "macro")
    const muted = senderAvatar(sender("a@x.com", "Alice"), "muted")
    expect(macro.background).not.toBe(muted.background)
  })
})
