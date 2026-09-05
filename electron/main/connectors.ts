import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, relative, resolve, isAbsolute } from "node:path";
import type { ConnectorCatalog, ConnectorItem, TokenField, TokenSchema, ConnectorCliStatus, ConnectorCliAuthResult } from "@openbuddy/shared-types";

type JsonObject = Record<string, unknown>;
type PlatformCommand = Record<string, string>;
type EventEmitter = (channel: string, payload: unknown) => void;

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const SHORT_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 10 * 60_000;
const activeProcesses = new Map<string, Set<ChildProcess>>();

function safePart(value: string): string {
  const part = value.trim();
  if (!part || part === "." || part === ".." || /[\\/]/.test(part)) throw new Error("invalid connector path");
  return part;
}

function contained(root: string, candidate: string): string {
  const base = resolve(root);
  const target = resolve(candidate);
  const rel = relative(base, target);
  if (rel === "" || (!rel.startsWith(`..${String.fromCharCode(47)}`) && rel !== ".." && !isAbsolute(rel))) return target;
  throw new Error("connector path is outside the selected root");
}

function localize(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const object = value as JsonObject;
    return (typeof object.zh === "string" ? object.zh : typeof object.en === "string" ? object.en : "").trim();
  }
  return "";
}

function optionalString(object: JsonObject, key: string): string | undefined {
  const value = typeof object[key] === "string" ? String(object[key]).trim() : "";
  return value || undefined;
}

function category(entry: JsonObject): string {
  const auth = optionalString(entry, "auth_mode");
  if (auth && ["token", "server-side", "oneid-token", "oneid_token", "gateway"].includes(auth)) return "auth";
  switch (optionalString(entry, "type")) {
    case "mcp": return "mcp";
    case "cli": return "cli";
    case "skill-only":
    case "skill_only": return "skill";
    default: return "other";
  }
}

function categories() {
  return [
    { id: "mcp", zh: "MCP 服务" },
    { id: "cli", zh: "命令行" },
    { id: "skill", zh: "技能型" },
    { id: "auth", zh: "需授权" },
    { id: "other", zh: "其他" },
  ];
}

async function readJson(file: string): Promise<JsonObject | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

async function fileIfExists(file: string): Promise<string | undefined> {
  try { await access(file); return file; } catch { return undefined; }
}

function candidateRoots(cwd: string): string[] {
  const scopedPiRoot = process.env.PI_CODING_AGENT_DIR?.trim();
  const enterpriseScope = Boolean(process.env.OPENBUDDY_WORKBENCH_SCOPE?.trim() && process.env.OPENBUDDY_WORKBENCH_SCOPE !== "local");
  const roots = [
    process.env.OPENBUDDY_CONNECTORS_DIR,
    scopedPiRoot ? join(scopedPiRoot, "connectors-marketplace") : undefined,
    scopedPiRoot ? join(scopedPiRoot, "connectors") : undefined,
    join(resolve(cwd), ".pi", "connectors"),
    ...(enterpriseScope ? [] : [
      join(process.env.PI_HOME ?? homedir(), ".workbuddy", "connectors-marketplace"),
      join(homedir(), ".workbuddy", "connectors-marketplace"),
    ]),
  ];
  return [...new Set(roots.filter((root): root is string => Boolean(root)).map((root) => resolve(root)))];
}

async function hasManifest(root: string): Promise<boolean> {
  return Boolean(await fileIfExists(join(root, ".codebuddy-connector", "connectors.json")));
}

export async function defaultRoot(cwd: string): Promise<string> {
  for (const root of candidateRoots(cwd)) if (await hasManifest(root)) return root;
  return "";
}

export async function listRoots(root: string): Promise<string[]> {
  const base = resolve(root);
  const result: string[] = [];
  if (await hasManifest(base)) result.push(base);
  try {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (entry.isDirectory() && await hasManifest(join(base, entry.name))) result.push(join(base, entry.name));
    }
  } catch { /* missing picker root */ }
  return result;
}

async function tokenSchema(root: string, source: string): Promise<TokenSchema | undefined> {
  const file = contained(root, join(root, "connectors", safePart(source), "token-schema.json"));
  const raw = await readJson(file);
  if (!raw || !Array.isArray(raw.fields)) return undefined;
  const fields: TokenField[] = raw.fields.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const field = value as JsonObject;
    const key = optionalString(field, "key");
    if (!key) return [];
    return [{ key, label: localize(field.label) || undefined, type: optionalString(field, "type"), required: typeof field.required === "boolean" ? field.required : undefined, placeholder: localize(field.placeholder) || undefined, description: localize(field.description) || undefined }];
  });
  if (!fields.length) return undefined;
  return { title: localize(raw.title) || undefined, description: localize(raw.description) || undefined, docUrl: optionalString(raw, "docUrl"), docLabel: localize(raw.docLabel) || undefined, fields };
}

async function buildConnector(root: string, value: unknown): Promise<ConnectorItem | undefined> {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as JsonObject;
  const id = optionalString(entry, "id");
  if (!id) return undefined;
  const source = optionalString(entry, "source") ?? id;
  const name = localize(entry.name) || id;
  const description = (optionalString(entry, "description_zh") ?? localize(entry.description)) || id;
  let sourcePart: string;
  try { sourcePart = safePart(source); } catch { return undefined; }
  const iconLocal = await fileIfExists(join(root, "icons", `${sourcePart}.svg`)) ?? await fileIfExists(join(root, "icons", `${sourcePart}.png`));
  const examplesZh = Array.isArray(entry.examples_zh) ? entry.examples_zh.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  const type = optionalString(entry, "type");
  const kind = type === "skill_only" ? "skill-only" : type && ["mcp", "cli", "skill-only"].includes(type) ? type : "unknown";
  return { id, name, nameEn: optionalString(entry, "name_en"), desc: description, descEn: optionalString(entry, "description_en"), source, kind, authMode: optionalString(entry, "auth_mode"), examplesZh, cat: category(entry), iconLocal, tokenSchema: await tokenSchema(root, source) };
}

export async function loadCatalog(cwd: string, requestedRoot?: string | null): Promise<ConnectorCatalog> {
  const root = requestedRoot?.trim() ? resolve(requestedRoot) : await defaultRoot(cwd);
  if (!root) return { root: "", categories: categories(), connectors: [] };
  const manifest = await readJson(join(root, ".codebuddy-connector", "connectors.json"));
  if (!manifest) throw new Error("unable to read connector manifest");
  const values = Array.isArray(manifest.connectors) ? manifest.connectors : [];
  const connectors = (await Promise.all(values.map((value) => buildConnector(root, value)))).filter((item): item is ConnectorItem => Boolean(item));
  return { root, categories: categories(), connectors };
}

export async function readMcpConfig(root: string, source: string): Promise<string> {
  const file = contained(root, join(root, "connectors", safePart(source), "mcp.json"));
  try { return await readFile(file, "utf8"); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw error;
  }
}

function mimeFor(file: string): string {
  switch (extname(file).toLowerCase()) {
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return "application/octet-stream";
  }
}

export async function readImageData(filePath: string, allowedRoot?: string): Promise<string> {
	const file = allowedRoot
		? contained(await realpath(resolve(allowedRoot)), await realpath(resolve(filePath)))
		: resolve(filePath);
  const data = await readFile(file);
  if (data.byteLength > MAX_ASSET_BYTES) throw new Error("image exceeds 2 MiB");
  return `data:${mimeFor(file)};base64,${data.toString("base64")}`;
}

type CliSpec = {
  init?: PlatformCommand;
  versionCheck?: { command: PlatformCommand; minVersion?: string };
  auth?: PlatformCommand | Array<{ command: PlatformCommand; skipIf?: PlatformCommand; authWaitForExit?: boolean; authUrlDomain?: string; authSuppressBrowser?: boolean }>;
  unAuth?: PlatformCommand;
  status?: PlatformCommand;
  statusMatch?: string;
  statusMatchJson?: Record<string, string>;
  authUrlDomain?: string;
  authWaitForExit?: boolean;
  authQrModal?: boolean;
  authSuppressBrowser?: boolean;
};

function platformCommand(commands?: PlatformCommand): string | undefined {
  if (!commands) return undefined;
  return commands[process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux"] ?? commands.linux ?? Object.values(commands)[0];
}

async function specAt(root: string, source: string): Promise<CliSpec | null> {
  const file = contained(root, join(root, "connectors", safePart(source), "cli.json"));
  try { return JSON.parse(await readFile(file, "utf8")) as CliSpec; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`invalid cli.json: ${String(error)}`);
  }
}

function version(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function processSet(source: string): Set<ChildProcess> {
  let set = activeProcesses.get(source);
  if (!set) { set = new Set(); activeProcesses.set(source, set); }
  return set;
}

function shellCommand(command: string): { file: string; args: string[] } {
  return process.platform === "win32" ? { file: "cmd.exe", args: ["/d", "/s", "/c", command] } : { file: "/bin/sh", args: ["-c", command] };
}

async function runCommand(command: string, source: string, timeoutMs: number, emit?: EventEmitter): Promise<{ code: number; output: string }> {
  const shell = shellCommand(command);
  const child = spawn(shell.file, shell.args, { stdio: ["ignore", "pipe", "pipe"] });
  processSet(source).add(child);
  let output = "";
  let pending = "";
  const onData = (chunk: Buffer) => {
    output += chunk.toString();
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line) emit?.("connector://cli-auth-log", { source, line });
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("authorization command timed out")); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); processSet(source).delete(child); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); processSet(source).delete(child); if (pending) emit?.("connector://cli-auth-log", { source, line: pending }); resolvePromise({ code: code ?? -1, output }); });
  });
}

async function installed(spec: CliSpec): Promise<{ ok: boolean; version?: string }> {
  if (!spec.versionCheck) return { ok: true };
  const command = platformCommand(spec.versionCheck.command);
  if (!command) return { ok: false };
  try {
    const result = await runCommand(command, "__probe__", SHORT_TIMEOUT_MS);
    if (result.code !== 0) return { ok: false };
    const found = version(result.output);
    const minimum = spec.versionCheck.minVersion ? version(spec.versionCheck.minVersion) : undefined;
    return { ok: !minimum || !found || (found[0] > minimum[0] || (found[0] === minimum[0] && (found[1] > minimum[1] || (found[1] === minimum[1] && found[2] >= minimum[2])))), version: found?.join(".") };
  } catch { return { ok: false }; }
}

async function authed(spec: CliSpec): Promise<boolean> {
  const command = platformCommand(spec.status);
  if (!command) return false;
  try {
    const result = await runCommand(command, "__probe__", SHORT_TIMEOUT_MS);
    if (spec.statusMatch) return new RegExp(spec.statusMatch).test(result.output);
    if (spec.statusMatchJson) {
      const json = JSON.parse(result.output) as JsonObject;
      return Object.entries(spec.statusMatchJson).every(([key, expected]) => String(json[key]) === expected);
    }
    return result.code === 0;
  } catch { return false; }
}

export async function cliStatus(root: string, source: string): Promise<ConnectorCliStatus> {
  const spec = await specAt(root, source);
  if (!spec) return { hasSpec: false, installed: false, authed: false, qrModal: false };
  const check = await installed(spec);
  return { hasSpec: true, installed: check.ok, cliVersion: check.version, authed: check.ok && await authed(spec), qrModal: spec.authQrModal === true };
}

function authSteps(spec: CliSpec): Array<{ command: string; skipIf?: string; wait: boolean; domain?: string; suppressBrowser: boolean }> {
  if (Array.isArray(spec.auth)) return spec.auth.flatMap((step) => { const command = platformCommand(step.command); return command ? [{ command, skipIf: platformCommand(step.skipIf), wait: step.authWaitForExit !== false, domain: step.authUrlDomain ?? spec.authUrlDomain, suppressBrowser: step.authSuppressBrowser ?? spec.authSuppressBrowser === true }] : []; });
  const command = platformCommand(spec.auth);
  return command ? [{ command, wait: spec.authWaitForExit !== false, domain: spec.authUrlDomain, suppressBrowser: spec.authSuppressBrowser === true }] : [];
}

function extractUrl(line: string, domain?: string): string | undefined {
  if (!domain) return undefined;
  const match = line.match(/https:\/\/[^\s"'<>]+/g)?.find((url) => url.includes(domain));
  return match?.replace(/[),.;]}]+$/, "");
}

export async function cliAuth(root: string, source: string, emit?: EventEmitter): Promise<ConnectorCliAuthResult> {
  const spec = await specAt(root, source);
  if (!spec) return { ok: false, authed: false, error: "connector has no cli.json" };
  let check = await installed(spec);
  if (!check.ok && spec.init) {
    const init = platformCommand(spec.init);
    if (init) { const result = await runCommand(init, source, 5 * 60_000, emit); check = await installed(spec); if (result.code !== 0 || !check.ok) return { ok: false, authed: false, error: "CLI installation failed" }; }
  }
  if (!check.ok) return { ok: false, authed: false, error: "CLI is not installed" };
  if (await authed(spec)) return { ok: true, authed: true };
  const steps = authSteps(spec);
  if (!steps.length) return { ok: false, authed: false, error: "cli.json has no auth command" };
  for (const step of steps) {
    if (step.skipIf) { try { if ((await runCommand(step.skipIf, source, SHORT_TIMEOUT_MS)).code === 0) continue; } catch { /* run auth */ } }
    const result = await runCommand(step.command, source, AUTH_TIMEOUT_MS, (channel, payload) => {
      emit?.(channel, payload);
      const url = extractUrl(String((payload as { line?: unknown }).line ?? ""), step.domain);
      if (url) emit?.("connector://cli-auth-url", { source, url, qrModal: spec.authQrModal === true, suppressBrowser: step.suppressBrowser });
    });
    if (result.code !== 0) { const done = { source, ok: false, authed: false, error: `auth command exited with ${result.code}` }; emit?.("connector://cli-auth-done", done); return done; }
  }
  const authenticated = await authed(spec);
  const result = { source, ok: authenticated, authed: authenticated };
  emit?.("connector://cli-auth-done", result);
  return result.ok ? result : { ...result, error: "authorization completed but status is not authenticated" };
}

export async function cliCancel(source: string): Promise<void> {
  for (const child of processSet(source)) child.kill("SIGKILL");
  activeProcesses.delete(source);
}

export async function cliUnauth(root: string, source: string): Promise<void> {
  const spec = await specAt(root, source);
  const command = platformCommand(spec?.unAuth);
  if (!command) throw new Error("cli.json has no unAuth command");
  const result = await runCommand(command, source, SHORT_TIMEOUT_MS);
  if (result.code !== 0) throw new Error(`unAuth command exited with ${result.code}`);
}

export async function cliSkillsDir(root: string, source: string): Promise<string | null> {
  const dir = contained(root, join(root, "connectors", safePart(source), "skills"));
  try { return (await stat(dir)).isDirectory() ? dir : null; } catch { return null; }
}
