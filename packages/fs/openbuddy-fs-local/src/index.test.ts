import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@openbuddy/cordis"
import { mountFsLocal } from "./index"

describe.sequential("local filesystem boundaries", () => {
	let root: string
	let outside: string
	let previousPiDir: string | undefined

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "openbuddy-fs-root-"))
		outside = await mkdtemp(join(tmpdir(), "openbuddy-fs-outside-"))
		previousPiDir = process.env.PI_CODING_AGENT_DIR
		process.env.PI_CODING_AGENT_DIR = join(root, ".pi", "agent")
		await mkdir(join(root, "nested"), { recursive: true })
		await writeFile(join(root, "nested", "note.txt"), "hello", "utf8")
		await writeFile(join(outside, "secret.txt"), "secret", "utf8")
	})

	afterEach(async () => {
		if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR
		else process.env.PI_CODING_AGENT_DIR = previousPiDir
		await rm(root, { recursive: true, force: true })
		await rm(outside, { recursive: true, force: true })
	})

	it("allows workspace reads and rejects sibling-prefix traversal", async () => {
		const service = mountFsLocal(new Context())
		expect(await service.readTextFile("nested/note.txt", root)).toBe("hello")
		expect(await service.listDir(root, root)).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: "nested", kind: "directory" }),
		]))
		await expect(service.readTextFile(join(root, "..", outside.split("/").pop()!, "secret.txt"), root)).rejects.toThrow("拒绝访问")
		await expect(service.stat(`${root}2`)).rejects.toThrow("拒绝访问")
	})

	it("rejects symlinks that resolve outside an allowed root", async () => {
		await symlink(outside, join(root, "escape"), "dir")
		const service = mountFsLocal(new Context())
		await expect(service.readTextFile("escape/secret.txt", root)).rejects.toThrow("拒绝访问")
		await expect(service.listDir("escape", root)).rejects.toThrow("拒绝访问")
	})

	it("uses the same boundary for base64 reads", async () => {
		const service = mountFsLocal(new Context())
		await expect(service.readFileBase64("nested/note.txt", root)).resolves.toBe(Buffer.from("hello").toString("base64"))
		await expect(service.readFileBase64(join(outside, "secret.txt"), root)).rejects.toThrow("拒绝访问")
	})

	it("rejects the filesystem root as an arbitrary read workspace", async () => {
		const service = mountFsLocal(new Context())
		const filesystemRoot = process.platform === "win32" ? "C:\\" : "/"
		await expect(service.readTextFile("../../etc/passwd", filesystemRoot)).rejects.toThrow("文件系统根目录")
	})
})
