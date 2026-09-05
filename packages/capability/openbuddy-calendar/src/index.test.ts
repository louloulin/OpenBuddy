import { mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Context } from "@openbuddy/cordis"
import { afterEach, describe, expect, it } from "vitest"
import { Calendar, mountCalendar } from "./index"

const tempDirs: string[] = []

afterEach(async () => {
	for (const directory of tempDirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("Calendar", () => {
	it("persists scoped events and returns overlapping time ranges", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "openbuddy-calendar-"))
		tempDirs.push(directory)
		process.env.PI_CODING_AGENT_DIR = directory
		const calendar = mountCalendar(new Context())
		const event = await calendar.create({ title: "规划", start: "2026-08-30T10:00:00+08:00", end: "2026-08-30T11:00:00+08:00", roomId: "project-demo", contextRefs: ["project:demo"] })
		await expect(stat(path.join(directory, "openbuddy.sqlite"))).resolves.toBeTruthy()
		expect((await calendar.list({ from: "2026-08-30T10:30:00+08:00", to: "2026-08-30T10:45:00+08:00", roomId: "project-demo" })).map((item) => item.id)).toEqual([event.id])
		expect(await calendar.list({ roomId: "personal-room" })).toEqual([])
		await calendar.update(event.id, { title: "已确认规划", status: "tentative" })
		expect((await calendar.list({ contextRef: "project:demo" }))[0]).toMatchObject({ title: "已确认规划", status: "tentative" })
		expect(await calendar.remove(event.id)).toBe(true)
		expect(await calendar.remove(event.id)).toBe(false)
	})

	it("rejects invalid ranges", async () => {
		const calendar = new Calendar(new Context())
		await expect(calendar.create({ title: "错误", start: "2026-08-30T11:00:00Z", end: "2026-08-30T10:00:00Z" })).rejects.toThrow("end must be after start")
	})

	it("rejects updates and removals from a different room", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "openbuddy-calendar-scope-"))
		tempDirs.push(directory)
		process.env.PI_CODING_AGENT_DIR = directory
		const calendar = mountCalendar(new Context())
		const event = await calendar.create({ title: "项目会议", start: "2026-08-30T10:00:00Z", end: "2026-08-30T11:00:00Z", roomId: "project-a" })
		expect(await calendar.updateInRoom(event.id, "project-a", { title: "已更新" })).toMatchObject({ title: "已更新", roomId: "project-a" })
		await expect(calendar.updateInRoom(event.id, "project-b", { title: "越权" })).rejects.toThrow("does not belong")
		await expect(calendar.removeInRoom(event.id, "project-b")).rejects.toThrow("does not belong")
		expect(await calendar.removeInRoom(event.id, "project-a")).toBe(true)
	})
})
