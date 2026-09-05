import { describe, expect, it } from "vitest"
import { resolvePermissionAction } from "./index"

describe("permission rule resolution", () => {
	it("matches wildcard tool and operation patterns", () => {
		expect(resolvePermissionAction([{ action: "allow", tool: "bash", pattern: "git *" }], "Bash", "git status")).toBe("allow")
		expect(resolvePermissionAction([{ action: "allow", tool: "bash", pattern: "git *" }], "Bash", "rm -rf /tmp")).toBeUndefined()
	})

	it("keeps deny ahead of ask and allow", () => {
		expect(resolvePermissionAction([
		{ action: "allow", tool: "bash" },
		{ action: "ask", tool: "bash" },
		{ action: "deny", tool: "bash" },
	], "bash")).toBe("deny")
	})
})
