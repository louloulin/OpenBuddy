/**
 * @openbuddy/fs-fs-local — local filesystem + shell helpers.
 *
 * Ports `extensions/openbuddy/shell-fs/index.ts` (which itself mirrored
 * former desktop shell filesystem. This is the **Provider** side of the
 * filesystem capability seam: the consumer side is @openbuddy/fs-fs (the
 * Service Definition). Capability seam pattern after DeepSeek Harness.
 *
 * Replicated: open_url, open_path, reveal_in_folder, path_stat,
 *   read_text_file, write_text_file, export_text_file,
 *   list_dir, browse_directory
 */
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import { platform } from "node:os"
import path from "node:path"
import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService } from "@openbuddy/cordis"

export interface DirEntry {
	name: string
	path: string
	kind: "directory" | "file" | "other"
	size: number
}

export interface PathStat {
	path: string
	exists: boolean
	kind: "file" | "directory" | "other" | "missing"
	absolute: string
}

const IGNORED_DIRS = new Set([
	"node_modules", ".git", ".svn", ".hg", "target", "dist", "build",
	".next", ".nuxt", ".cache", ".turbo", "__pycache__", ".venv", "venv",
	".idea", ".vscode",
])

function resolvePath(input: string, cwd?: string | null): string {
	if (path.isAbsolute(input)) return input
	return cwd && cwd.length > 0 ? path.join(cwd, input) : input
}

function piRoot(): string {
	return process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? path.join(process.env.HOME ?? process.cwd(), ".pi"), "agent")
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate))
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function ensureReadablePath(input: string, cwd?: string | null): Promise<string> {
	if (typeof input !== "string" || !input.trim()) throw new Error("路径不能为空")
	if (cwd && cwd.trim() && path.parse(cwd).root === path.resolve(cwd)) {
		throw new Error(`拒绝把文件系统根目录作为工作区:${cwd}`)
	}
	const resolved = path.resolve(resolvePath(input, cwd))
	const roots = await Promise.all([cwd && cwd.trim() ? cwd : process.cwd(), piRoot()].map(async (root) =>
		fs.realpath(path.resolve(root)).catch(() => path.resolve(root))))
	const candidate = await fs.realpath(resolved).catch(async () => {
		const parent = await fs.realpath(path.dirname(resolved)).catch(() => path.resolve(path.dirname(resolved)))
		return path.join(parent, path.basename(resolved))
	})
	if (!roots.some((root) => isWithin(root, candidate))) {
		throw new Error(`拒绝访问工作区之外的路径:${resolved}`)
	}
	return candidate
}

async function ensureUnderWorkspace(root: string, candidate: string): Promise<string> {
	const rootCanon = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root))
	const candidateCanon = path.resolve(candidate)
	if (!(await fs.stat(candidateCanon, { throwIfNoEntry: false }))) {
		const parent = path.dirname(candidateCanon)
		if (parent && !(await fs.stat(parent, { throwIfNoEntry: false }))) {
			await fs.mkdir(parent, { recursive: true })
		}
	}
	const realCandidate = await fs.realpath(candidateCanon).catch(async () => {
		const parent = path.dirname(candidateCanon)
		await fs.mkdir(parent, { recursive: true })
		return path.join(await fs.realpath(parent), path.basename(candidateCanon))
	})
	const boundary = path.relative(rootCanon, realCandidate)
	if (boundary !== "" && (boundary === ".." || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary))) {
		throw new Error(`拒绝写入工作区之外的路径:${realCandidate}`)
	}
	return realCandidate
}

async function atomicWrite(file: string, content: string): Promise<void> {
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
	try {
		await fs.writeFile(temporary, content, "utf-8")
		await fs.rename(temporary, file)
	} catch (error) {
		await fs.rm(temporary, { force: true }).catch(() => undefined)
		throw error
	}
}

async function openWithOS(target: string): Promise<void> {
	const os = platform()
	if (os === "win32") {
		await new Promise<void>((resolve, reject) => {
			spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" })
				.on("error", reject)
				.on("exit", () => resolve())
		})
		return
	}
	if (os === "darwin") {
		await new Promise<void>((resolve, reject) => {
			spawn("open", [target], { detached: true, stdio: "ignore" })
				.on("error", reject)
				.on("exit", () => resolve())
		})
		return
	}
	await new Promise<void>((resolve, reject) => {
		spawn("xdg-open", [target], { detached: true, stdio: "ignore" })
			.on("error", reject)
			.on("exit", () => resolve())
	})
}

async function revealInFolder(resolved: string): Promise<void> {
	const os = platform()
	if (os === "win32") {
		await new Promise<void>((resolve, reject) => {
			spawn("explorer", [`/select,${resolved}`], { detached: true, stdio: "ignore" })
				.on("error", reject)
				.on("exit", () => resolve())
		})
		return
	}
	if (os === "darwin") {
		await new Promise<void>((resolve, reject) => {
			spawn("open", ["-R", resolved], { detached: true, stdio: "ignore" })
				.on("error", reject)
				.on("exit", () => resolve())
		})
		return
	}
	const target = (await fs.stat(resolved, { throwIfNoEntry: false }))?.isDirectory()
		? resolved
		: path.dirname(resolved)
	await openWithOS(target)
}

export class FsLocal extends OpenBuddyService {
	static provide = "fsLocal" as const

	constructor(ctx: Context) {
		super(ctx, "fsLocal")
		ctx.effect(() => () => this.ctx.emit("fs-local/cleanup", {}))
	}

	async openUrl(url: string): Promise<void> {
		const trimmed = url.trim()
		if (!trimmed) throw new Error("URL 为空")
		const lower = trimmed.toLowerCase()
		if (!(lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:"))) {
			throw new Error(`不支持的 URL 协议:${url}`)
		}
		await openWithOS(trimmed)
	}

	async openPath(p: string, cwd?: string | null): Promise<void> {
		const resolved = await ensureReadablePath(p, cwd)
		if (!(await fs.stat(resolved, { throwIfNoEntry: false }))) throw new Error(`路径不存在:${resolved}`)
		await openWithOS(resolved)
	}

	async reveal(p: string, cwd?: string | null): Promise<void> {
		const resolved = await ensureReadablePath(p, cwd)
		if (!(await fs.stat(resolved, { throwIfNoEntry: false }))) throw new Error(`路径不存在:${resolved}`)
		await revealInFolder(resolved)
	}

	async stat(p: string, cwd?: string | null): Promise<PathStat> {
		const resolved = await ensureReadablePath(p, cwd)
		const absolute = path.resolve(resolved)
		if (!(await fs.stat(absolute, { throwIfNoEntry: false }))) {
			return { path: p, exists: false, kind: "missing", absolute }
		}
		const s = await fs.stat(absolute)
		const kind: PathStat["kind"] = s.isDirectory()
			? "directory"
			: s.isFile()
				? "file"
				: "other"
		return { path: p, exists: true, kind, absolute }
	}

	async readTextFile(
		p: string,
		cwd?: string | null,
		maxBytes = 256 * 1024,
	): Promise<string> {
		const resolved = await ensureReadablePath(p, cwd)
		if (!(await fs.stat(resolved, { throwIfNoEntry: false }))) throw new Error(`文件不存在:${resolved}`)
		const s = await fs.stat(resolved)
		if (!s.isFile()) throw new Error(`不是文件:${resolved}`)
		const data = await fs.readFile(resolved)
		const truncated = data.length > maxBytes
		const slice = truncated ? data.subarray(0, maxBytes) : data
		let text = slice.toString("utf-8")
		if (truncated) text += "\n\n…(已截断，仅预览前部分内容)"
		return text
	}

	async readFileBase64(p: string, cwd?: string | null, maxBytes = 20 * 1024 * 1024): Promise<string> {
		const resolved = await ensureReadablePath(p, cwd)
		if (!(await fs.stat(resolved, { throwIfNoEntry: false }))) throw new Error(`文件不存在:${resolved}`)
		const s = await fs.stat(resolved)
		if (!s.isFile()) throw new Error(`不是文件:${resolved}`)
		const limit = Math.max(1, Math.min(maxBytes, 50 * 1024 * 1024))
		const data = await fs.readFile(resolved)
		if (data.byteLength > limit) throw new Error(`file exceeds maxBytes (${limit})`)
		return data.toString("base64")
	}

	async writeTextFile(p: string, content: string, workspaceRoot: string): Promise<string> {
		if (!workspaceRoot.trim()) throw new Error("未设置工作区，无法安全写入")
		if (!path.isAbsolute(workspaceRoot)) throw new Error("工作区路径必须是绝对路径")
		const resolved = resolvePath(p, workspaceRoot)
		const safe = await ensureUnderWorkspace(workspaceRoot, resolved)
		const parent = path.dirname(safe)
		if (parent && !(await fs.stat(parent, { throwIfNoEntry: false }))) await fs.mkdir(parent, { recursive: true })
		await atomicWrite(safe, content)
		this.ctx.emit("fs-local/written", { path: safe, bytes: content.length })
		return safe
	}

	async exportTextFile(p: string, content: string): Promise<string> {
		if (!path.isAbsolute(p)) throw new Error("导出路径必须是绝对路径")
		const parent = path.dirname(p)
		if (parent && !(await fs.stat(parent, { throwIfNoEntry: false }))) await fs.mkdir(parent, { recursive: true })
		await atomicWrite(p, content)
		this.ctx.emit("fs-local/exported", { path: p })
		return p
	}

	async listDir(p: string, cwd?: string | null, maxEntries = 2000): Promise<DirEntry[]> {
		const resolved = await ensureReadablePath(p, cwd)
		if (!(await fs.stat(resolved, { throwIfNoEntry: false }))) throw new Error(`目录不存在:${resolved}`)
		const s = await fs.stat(resolved)
		if (!s.isDirectory()) throw new Error(`不是目录:${resolved}`)
		const items = await fs.readdir(resolved, { withFileTypes: true })
		const out: DirEntry[] = []
		for (const item of items) {
			const name = item.name
			if (name.startsWith(".")) continue
			if (item.isDirectory() && IGNORED_DIRS.has(name)) continue
			const kind: DirEntry["kind"] = item.isDirectory()
				? "directory"
				: item.isFile()
					? "file"
					: "other"
			const size = item.isDirectory() ? 0 : (await fs.stat(path.join(resolved, name))).size
			out.push({ name, path: path.join(resolved, name), kind, size })
			if (out.length >= maxEntries) break
		}
		out.sort((a, b) => {
			const ad = a.kind === "directory" ? 1 : 0
			const bd = b.kind === "directory" ? 1 : 0
			return bd - ad || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
		})
		return out
	}

	async makeDirectory(p: string, workspaceRoot: string): Promise<string> {
		if (!workspaceRoot.trim() || !path.isAbsolute(workspaceRoot)) throw new Error("工作区路径必须是绝对路径")
		const safe = await ensureUnderWorkspace(workspaceRoot, resolvePath(p, workspaceRoot))
		await fs.mkdir(safe, { recursive: true })
		return safe
	}

	async browseDirectory(p: string, cwd?: string | null): Promise<void> {
		const resolved = await ensureReadablePath(p, cwd)
		if (!(await fs.stat(resolved, { throwIfNoEntry: false }))) throw new Error(`路径不存在:${resolved}`)
		const s = await fs.stat(resolved)
		const target = s.isDirectory() ? resolved : path.dirname(resolved)
		await openWithOS(target)
	}
}

declare module "@openbuddy/cordis" {
	interface Context {
		fsLocal: FsLocal
	}
	interface Events {
		"fs-local/written"(payload: { path: string; bytes: number }): void
		"fs-local/exported"(payload: { path: string }): void
		"fs-local/cleanup"(payload: Record<string, never>): void
	}
}

let _serviceRef: FsLocal | null = null

export function mountFsLocal(ctx: Context): FsLocal {
	const svc = new FsLocal(ctx)
	_serviceRef = svc
	return svc
}

export const shellFsHandlers = {
	openUrl: (url: string) => _serviceRef!.openUrl(url),
	openPath: (p: string, cwd?: string | null) => _serviceRef!.openPath(p, cwd),
	reveal: (p: string, cwd?: string | null) => _serviceRef!.reveal(p, cwd),
	stat: (p: string, cwd?: string | null) => _serviceRef!.stat(p, cwd),
	readTextFile: (p: string, cwd?: string | null, maxBytes?: number) =>
		_serviceRef!.readTextFile(p, cwd, maxBytes),
	readFileBase64: (p: string, cwd?: string | null, maxBytes?: number) =>
		_serviceRef!.readFileBase64(p, cwd, maxBytes),
	writeTextFile: (p: string, content: string, workspaceRoot: string) =>
		_serviceRef!.writeTextFile(p, content, workspaceRoot),
	exportTextFile: (p: string, content: string) => _serviceRef!.exportTextFile(p, content),
	listDir: (p: string, cwd?: string | null, maxEntries?: number) =>
		_serviceRef!.listDir(p, cwd, maxEntries),
	makeDirectory: (p: string, workspaceRoot: string) => _serviceRef!.makeDirectory(p, workspaceRoot),
	browseDirectory: (p: string, cwd?: string | null) => _serviceRef!.browseDirectory(p, cwd),
}
