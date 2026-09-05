import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultHarnessTokenPath(): string {
	const home = process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
	return join(home, "openbuddy-harness-token");
}

function validToken(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{20,256}$/.test(value);
}

export async function resolveHarnessAuthToken(options: { envToken?: string; path?: string } = {}): Promise<string> {
	if (validToken(options.envToken)) return options.envToken;
	const path = options.path ?? defaultHarnessTokenPath();
	try {
		const persisted = (await readFile(path, "utf8")).trim();
		if (validToken(persisted)) {
			await chmod(path, 0o600).catch(() => undefined);
			return persisted;
		}
	} catch {
	}
	const token = randomUUID().replaceAll("-", "");
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${token}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
	return token;
}
