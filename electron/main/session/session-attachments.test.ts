import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionAttachmentStore } from "./session-attachments";

const roots: string[] = [];
const png = "iVBORw0KGgo=";

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionAttachmentStore", () => {
	it("persists and reads an attachment only for its owning session", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-attachments-"));
		roots.push(root);
		const store = new SessionAttachmentStore(root);
		const attachment = await store.save({ sessionId: "session-a", mediaType: "image/png", data: png, name: "folder/image.png" });
		await expect(store.read("session-a", attachment.attachmentId)).resolves.toMatchObject({ attachment: { sessionId: "session-a", name: "image.png", bytes: 8 } });
		await expect(store.read("session-b", attachment.attachmentId)).rejects.toMatchObject({ code: "lookup-not-found" });
	});

	it("rejects unsupported, oversized, and corrupted attachments", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-attachments-"));
		roots.push(root);
		const store = new SessionAttachmentStore(root, 4);
		await expect(store.save({ sessionId: "session-a", mediaType: "text/plain", data: "aA==" })).rejects.toMatchObject({ code: "bad-request" });
		await expect(store.save({ sessionId: "session-a", mediaType: "image/png", data: "aGVsbG8=" })).rejects.toMatchObject({ code: "bad-request" });
		const attachment = await new SessionAttachmentStore(root).save({ sessionId: "session-a", mediaType: "image/png", data: png });
		const dataPath = join(root, "session-a", `${attachment.attachmentId}.bin`);
		await writeFile(dataPath, "changed");
		await expect(new SessionAttachmentStore(root).read("session-a", attachment.attachmentId)).rejects.toMatchObject({ code: "internal" });
	});
});
