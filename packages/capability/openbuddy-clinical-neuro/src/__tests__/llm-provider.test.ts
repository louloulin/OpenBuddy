import { describe, expect, it } from "vitest";
import { ClinicalNeuroError, OpenAiCompatibleClinicalLlm } from "../index";

function jsonResponse(content: unknown, status = 200): Response {
	return new Response(JSON.stringify(content), { status });
}

describe("OpenAI-compatible clinical LLM", () => {
	it("sends an authorized chat completion request and parses differentials", async () => {
		let request: Request | undefined;
		const provider = new OpenAiCompatibleClinicalLlm("https://gateway.test/v1/", "test-key", "model-a", undefined, async (input, init) => {
			request = new Request(input, init);
			return jsonResponse({ choices: [{ message: { content: "{\"differentials\":[]}" } }] });
		});

		await expect(provider.generateDifferential("脱敏病历", "neurology")).resolves.toEqual([]);
		expect(request?.url).toBe("https://gateway.test/v1/chat/completions");
		expect(request?.method).toBe("POST");
		expect(request?.headers.get("Authorization")).toBe("Bearer test-key");
		expect(await request?.text()).toContain("脱敏病历");
	});

	it("wraps gateway connection failures as clinical LLM unavailable errors", async () => {
		const provider = new OpenAiCompatibleClinicalLlm("https://gateway.test/v1", "test-key", "model-a", undefined, async () => {
			throw new TypeError("fetch failed");
		});

		const error = await provider.generateDifferential("脱敏病历").catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(ClinicalNeuroError);
		expect(error).toMatchObject({ code: "llm_unavailable", message: "无法连接临床 LLM 网关: fetch failed" });
	});
});
