import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService } from "@openbuddy/cordis"
import { CalendarCatalog } from "@openbuddy/storage"

export type CalendarEventId = string
export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled"

export interface CalendarEvent {
	id: CalendarEventId
	title: string
	start: string
	end: string
	timeZone?: string
	allDay: boolean
	status: CalendarEventStatus
	roomId: string
	contextRefs: string[]
	description?: string
	location?: string
	attendees: string[]
	createdAt: string
	updatedAt: string
}

export interface CalendarEventInput {
	title: string
	start: string
	end: string
	timeZone?: string
	allDay?: boolean
	status?: CalendarEventStatus
	roomId?: string
	contextRefs?: string[]
	description?: string
	location?: string
	attendees?: string[]
}

export interface CalendarEventPatch {
	title?: string
	start?: string
	end?: string
	timeZone?: string
	allDay?: boolean
	status?: CalendarEventStatus
	contextRefs?: string[]
	description?: string
	location?: string
	attendees?: string[]
}

export interface CalendarListInput {
	from?: string
	to?: string
	roomId?: string
	contextRef?: string
}

function homeDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent")
}

function storePath(): string {
	return path.join(homeDir(), "openbuddy-calendar.json")
}

function databasePath(): string {
	return path.join(homeDir(), "openbuddy.sqlite")
}

function nowIso(): string { return new Date().toISOString() }

function validDate(value: string, field: string): string {
	const date = new Date(value)
	if (!value.trim() || Number.isNaN(date.getTime())) throw new Error(`calendar ${field} must be an ISO date`)
	return date.toISOString()
}

function normalizeRoomId(roomId?: string): string {
	const value = roomId?.trim() || "personal-room"
	if (!value || value.includes(" ")) throw new Error("calendar roomId is invalid")
	return value
}

function normalizeInput(input: CalendarEventInput): Omit<CalendarEvent, "id" | "createdAt" | "updatedAt"> {
	if (!input.title?.trim()) throw new Error("calendar title is required")
	const start = validDate(input.start, "start")
	const end = validDate(input.end, "end")
	if (new Date(end).getTime() <= new Date(start).getTime()) throw new Error("calendar end must be after start")
	return {
		title: input.title.trim(), start, end, ...(input.timeZone ? { timeZone: input.timeZone } : {}),
		allDay: input.allDay ?? false, status: input.status ?? "confirmed", roomId: normalizeRoomId(input.roomId),
		contextRefs: [...new Set(input.contextRefs ?? [])].filter((ref) => ref.trim().length > 0),
		...(input.description?.trim() ? { description: input.description.trim() } : {}),
		...(input.location?.trim() ? { location: input.location.trim() } : {}),
		attendees: [...new Set(input.attendees ?? [])].filter((attendee) => attendee.trim().length > 0),
	}
}

export class Calendar extends OpenBuddyService {
	static provide = "calendar" as const
	static inject = [] as const
	private readonly catalog: CalendarCatalog

	constructor(ctx: Context) {
		super(ctx, "calendar")
		this.catalog = new CalendarCatalog({ databasePath: databasePath(), legacyPath: storePath(), mirrorPath: storePath() })
		ctx.effect(() => () => { void this.catalog.close(); if (serviceRef === this) serviceRef = null; this.ctx.emit("calendar/cleanup", {}) })
	}

	async list(input: CalendarListInput = {}): Promise<CalendarEvent[]> {
		const from = input.from ? new Date(validDate(input.from, "from")).getTime() : Number.NEGATIVE_INFINITY
		const to = input.to ? new Date(validDate(input.to, "to")).getTime() : Number.POSITIVE_INFINITY
		if (to < from) throw new Error("calendar to must be after from")
		const events = await this.catalog.list({
			...(input.from ? { from: new Date(from).toISOString() } : {}),
			...(input.to ? { to: new Date(to).toISOString() } : {}),
			...(input.roomId ? { roomId: input.roomId } : {}),
			...(input.contextRef ? { contextRef: input.contextRef } : {}),
		})
		this.ctx.emit("calendar/listed", { count: events.length, roomId: input.roomId })
		return events
	}

	async create(input: CalendarEventInput): Promise<CalendarEvent> {
		const timestamp = nowIso()
		const event: CalendarEvent = { id: `cal-${randomUUID()}`, ...normalizeInput(input), createdAt: timestamp, updatedAt: timestamp }
		await this.catalog.upsert(event)
		this.ctx.emit("calendar/created", { event })
		return event
	}

	async update(id: string, patch: CalendarEventPatch): Promise<CalendarEvent | null> {
		return this.updateWithRoom(id, undefined, patch)
	}

	async updateInRoom(id: string, roomId: string, patch: CalendarEventPatch): Promise<CalendarEvent | null> {
		return this.updateWithRoom(id, roomId, patch)
	}

	private async updateWithRoom(id: string, expectedRoomId: string | undefined, patch: CalendarEventPatch): Promise<CalendarEvent | null> {
		const event = await this.catalog.get(id)
		if (!event) return null
		if (expectedRoomId !== undefined && event.roomId !== expectedRoomId) throw new Error("calendar event does not belong to the requested room")
		const next = normalizeInput({ ...event, ...patch, roomId: event.roomId, contextRefs: patch.contextRefs ?? event.contextRefs, attendees: patch.attendees ?? event.attendees })
		Object.assign(event, next, { id: event.id, createdAt: event.createdAt, updatedAt: nowIso() })
		await this.catalog.upsert(event)
		this.ctx.emit("calendar/updated", { event })
		return event
	}

	async remove(id: string): Promise<boolean> {
		return this.removeWithRoom(id, undefined)
	}

	async removeInRoom(id: string, expectedRoomId: string): Promise<boolean> {
		return this.removeWithRoom(id, expectedRoomId)
	}

	private async removeWithRoom(id: string, expectedRoomId: string | undefined): Promise<boolean> {
		const removed = await this.catalog.remove(id, expectedRoomId)
		if (!removed) return false
		this.ctx.emit("calendar/removed", { id })
		return true
	}
}

declare module "@openbuddy/cordis" {
	interface Context { calendar: Calendar }
	interface Events {
		"calendar/listed"(payload: { count: number; roomId?: string }): void
		"calendar/created"(payload: { event: CalendarEvent }): void
		"calendar/updated"(payload: { event: CalendarEvent }): void
		"calendar/removed"(payload: { id: string }): void
		"calendar/cleanup"(payload: Record<string, never>): void
	}
}

let serviceRef: Calendar | null = null

export function mountCalendar(ctx: Context): Calendar {
	const service = new Calendar(ctx)
	serviceRef = service
	return service
}

export const calendarHandlers = {
	list: (input?: CalendarListInput) => serviceRef?.list(input),
	create: (input: CalendarEventInput) => serviceRef?.create(input),
	update: (id: string, patch: CalendarEventPatch) => serviceRef?.update(id, patch),
	updateInRoom: (id: string, roomId: string, patch: CalendarEventPatch) => serviceRef?.updateInRoom(id, roomId, patch),
	remove: (id: string) => serviceRef?.remove(id),
	removeInRoom: (id: string, roomId: string) => serviceRef?.removeInRoom(id, roomId),
}
