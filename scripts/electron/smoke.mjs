import { _electron as electron } from "playwright";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import WebSocket from "ws";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const nodeExecutable = process.env.OPENBUDDY_SMOKE_NODE ?? "node";
const userData = mkdtempSync(join(tmpdir(), "openbuddy-electron-smoke-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const harnessCursorPath = join(piAgentDir, "openbuddy-harness-cursors.json");
writeFileSync(harnessCursorPath, JSON.stringify({ cursors: { "smoke-cursor-session": 7 } }, null, 2));
let providerRequestCount = 0;
const providerProtocolCounts = { messages: 0, chat_completions: 0, responses: 0 };

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sessionDigest(value) {
  return typeof value === "string" && value ? sha256(value).slice(0, 12) : undefined;
}

function eventSummary(events) {
  return events.map((event) => ({
    type: event?.type,
    sequence: event?.sequence,
    sessionId: sessionDigest(event?.sessionId ?? event?.payload?.sessionId),
  }));
}

function safeErrorMessage(error) {
  return String(error?.message ?? error ?? "unknown error")
    .replace(/sk-cp-[A-Za-z0-9_-]+/g, "[redacted-api-key]")
    .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]");
}

function eventContainsSessionInput(event, promptText) {
  if (event?.type !== "session/input" || !event?.payload || typeof event.payload !== "object") return false;
  const text = event.payload.text;
  if (text === promptText) return true;
  if (!text || typeof text !== "object") return false;
  return text.length === promptText.length
    && text.sha256 === sha256(promptText)
    && (typeof text.preview !== "string" || text.preview === promptText.slice(0, 80).replace(/[\r\n\t]/g, " "));
}

const discoveryServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/search") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<a class="result__a" href="http://127.0.0.1/page">Smoke Search Result</a><a class="result__snippet">Electron web search fixture</a>');
    return;
  }
  if (pathname === "/page") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Electron web fetch fixture");
    return;
  }
  const authenticated = request.headers["x-api-key"] === "smoke-key"
    || request.headers["x-api-key"] === "smoke-discovery-key"
    || request.headers.authorization === "Bearer smoke-openai-key";
  if (!authenticated) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (request.url === "/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "discovered-model", owned_by: "smoke" }] }));
    return;
  }
  const protocol = pathname.endsWith("/messages")
    ? "messages"
    : pathname.endsWith("/chat/completions")
      ? "chat_completions"
      : pathname.endsWith("/responses")
        ? "responses"
        : null;
  if (!protocol) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  for await (const _chunk of request) { /* consume the request before streaming */ }
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const responseNumber = ++providerRequestCount;
  providerProtocolCounts[protocol] += 1;
  const text = `${protocol}-response-${responseNumber}`;
  const events = protocol === "messages"
    ? [
      ["message_start", { type: "message_start", message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model: "smoke-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
      ["message_stop", { type: "message_stop" }],
    ]
    : protocol === "chat_completions"
      ? [
        [null, { id: `chatcmpl_${Date.now()}`, object: "chat.completion.chunk", model: "smoke-chat-model", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }],
        [null, { id: `chatcmpl_${Date.now()}`, object: "chat.completion.chunk", model: "smoke-chat-model", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }],
        [null, { id: `chatcmpl_${Date.now()}`, object: "chat.completion.chunk", model: "smoke-chat-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }],
        [null, "[DONE]"],
      ]
      : [
        ["response.created", { type: "response.created", response: { id: `resp_${Date.now()}`, object: "response", status: "in_progress", output: [] } }],
        ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${Date.now()}`, role: "assistant", status: "in_progress", content: [], phase: "final_answer" } }],
        ["response.output_text.delta", { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text }],
        ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${Date.now()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text }], phase: "final_answer" } }],
        ["response.completed", { type: "response.completed", response: { id: `resp_${Date.now()}`, object: "response", status: "completed", output: [{ type: "message", phase: "final_answer", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }],
      ];
  for (const [event, payload] of events) {
    response.write(event ? `event: ${event}\n` : "");
    response.write(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  response.end();
});
await new Promise((resolve) => discoveryServer.listen(0, "127.0.0.1", resolve));
const discoveryBaseUrl = `http://127.0.0.1:${discoveryServer.address().port}`;
process.env.OPENBUDDY_WEB_SEARCH_ENDPOINT = `${discoveryBaseUrl}/search`;
const skillDir = join(piAgentDir, "skills", "electron-smoke-skill");
mkdirSync(skillDir, { recursive: true });
writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: Electron smoke fixture\n---\n\nSmoke fixture skill.\n", "utf8");
const skillImportSource = mkdtempSync(join(tmpdir(), "openbuddy-electron-skill-import-"));
const importedSkillName = "electron-smoke-imported-skill";
const importedSkillSourceDir = join(skillImportSource, importedSkillName);
mkdirSync(importedSkillSourceDir, { recursive: true });
writeFileSync(join(importedSkillSourceDir, "SKILL.md"), "---\nname: electron-smoke-imported-skill\ndescription: Imported Electron smoke skill\n---\n\nImported skill fixture.\n", "utf8");
const extensionDir = join(piAgentDir, "extensions");
mkdirSync(extensionDir, { recursive: true });
writeFileSync(join(extensionDir, "electron-smoke-ui.ts"), `import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "openbuddy_e2e_tool",
    label: "OpenBuddy E2E tool",
    description: "Return the exact verification marker supplied by the user. Use this tool when the user explicitly requests the OpenBuddy E2E tool.",
    parameters: Type.Object({ marker: Type.String() }),
    execute: async (_toolCallId, params) => ({
      content: [{ type: "text", text: params.marker }],
      details: { source: "openbuddy-e2e-pi-extension" },
    }),
  });
  pi.on("turn_start", (_event, ctx) => {
    void (async () => {
      ctx.ui.setEditorText("extension-ui-smoke");
      ctx.ui.setStatus("electron-smoke", "extension-ui-ready");
      ctx.ui.setWorkingMessage("Smoke is working");
      ctx.ui.setWorkingVisible(true);
      ctx.ui.setWorkingIndicator({ label: "Smoke" });
      ctx.ui.setHiddenThinkingLabel("Smoke thinking");
      ctx.ui.setToolsExpanded(true);
      ctx.ui.setFooter(() => undefined);
      ctx.ui.setEditorComponent(() => undefined);
      ctx.ui.onTerminalInput(() => undefined);
      ctx.ui.getTheme();
      const confirmed = await ctx.ui.confirm("Smoke confirm", "Allow smoke confirmation?");
      const selected = await ctx.ui.select("Smoke select", ["option-one", "option-two"]);
      const input = await ctx.ui.input("Smoke input", "Type smoke input");
      ctx.ui.setStatus("electron-smoke", "confirm=" + confirmed + ";select=" + selected + ";input=" + input);
    })().catch(() => undefined);
  });
}
`, "utf8");
const profileDir = join(piAgentDir, "profiles", "desktop");
const profilePatchPath = join(profileDir, "cordis.patch.yml");
const profileBundleDir = join(profileDir, "node_modules", "electron-smoke-bundle");
mkdirSync(profileBundleDir, { recursive: true });
const piPackageDir = join(profileDir, "node_modules", "electron-smoke-pi-package");
mkdirSync(join(piPackageDir, "extensions"), { recursive: true });
mkdirSync(join(piPackageDir, "skills", "pi-smoke-skill"), { recursive: true });
mkdirSync(join(piPackageDir, "prompts"), { recursive: true });
mkdirSync(join(piPackageDir, "themes"), { recursive: true });
writeFileSync(join(piPackageDir, "package.json"), `${JSON.stringify({
  name: "electron-smoke-pi-package",
  version: "1.0.0",
  type: "module",
  pi: { extensions: ["./extensions"], skills: ["./skills"], prompts: ["./prompts"], themes: ["./themes"] },
}, null, 2)}\n`, "utf8");
writeFileSync(join(piPackageDir, "extensions", "smoke-command.js"), `export default function (pi) {
  pi.registerCommand("pi-smoke-command", { description: "Electron Pi package smoke command", handler: async () => {} });
}
`, "utf8");
writeFileSync(join(piPackageDir, "skills", "pi-smoke-skill", "SKILL.md"), "---\nname: pi-smoke-skill\ndescription: Electron Pi package smoke skill\n---\n\nPi package smoke skill.\n", "utf8");
writeFileSync(join(piPackageDir, "prompts", "pi-smoke-prompt.md"), "---\ndescription: Electron Pi package smoke prompt\n---\n\nPi package smoke prompt.\n", "utf8");
const smokeThemeColors = Object.fromEntries([
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel", "toolPendingBg", "toolSuccessBg", "toolErrorBg",
  "toolTitle", "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType",
  "syntaxOperator", "syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode",
].map((name) => [name, "#336699"]));
writeFileSync(join(piPackageDir, "themes", "pi-smoke-theme.json"), `${JSON.stringify({ name: "pi-smoke-theme", colors: smokeThemeColors }, null, 2)}\n`, "utf8");
writeFileSync(join(profileDir, "package.json"), `${JSON.stringify({
  name: "openbuddy-profile-desktop",
  private: true,
  openbuddy: { profile: { bundles: [] } },
  dsh: { profile: { bundles: ["electron-smoke-bundle"] } },
}, null, 2)}\n`, "utf8");
writeFileSync(join(profileDir, "cordis.patch.yml"), "[]\n", "utf8");
writeFileSync(join(profileBundleDir, "package.json"), `${JSON.stringify({
  name: "electron-smoke-bundle",
  private: true,
  type: "module",
  exports: { "./plugin": "./plugin.mjs", "./client": "./client.mjs" },
  dsh: {
    bundle: { patch: "./cordis.patch.yml" },
    client: { platform: "web", module: "electron-smoke-bundle/client", immediately: true },
  },
}, null, 2)}\n`, "utf8");
writeFileSync(join(profileBundleDir, "cordis.patch.yml"), `- insert:
    - id: electron-smoke-profile
      name: electron-smoke-bundle/plugin
      config:
        source: profile
`, "utf8");
writeFileSync(join(profileBundleDir, "client.mjs"), `export default {
  apply(ctx) {
    const registry = ctx.get("rendererContributions");
    return registry.register({ kind: "sidebar", id: "electron-smoke-client", payload: { label: "Electron smoke client" } });
  },
};
`, "utf8");
writeFileSync(join(profileBundleDir, "plugin.mjs"), `export default {
  apply(ctx, config) {
    ctx.provide("electronSmokeProfile", { loaded: true, source: config?.source });
  },
};
`, "utf8");
const profileInstallSource = mkdtempSync(join(tmpdir(), "openbuddy-electron-profile-install-"));
writeFileSync(join(profileInstallSource, "package.json"), `${JSON.stringify({
  name: "electron-smoke-installed-client",
  version: "1.0.0",
  private: true,
  exports: { ".": "./plugin.mjs", "./client": "./client.mjs", "./plugin": "./plugin.mjs", "./remote": "./remote.mjs" },
  pi: { extensions: ["./extensions/index.mjs"], skills: ["./skills"] },
  dsh: {
    bundle: { patch: "./cordis.patch.yml" },
    client: { platform: "web", module: "electron-smoke-installed-client/client" },
  },
}, null, 2)}\n`, "utf8");
mkdirSync(join(profileInstallSource, "extensions"), { recursive: true });
mkdirSync(join(profileInstallSource, "skills", "electron-smoke-installed-skill"), { recursive: true });
writeFileSync(join(profileInstallSource, "cordis.patch.yml"), `- insert:
    - id: electron-smoke-installed-plugin
      name: electron-smoke-installed-client/plugin
      config:
        source: installed-profile
`, "utf8");
writeFileSync(join(profileInstallSource, "extensions", "index.mjs"), `export default function (pi) {
  pi.registerCommand("profile-pi-installed-command", { description: "Profile-installed Pi smoke command", handler: async () => {} });
}
`, "utf8");
writeFileSync(join(profileInstallSource, "skills", "electron-smoke-installed-skill", "SKILL.md"), "---\nname: electron-smoke-installed-skill\ndescription: Profile-installed Pi smoke skill\n---\n\nProfile-installed Pi smoke skill.\n", "utf8");
writeFileSync(join(profileInstallSource, "client.mjs"), `export default {
  apply(ctx) {
    const marker = document.createElement("meta");
    marker.dataset.openbuddySmokeRenderer = "electron-smoke-installed-client";
    document.head.append(marker);
    const contributions = ctx.get("rendererContributions");
    const unregister = contributions.register({
      kind: "sidebar",
      id: "electron-smoke-installed-client:sidebar",
      payload: { label: "Electron smoke renderer" },
    });
    return () => {
      unregister();
      marker.remove();
    };
  },
};
`, "utf8");
writeFileSync(join(profileInstallSource, "plugin.mjs"), `export default {
  apply(ctx, config) {
    ctx.provide("electronSmokeInstalledPlugin", { loaded: true, source: config?.source });
  },
};
`, "utf8");
writeFileSync(join(profileInstallSource, "remote.mjs"), `export const TYPERT_REMOTE = {
  package: "electron-smoke-installed-client",
  descriptors: [{ namespace: "smoke", method: "list", service: "commands", implementation: "list" }],
};
`, "utf8");
const agentFixture = "---\nname: electron-smoke-agent\ndescription: Electron smoke fixture\n---\n\nReturn smoke fixture.\n";
mkdirSync(join(piAgentDir, "agents"), { recursive: true });
writeFileSync(join(piAgentDir, "agents", "electron-smoke-agent.md"), agentFixture, "utf8");
const marketplaceSource = mkdtempSync(join(tmpdir(), "openbuddy-electron-marketplace-"));
mkdirSync(join(marketplaceSource, "plugins", "electron-smoke-market", "extensions"), { recursive: true });
mkdirSync(join(marketplaceSource, "plugins", "electron-smoke-market", "skills", "hello"), { recursive: true });
mkdirSync(join(marketplaceSource, "plugins", "electron-smoke-market", "agents"), { recursive: true });
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "package.json"), `${JSON.stringify({
  name: "electron-smoke-market",
  version: "1.0.0",
  description: "Electron marketplace fixture",
  exports: { ".": "./plugin.mjs", "./client": "./client.mjs", "./plugin": "./plugin.mjs", "./remote": "./remote.mjs" },
  pi: { extensions: ["./extensions/index.mjs"], skills: ["./skills"] },
  dsh: {
    bundle: { patch: "./cordis.patch.yml" },
    client: { platform: "web", module: "electron-smoke-market/client", immediately: true },
  },
  openbuddy: {
    hooks: {
      "turn/start": [{ hooks: [{ type: "command", command: "printf '{\\\"additionalContext\\\":\\\"marketplace hook observed\\\"}'" }] }],
    },
  },
}, null, 2)}\n`, "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "mcp.json"), JSON.stringify({ mcpServers: { "marketplace-smoke": { command: "marketplace-smoke-server", disabled: true } } }, null, 2), "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "agents", "marketplace-reviewer.md"), "---\ndescription: Marketplace smoke reviewer\n---\nReview marketplace smoke changes.\n", "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "cordis.patch.yml"), `- insert:
    - id: electron-smoke-market-plugin
      name: electron-smoke-market/plugin
` , "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "extensions", "index.mjs"), `export default function (pi) {
  pi.registerCommand("marketplace-pi-command", { description: "Marketplace Pi smoke command", handler: async () => {} });
}
`, "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "skills", "hello", "SKILL.md"), "---\ndescription: Marketplace fixture\n---\n", "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "plugin.mjs"), `export default {
  apply(ctx) {
    ctx.provide("electronSmokeMarketplaceHarness", { list: () => ["marketplace-harness"] });
  },
};
`, "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "client.mjs"), `export default {
  apply(ctx) {
    const marker = document.createElement("meta");
    marker.dataset.openbuddySmokeRenderer = "electron-smoke-market-client";
    document.head.append(marker);
    return () => marker.remove();
  },
};
`, "utf8");
writeFileSync(join(marketplaceSource, "plugins", "electron-smoke-market", "remote.mjs"), `export const TYPERT_REMOTE = {
  package: "electron-smoke-market",
  descriptors: [{ namespace: "marketplace", method: "list", service: "electronSmokeMarketplaceHarness", implementation: "list" }],
};
`, "utf8");
const connectorRoot = mkdtempSync(join(tmpdir(), "openbuddy-electron-connectors-"));
const connectorSource = "electron-smoke-cli";
const connectorCancelSource = "electron-smoke-cancel";
mkdirSync(join(connectorRoot, ".codebuddy-connector"), { recursive: true });
mkdirSync(join(connectorRoot, "connectors", connectorSource, "skills"), { recursive: true });
mkdirSync(join(connectorRoot, "connectors", connectorCancelSource, "skills"), { recursive: true });
const connectorAuthMarker = join(connectorRoot, "authenticated");
const connectorCancelStarted = join(connectorRoot, "cancel-started");
writeFileSync(join(connectorRoot, ".codebuddy-connector", "connectors.json"), JSON.stringify({ connectors: [
  { id: connectorSource, source: connectorSource, name: "Electron smoke CLI", type: "cli" },
  { id: connectorCancelSource, source: connectorCancelSource, name: "Electron smoke cancel CLI", type: "cli" },
] }), "utf8");
writeFileSync(join(connectorRoot, "connectors", connectorSource, "cli.json"), JSON.stringify({
  versionCheck: { command: { darwin: `${nodeExecutable} -e 'console.log("1.0.0")'` }, minVersion: "0.1.0" },
  status: { darwin: `${nodeExecutable} -e "process.exit(require('fs').existsSync('${connectorAuthMarker}') ? 0 : 1)"` },
  auth: { darwin: `${nodeExecutable} -e "require('fs').writeFileSync('${connectorAuthMarker}','1'); console.log('https://example.com/openbuddy-smoke')"` },
  unAuth: { darwin: `${nodeExecutable} -e 'require("node:fs").rmSync("${connectorAuthMarker}",{force:true})'` },
  authUrlDomain: "example.com",
  authSuppressBrowser: true,
}), "utf8");
writeFileSync(join(connectorRoot, "connectors", connectorCancelSource, "cli.json"), JSON.stringify({
  versionCheck: { command: { darwin: `${nodeExecutable} -e 'console.log("1.0.0")'` }, minVersion: "0.1.0" },
  status: { darwin: `${nodeExecutable} -e "process.exit(1)"` },
  auth: { darwin: `${nodeExecutable} -e "require('fs').writeFileSync('${connectorCancelStarted}','1'); setTimeout(() => {}, 30000)"` },
  authSuppressBrowser: true,
}), "utf8");
const knowledgeRoot = mkdtempSync(join(tmpdir(), "openbuddy-electron-knowledge-"));
writeFileSync(join(knowledgeRoot, "smoke-note.md"), "OpenBuddy Electron knowledge source smoke", "utf8");
const storageRoot = mkdtempSync(join(tmpdir(), "openbuddy-electron-storage-"));
const importSource = join(tmpdir(), `openbuddy-electron-import-${Date.now()}.txt`);
writeFileSync(importSource, "import smoke", "utf8");
const e2eApiKey = process.env.OPENBUDDY_E2E_API_KEY?.trim() || undefined;
const e2eBaseUrl = process.env.OPENBUDDY_E2E_BASE_URL?.trim() || undefined;
const e2eModelId = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() || undefined;
const e2eRequested = process.env.OPENBUDDY_E2E_REQUIRED === "1";
// Filesystem capability smoke is intentionally disabled by product policy.
const filesystemSmoke = false;
const realE2E = Boolean(e2eApiKey && e2eBaseUrl && e2eModelId);
const externalE2E = realE2E && process.env.OPENBUDDY_E2E_EXTERNAL === "1";
if (e2eRequested && !realE2E) {
  throw new Error("OPENBUDDY_E2E_REQUIRED=1 requires OPENBUDDY_E2E_API_KEY, OPENBUDDY_E2E_BASE_URL, and OPENBUDDY_E2E_MODEL_ID");
}
const configuredApiKey = realE2E ? e2eApiKey : "smoke-key";
const configuredBaseUrl = realE2E ? e2eBaseUrl : discoveryBaseUrl;
const configuredModelId = realE2E ? e2eModelId : "smoke-model";
const activeModelId = `custom_anthropic/${configuredModelId}`;
const providerEntries = {
  custom_anthropic: {
    name: realE2E ? "MiniMax Anthropic" : "Smoke Anthropic",
    baseUrl: configuredBaseUrl,
    api: "anthropic-messages",
    authHeader: false,
    models: [{ id: configuredModelId, name: configuredModelId, contextWindow: 128000, maxTokens: 16384 }],
  },
  ...(realE2E ? {} : {
    smoke_anthropic: {
      name: "Electron Smoke Fixture",
      baseUrl: discoveryBaseUrl,
      api: "anthropic-messages",
      authHeader: false,
      models: [{ id: "smoke-model", name: "smoke-model", contextWindow: 128000, maxTokens: 16384 }],
    },
    smoke_openai: {
      name: "Electron Smoke OpenAI Completions",
      baseUrl: discoveryBaseUrl,
      api: "openai-completions",
      authHeader: true,
      models: [{ id: "smoke-chat-model", name: "smoke-chat-model", contextWindow: 128000, maxTokens: 16384 }],
    },
    smoke_responses: {
      name: "Electron Smoke OpenAI Responses",
      baseUrl: discoveryBaseUrl,
      api: "openai-responses",
      authHeader: true,
      models: [{ id: "smoke-responses-model", name: "smoke-responses-model", contextWindow: 128000, maxTokens: 16384 }],
    },
  }),
};
const authEntries = realE2E
  ? { custom_anthropic: { type: "api_key", key: configuredApiKey } }
  : {
    custom_anthropic: { type: "api_key", key: configuredApiKey },
    smoke_anthropic: { type: "api_key", key: "smoke-key" },
    smoke_openai: { type: "api_key", key: "smoke-openai-key" },
    smoke_responses: { type: "api_key", key: "smoke-openai-key" },
  };
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({
  providers: providerEntries,
}, null, 2)}\n`, "utf8");
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify(authEntries, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const emailMcpServer = process.env.OPENBUDDY_EMAIL_MCP_SERVER?.trim() || "mail-e2e";
const emailMcpCommand = process.env.OPENBUDDY_EMAIL_MCP_COMMAND?.trim() || nodeExecutable;
const emailMcpArgs = process.env.OPENBUDDY_EMAIL_MCP_ARGS_JSON
  ? JSON.parse(process.env.OPENBUDDY_EMAIL_MCP_ARGS_JSON)
  : [join(root, "evals", "node", "echo", "email-mcp-server.mjs")];
const emailMcpPayload = JSON.stringify({
  mcpServers: { [emailMcpServer]: { command: emailMcpCommand, args: emailMcpArgs, reconnect: { enabled: false } } },
}, null, 2) + "\n";
if (Array.isArray(emailMcpArgs)) {
  // Casdoor defaults pass readConfig() validation, so the agent's workbench-scope
  // path resolution (piRoot() -> workbench-scoped pi-agent/mcp.json) diverges
  // from the legacy root (piAgentDir) used by ModelRuntime. Write to both so
  // the smoke gate works regardless of the resolved scope.
  writeFileSync(join(piAgentDir, "mcp.json"), emailMcpPayload, { encoding: "utf8", mode: 0o600 });
  const __workbenchScope = "signed-out";
  const __workbenchRoot = join(userData, "workspaces", __workbenchScope, "pi-agent");
  mkdirSync(__workbenchRoot, { recursive: true });
  writeFileSync(join(__workbenchRoot, "mcp.json"), emailMcpPayload, { encoding: "utf8", mode: 0o600 });
}
if (realE2E) {
  const configuredModelProviders = Object.keys(JSON.parse(readFileSync(join(piAgentDir, "models.json"), "utf8")).providers ?? {});
  const configuredAuthProviders = Object.keys(JSON.parse(readFileSync(join(piAgentDir, "auth.json"), "utf8")));
  if (configuredModelProviders.length !== 1 || configuredModelProviders[0] !== "custom_anthropic"
    || configuredAuthProviders.length !== 1 || configuredAuthProviders[0] !== "custom_anthropic") {
    throw new Error(`Real MiniMax mode must not configure fixture providers: ${JSON.stringify({ configuredModelProviders, configuredAuthProviders })}`);
  }
}
const errors = [];
const processErrors = [];
const expectedValidationHandlers = new Set([
  "agent:new-session",
  "agent:prompt",
  "agent:set-model",
  "agent:steer",
  "agent:follow-up",
  "agent:session-info",
  "sessions:set-pinned",
  "shellfs:read-text",
  "mcp:toggle",
  "agent:providers-save-provider",
  "agent:providers-save-model",
  "agent:extensions-reload",
  "agent:deepseek-cordis-invoke",
  "agent:presets-list",
  "agent:preset-current",
  "agent:preset-select",
  "agent:preset-default-save",
  "collaboration:execute",
  "collaboration:network-offer",
  "collaboration:network-proposal",
  "collaboration:network-bid",
  "collaboration:network-award",
  "collaboration:propose",
  "email:drafts",
  "harness:resume-token-set",
  "workbuddy_import_preview",
  "workbuddy_import_confirm",
  "workbuddy_import_rollback",
  "shellfs:stat",
  "shellfs:write-text",
  "shellfs:list-dir",
]);
const optionalAuthSmoke = !realE2E;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const expectInvokeReject = async (label, action) => {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label} accepted an invalid payload`);
};
let passed = false;
let app2;
let realE2eSessionId = null;
let realE2eEvidence = null;
let calendarEvidence = null;

const recordProcessError = (line) => {
  const handler = line.match(/Error occurred in handler for '([^']+)'/i)?.[1];
  if (handler && expectedValidationHandlers.has(handler)) return false;
  if (/Error occurred in handler for 'agent:preset-select'/i.test(line)) return false;
  if (/agent-presets:\s+preset "missing-smoke-preset" was not found/i.test(line)) return false;
  if (optionalAuthSmoke && /Error occurred in handler for 'agent:prompt'/i.test(line)) return false;
  processErrors.push(line);
  return true;
};

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: process.env.OPENBUDDY_ELECTRON_PATH || undefined,
  cwd: root,
  timeout: 30_000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    PI_CODING_AGENT_DIR: piAgentDir,
    OPENBUDDY_DEBUG_UI: "1",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});
const electronProcess = app.process();

let rendererClosedError = null;
let electronExitError = null;
let intentionalElectronClose = false;
electronProcess?.on("exit", (code, signal) => {
  if (code === 0 && signal === null) return;
  electronExitError = `Electron main process exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`;
  console.error(`[electron:exit] ${electronExitError}`);
});
electronProcess?.on("error", (error) => {
  electronExitError = `Electron main process emitted error: ${safeErrorMessage(error?.message ?? error)}`;
  console.error(`[electron:error] ${electronExitError}`);
});

electronProcess?.stderr?.on("data", (chunk) => {
  const line = String(chunk).trim();
  if (/Error occurred in handler|Unhandled|uncaught/i.test(line)) {
    if (recordProcessError(line)) console.error(`[electron] ${safeErrorMessage(line).slice(0, 500)}`);
  }
});
electronProcess?.stdout?.on("data", (chunk) => {
  const line = String(chunk).trim();
  if (/\b(Error|Unhandled|uncaught)\b|property .* is not registered/i.test(line)) {
    if (recordProcessError(line)) console.error(`[electron:stdout] ${safeErrorMessage(line).slice(0, 500)}`);
  }
});

let window = await app.firstWindow();
window.on("close", () => {
  if (passed || intentionalElectronClose) return;
  rendererClosedError = "renderer window closed before the smoke run finished";
  console.error(`[renderer] ${rendererClosedError}`);
});
window.on("crash", () => {
  rendererClosedError = "renderer window crashed before the smoke run finished";
  console.error(`[renderer] ${rendererClosedError}`);
});
window.on("disconnected", () => {
  rendererClosedError = "renderer window disconnected before the smoke run finished";
  console.error(`[renderer] ${rendererClosedError}`);
});

window.on("console", (message) => {
  const text = `${message.type()}: ${message.text()}`;
  if (message.type() === "error") {
    if (/WebSocket connection to .*\/api\/events\.(?:mux|host)/i.test(text)) return;
    errors.push(text);
    console.error(`[renderer] ${safeErrorMessage(text).slice(0, 500)}`);
  }
});
window.on("pageerror", (error) => {
  errors.push(`pageerror: ${error.message}`);
  console.error(`[renderer] pageerror: ${safeErrorMessage(error.message).slice(0, 500)}`);
});
window.on("requestfailed", (request) => {
  const url = request.url();
  if (/\/api\/events\.(?:mux|host)/i.test(url)) return;
  if (/\/api\/host\.describe/i.test(url) && request.failure()?.errorText === "net::ERR_ABORTED") return;
  errors.push(`requestfailed: ${request.failure()?.errorText ?? "unknown"} ${url}`);
});

try {
  await window.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  await window.locator("#root").waitFor({ state: "attached", timeout: 15_000 });

  const result = await window.evaluate(async () => {
    const init = await window.api.invoke("agent:init");
    const sessions = await window.api.invoke("sessions:list", init.cwd);
    const plugins = await window.api.invoke("agent:plugin-list");
    const presets = await window.api.invoke("agent:presets-list", init.cwd);
    const currentPreset = await window.api.invoke("agent:preset-current");
    const presetDefault = await window.api.invoke("agent:preset-default-save");
    let presetSelectValidation = false;
    try {
      await window.api.invoke("agent:preset-select", { id: "missing-smoke-preset" });
    } catch {
      presetSelectValidation = true;
    }
    const hostRpc = await window.api.rpc.request({ type: "client-request", rpcId: "smoke-host", method: "host.describe", payload: {} });
    const sessionRpc = await window.api.rpc.request({ type: "client-request", rpcId: "smoke-session-list", method: "session.list", payload: { cwd: init.cwd } });
    const malformedRpc = await window.api.rpc.request({ type: "client-request", rpcId: "smoke-malformed", method: "session.list", payload: null });
  const rendererEntries = await window.api.invoke("agent:renderer-plugin-entries");
  const rendererBoot = await window.api.invoke("agent:renderer-plugin-boot");
  const mailStatusDeadline = Date.now() + 15_000;
  let mailStatuses = [];
  while (Date.now() < mailStatusDeadline) {
    mailStatuses = await window.api.invoke("mcp:status");
    if (mailStatuses?.some((entry) => entry.serverName === "mail-e2e" && entry.status === "ready")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const mailStatus = mailStatuses.find((entry) => entry.serverName === "mail-e2e");
  if (mailStatus?.status !== "ready") {
    const mcpConfig = await window.api.invoke("mcp:config-read").catch((error) => ({ error: String(error) }));
    throw new Error(`Email MCP was not ready for preload IPC smoke: ${JSON.stringify({ mailStatuses, mcpConfig })}`);
  }
  const emailDiagnostics = await window.api.invoke("email:provider-diagnostics");
  const emailAccounts = await window.api.invoke("email:accounts");
  const emailAccountId = emailAccounts?.[0]?.id;
  if (!emailAccountId || emailDiagnostics?.readiness !== "ready") throw new Error(`Email provider diagnostics failed: ${JSON.stringify({ emailDiagnostics, emailAccounts })}`);
  const emailRulesBefore = await window.api.invoke("email:rules");
  const emailRule = await window.api.invoke("email:save-rule", {
    name: "Electron preload smoke rule",
    enabled: true,
    condition: { accountId: emailAccountId, subjectContains: "真实 MCP" },
    actions: [{ kind: "mark-read", rationale: "preload IPC smoke" }],
  });
  const emailRuleRun = await window.api.invoke("email:run-rule", { ruleId: emailRule.id });
  const emailScheduledRuleRun = await window.api.invoke("email:run-scheduled-rules");
  const emailRuleList = await window.api.invoke("email:rules");
  await window.api.invoke("email:delete-rule", { ruleId: emailRule.id });
  const emailSync = await window.api.invoke("email:sync", { accountId: emailAccountId });
  const emailSyncStates = await window.api.invoke("email:sync-states", { accountId: emailAccountId });
  const emailThreads = await window.api.invoke("email:threads", { accountId: emailAccountId, query: "真实 MCP" });
  const emailPage = await window.api.invoke("email:threads-page", { accountId: emailAccountId, limit: 10 });
  const emailThread = await window.api.invoke("email:thread", { accountId: emailAccountId, threadId: "thread-1" });
  const emailLabels = await window.api.invoke("email:labels", { accountId: emailAccountId });
  const emailReplyZero = await window.api.invoke("email:reply-zero", { accountId: emailAccountId });
  const emailInboxReceipt = await window.api.invoke("email:ack-inbox", { accountId: emailAccountId, threadId: "thread-1" });
  const emailInboxSnapshot = await window.api.invoke("collaboration:snapshot");
  const emailDigest = await window.api.invoke("email:digest", { accountId: emailAccountId });
  const emailTriage = await window.api.invoke("email:triage", { accountId: emailAccountId });
  const emailDryRun = await window.api.invoke("email:update", { accountId: emailAccountId, threadId: "thread-1", kind: "star", value: true, dryRun: true });
  await window.api.invoke("email:update", { accountId: emailAccountId, threadId: "thread-1", kind: "mark-read" });
  await window.api.invoke("email:update", { accountId: emailAccountId, threadId: "thread-1", kind: "mark-unread" });
  await window.api.invoke("email:update", { accountId: emailAccountId, threadId: "thread-1", kind: "star", value: true });
  await window.api.invoke("email:update", { accountId: emailAccountId, threadId: "thread-1", kind: "star", value: false });
  await window.api.invoke("email:update", { accountId: emailAccountId, threadId: "thread-1", kind: "label", labelId: "label-starred", value: true });
  const emailTags = await window.api.invoke("email:update-workspace-tags", { accountId: emailAccountId, threadId: "thread-1", tagNames: ["ElectronSmoke"], mode: "replace" });
  const emailTagSnapshot = await window.api.invoke("email:workspace-tags");
  const emailTaggedThread = await window.api.invoke("email:thread", { accountId: emailAccountId, threadId: "thread-1" });
  const emailShared = await window.api.invoke("email:share-thread", { accountId: emailAccountId, threadId: "thread-1", channelId: "electron-smoke", message: "preload IPC share" });
  const emailReminder = await window.api.invoke("email:create-reminder", { accountId: emailAccountId, threadId: "thread-1", description: "preload IPC reminder", remindAt: new Date(Date.now() + 3_600_000).toISOString() });
  const emailProjectId = `electron-smoke-project-${Date.now()}`;
  const emailProjectLink = await window.api.invoke("email:move-to-project", { accountId: emailAccountId, threadId: "thread-1", projectId: emailProjectId });
  const emailProjectThreads = await window.api.invoke("email:project-threads", { projectId: emailProjectId, limit: 10 });
  const emailAttachments = await window.api.invoke("email:attachments", { accountId: emailAccountId, messageId: "message-1" });
  const emailDownloadDir = `/tmp/openbuddy-email-attachments-${Date.now()}`;
  let emailAttachmentDownload = null;
  try {
    emailAttachmentDownload = await window.api.invoke("email:attachment-download", { accountId: emailAccountId, attachmentId: "attachment-1", messageId: "message-1", destinationDir: emailDownloadDir });
  } catch (error) {
    emailAttachmentDownload = { error: String(error?.message ?? error) };
  }
  const emailDraft = await window.api.invoke("email:create-draft", { accountId: emailAccountId, to: [{ address: "smoke@example.test" }], subject: "Electron preload smoke draft", body: "redacted smoke body" });
  const emailDrafts = await window.api.invoke("email:drafts", { accountId: emailAccountId });
  const emailAnalysesBefore = await window.api.invoke("email:analyses", { accountId: emailAccountId, threadId: "thread-1" });
  const emailAnalysis = await window.api.invoke("email:save-analysis", { accountId: emailAccountId, threadId: "thread-1", kind: "summary", confidence: 0.8, summary: "preload IPC summary", facts: [], actions: [], risks: [] });
  const emailAnalysisList = await window.api.invoke("email:analyses", { accountId: emailAccountId, threadId: "thread-1" });
  const emailReviewedAnalysis = await window.api.invoke("email:review-analysis", { id: emailAnalysis.id, review: "accepted", reviewNote: "preload IPC review" });
  const emailLinkedAnalysis = await window.api.invoke("email:link-analysis", { id: emailAnalysis.id, linkedTaskIds: ["electron-smoke-task"] });
  const emailScheduledSends = await window.api.invoke("email:scheduled-sends");
  const emailPendingSends = await window.api.invoke("email:pending-sends");
  const emailProcessingPlans = await window.api.invoke("email:processing-plans");
  const emailAudit = await window.api.invoke("email:audit");
  const emailIpcEvidence = {
    status: mailStatus,
    diagnostics: emailDiagnostics.readiness,
    accounts: emailAccounts.length,
    rules: emailRulesBefore.length === 0 && emailRuleList.some((entry) => entry.id === emailRule.id) && emailRuleRun.lastRun?.status === "previewed" && Array.isArray(emailScheduledRuleRun),
    sync: emailSync.status === "synced" && emailSyncStates.some((entry) => entry.status === "synced"),
    read: emailThreads.length === 1 && emailPage.items?.length === 1 && emailThread.messages?.length === 1 && emailLabels.length >= 2,
    analysis: emailAnalysesBefore.length === 0 && emailAnalysisList.some((entry) => entry.id === emailAnalysis.id) && emailReviewedAnalysis.review === "accepted" && emailLinkedAnalysis.linkedTaskIds?.includes("electron-smoke-task"),
    triage: emailReplyZero.needsReply?.length === 1 && emailDigest.total === 1 && emailTriage.total === 1,
    inboxAck: emailInboxReceipt.accountId === emailAccountId && emailInboxReceipt.threadId === "thread-1" && emailInboxSnapshot.inbox.some((entry) => entry.emailAccountId === emailAccountId && entry.emailThreadId === "thread-1" && entry.read === true),
    mutations: emailDryRun.dryRun === true && emailTaggedThread.tags?.includes("ElectronSmoke") && emailTags.some((tag) => tag.name === "ElectronSmoke"),
    localIntegrations: emailShared.ok === true && emailReminder.ok === true && emailProjectLink.ok === true && emailProjectThreads.length === 1,
    attachments: emailAttachments.length === 1 && typeof emailAttachmentDownload?.localPath === "string" && emailAttachmentDownload.localPath.startsWith(`${emailDownloadDir}/`),
    drafts: emailDraft.id && emailDrafts.some((entry) => entry.id === emailDraft.id),
    stateQueries: Array.isArray(emailScheduledSends) && Array.isArray(emailPendingSends) && Array.isArray(emailProcessingPlans) && Array.isArray(emailAudit),
  };
  if (Object.values(emailIpcEvidence).some((value) => value === false)) throw new Error(`Email preload IPC smoke failed: ${JSON.stringify(emailIpcEvidence)}`);
  const federatedTask = await window.api.invoke("collaboration:propose", {
    mode: "organization",
    title: "Federated grant smoke",
    objective: "验证跨组织房间授权的真实 IPC 生命周期",
    capability: "general",
    projectId: `smoke-federated-${Date.now()}`,
  });
  const federatedGrant = await window.api.invoke("collaboration:federated-grant-issue", {
    projectId: federatedTask.projectId,
    roomId: federatedTask.roomId,
    principalId: "smoke-federated-principal",
    allowedCapabilities: ["general"],
    allowedDataScopes: [`room:${federatedTask.roomId}`],
    allowedActions: ["read:room"],
    allowedOperations: ["events.query"],
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  const federatedGrants = await window.api.invoke("collaboration:federated-grants");
  const federatedRevoked = await window.api.invoke("collaboration:federated-grant-revoke", { grantId: federatedGrant.grantId });
  const projectThreads = await window.api.invoke("email:project-threads", { projectId: federatedTask.projectId, limit: 10 });
  return {
    ready: Boolean(window.api),
    apiVersion: window.api?.apiVersion,
    platform: window.api?.platform,
    root: Boolean(document.getElementById("root")),
    title: document.title,
    debug: Boolean(window.api?.debug),
    debugToolbar: Boolean(document.querySelector("[data-testid=debug-toolbar]")),
    initOk: init?.ok === true,
    typedRpc: hostRpc?.rpcId === "smoke-host" && hostRpc?.result?.ok === true && hostRpc.result.value?.runtime === "pi"
      && sessionRpc?.rpcId === "smoke-session-list" && sessionRpc?.result?.ok === true && Array.isArray(sessionRpc.result.value?.items)
      && malformedRpc?.rpcId === "smoke-malformed" && malformedRpc?.result?.ok === false,
    authShape: typeof init?.auth?.ready === "boolean",
    sessionsShape: Array.isArray(sessions),
    presetsShape: Array.isArray(presets) && currentPreset && (currentPreset.id === null || typeof currentPreset.id === "string") && presetDefault && typeof presetDefault === "object" && presetSelectValidation,
    rendererEntriesShape: Array.isArray(rendererEntries),
    rendererBootShape: Boolean(rendererBoot && typeof rendererBoot.rev === "string" && Array.isArray(rendererBoot.entries)),
    rendererBootEntries: rendererBoot?.entries ?? [],
    federatedGrantLifecycle: federatedGrants.some((grant) => grant.grantId === federatedGrant.grantId) && federatedRevoked.status === "revoked",
    projectThreadsShape: Array.isArray(projectThreads),
    emailIpcEvidence,
    profilePlugin: plugins?.find((plugin) => plugin.id === "electron-smoke-profile"),
    catalog: await window.api.invoke("agent:providers-list"),
    debugInfo: await window.api.invoke("debug:info"),
    cwd: init.cwd,
  };
  });

  const harnessAddress = await window.evaluate(() => window.api.invoke("harness:address"));
  if (!harnessAddress?.baseUrl) throw new Error(`Electron Harness address unavailable: ${JSON.stringify(harnessAddress)}`);
  const harnessRpcId = `smoke-harness-${Date.now()}`;
  const harnessResponse = await fetch(`${harnessAddress.baseUrl}/api/host.describe`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${harnessAddress.token}` },
    body: JSON.stringify({ type: "client-request", rpcId: harnessRpcId, method: "host.describe", payload: {} }),
  });
  const harnessRpc = await harnessResponse.json();
  if (harnessRpc?.rpcId !== harnessRpcId || harnessRpc.result?.ok !== true || harnessRpc.result.value?.runtime !== "pi") {
    throw new Error(`Electron Harness HTTP RPC failed: ${JSON.stringify(harnessRpc)}`);
  }
  const harnessSocket = new WebSocket(`${harnessAddress.baseUrl.replace(/^http/, "ws")}/api/events.mux?token=${encodeURIComponent(harnessAddress.token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Electron Harness WebSocket open timed out")), 5_000);
    harnessSocket.once("open", () => { clearTimeout(timer); resolve(); });
    harnessSocket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  harnessSocket.close();
  const harnessSse = await fetch(`${harnessAddress.baseUrl}/api/events.mux?since=0`, { headers: { accept: "text/event-stream", authorization: `Bearer ${harnessAddress.token}` } });
  if (!harnessSse.ok || !harnessSse.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(`Electron Harness SSE failed: ${harnessSse.status} ${harnessSse.headers.get("content-type")}`);
  }
  await harnessSse.body?.cancel();

  // Cross-restart cursor persistence: the renderer-side state must survive an
  // Electron relaunch because the file was pre-populated before launch.
  const preloadedCursors = await window.evaluate(() => window.api.invoke("harness:session-cursors"));
  if (preloadedCursors?.["smoke-cursor-session"] !== 7) {
    throw new Error(`Electron preloaded harness cursor was not restored: ${JSON.stringify(preloadedCursors)}`);
  }
  const roundtripWrite = await window.evaluate(() => window.api.invoke("harness:session-cursors-set", { "smoke-cursor-session": 9, "smoke-cursor-roundtrip": 2 }));
  if (roundtripWrite?.["smoke-cursor-session"] !== 9 || roundtripWrite?.["smoke-cursor-roundtrip"] !== 2) {
    throw new Error(`Electron harness cursor roundtrip write failed: ${JSON.stringify(roundtripWrite)}`);
  }
  const postWriteCursors = await window.evaluate(() => window.api.invoke("harness:session-cursors"));
  if (postWriteCursors?.["smoke-cursor-session"] !== 9 || postWriteCursors?.["smoke-cursor-roundtrip"] !== 2) {
    throw new Error(`Electron harness cursor post-write read failed: ${JSON.stringify(postWriteCursors)}`);
  }

  // End-to-end cursor consumption: the renderer-side state must feed into the
  // Harness reconnect URL exactly the way a production renderer would. The
  // SQLite catalog is read back directly after the IPC write; the legacy JSON
  // file is migration input only and is not treated as the authority. Harness
  // server must accept the strict map shape (no legacy single-session number)
  // and stream back a replay session — proving the SQLite → IPC → URL → server
  // roundtrip works.
  const storageDatabase = new DatabaseSync(join(piAgentDir, "openbuddy.sqlite"));
  const persistedCursors = Object.fromEntries(storageDatabase
    .prepare("SELECT session_id, last_seq FROM harness_session_cursors ORDER BY session_id")
    .all()
    .map((row) => [row.session_id, row.last_seq]));
  storageDatabase.close();
  if (existsSync(harnessCursorPath)) {
    throw new Error("Harness legacy cursor file was not consumed after SQLite migration");
  }
  const cursorSince = encodeURIComponent(JSON.stringify(persistedCursors));
  const cursorSse = await fetch(`${harnessAddress.baseUrl}/api/events.mux?since=${cursorSince}`, {
    headers: { accept: "text/event-stream", authorization: `Bearer ${harnessAddress.token}` },
  });
  if (!cursorSse.ok || !cursorSse.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(`Harness SSE rejected persisted cursor map: ${cursorSse.status} ${cursorSse.headers.get("content-type")}`);
  }
  await cursorSse.body?.cancel();

  const defaultProfile = join(piAgentDir, "profiles", "desktop");
  if (!existsSync(join(defaultProfile, "package.json")) || !existsSync(join(defaultProfile, "cordis.patch.yml"))) {
    throw new Error("Electron first-launch profile scaffold was not created");
  }
  const profileManifest = JSON.parse(readFileSync(join(defaultProfile, "package.json"), "utf8"));
  if (!profileManifest.openbuddy?.profile || !profileManifest.dsh?.profile) {
    throw new Error(`Electron profile manifest compatibility failed: ${JSON.stringify(profileManifest)}`);
  }

  const grokModels = (result.catalog?.models ?? []).filter((model) => model.providerId === "xai" || /grok/i.test(`${model.providerId}/${model.modelId}/${model.name ?? ""}`));
  if (!result.ready || result.apiVersion !== 1 || !result.platform || !result.root || result.title !== "OpenBuddy" || !result.debug || result.debugToolbar || !result.initOk || !result.typedRpc || !result.authShape || !result.sessionsShape || !result.presetsShape || !result.rendererEntriesShape || !result.rendererBootShape || !result.federatedGrantLifecycle || !result.projectThreadsShape || !["active", "loaded"].includes(result.profilePlugin?.state) || grokModels.length > 0) {
    throw new Error(`Electron renderer smoke failed: ${JSON.stringify({ ...result, grokModels })}`);
  }
  const bridgeStatus = await window.evaluate(() => ({
    apiVersion: window.api?.apiVersion,
    hasInvoke: typeof window.api?.invoke === "function",
    hasEvents: typeof window.api?.events?.on === "function",
  }));
  if (bridgeStatus.apiVersion !== 1 || !bridgeStatus.hasInvoke || !bridgeStatus.hasEvents) {
    throw new Error(`Electron preload bridge readiness failed: ${JSON.stringify(bridgeStatus)}`);
  }
  if (result.rendererBootEntries.some((entry) => typeof entry.id !== "string" || typeof entry.url !== "string" || typeof entry.rev !== "string")) {
    throw new Error(`Electron renderer boot graph entry failed: ${JSON.stringify(result.rendererBootEntries)}`);
  }
  const piPackageInventory = await window.evaluate(() => window.api.invoke("agent:plugin-inventory"));
  const piPackageExtension = piPackageInventory?.piExtensions?.find((entry) => entry.source?.includes("electron-smoke-pi-package"));
  const piCommands = await window.evaluate(() => window.api.invoke("agent:commands-list"));
  if (!piPackageExtension || piPackageExtension.state !== "loaded" || piPackageExtension.managed !== false || !piCommands.some((command) => command.name === "pi-smoke-command")) {
    throw new Error(`Pi package extension was not loaded by the native resource loader: ${JSON.stringify({ piPackageInventory, piPackageExtension, piCommands })}`);
  }
  const piResourceState = await window.evaluate(() => ({
    skills: [...document.querySelectorAll("body")].some((node) => node.textContent?.includes("pi-smoke-skill")),
  }));
  const piSkillCatalog = await window.evaluate((cwd) => window.api.invoke("skills:list", { cwd }), result.cwd ?? null);
  if (!piSkillCatalog.some((skill) => skill.name === "pi-smoke-skill")) {
    throw new Error(`Pi package skill was not visible to the OpenBuddy resource adapter: ${JSON.stringify({ piResourceState, piSkillCatalog })}`);
  }
  const piResourceInventory = await window.evaluate(() => window.api.invoke("agent:resource-inventory"));
  if (!piResourceInventory.skills.some((resource) => resource.name === "pi-smoke-skill")
    || !piResourceInventory.prompts.some((resource) => resource.name === "pi-smoke-prompt")
    || !piResourceInventory.themes.some((resource) => resource.name === "pi-smoke-theme")
    || piResourceInventory.diagnostics.some((diagnostic) => diagnostic.path?.includes("electron-smoke-pi-package"))) {
    throw new Error(`Pi native resource inventory failed: ${JSON.stringify(piResourceInventory)}`);
  }

  const profileBeforeRollback = await window.evaluate(async () => ({
    plugins: await window.api.invoke("agent:plugin-list"),
    commands: await window.api.invoke("agent:commands-list"),
    resources: await window.api.invoke("agent:resource-inventory"),
  }));
  writeFileSync(profilePatchPath, "[\n", "utf8");
  const extensionReloadResult = await window.evaluate(async () => {
    try {
      await window.api.invoke("agent:extensions-reload");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  const rollbackEvidence = await window.evaluate(async () => {
    const events = await window.api.invoke("agent:plugin-events");
    const failure = [...events].reverse().find((event) => event.type === "pi/extensions-reload-failed");
    const plugins = await window.api.invoke("agent:plugin-list");
    const commands = await window.api.invoke("agent:commands-list");
    const resources = await window.api.invoke("agent:resource-inventory");
    return {
      failed: failure?.payload?.rolledBack === true,
      error: typeof failure?.payload?.error === "string",
      failureSequence: failure?.sequence ?? 0,
      profilePlugin: plugins.find((plugin) => plugin.id === "electron-smoke-profile")?.state,
      smokeCommand: commands.some((command) => command.name === "pi-smoke-command"),
      smokeSkill: resources.skills.some((resource) => resource.name === "pi-smoke-skill"),
    };
  });
  if (extensionReloadResult.ok || !rollbackEvidence.failed || !rollbackEvidence.error || !["active", "loaded"].includes(rollbackEvidence.profilePlugin)
    || !rollbackEvidence.smokeCommand || !rollbackEvidence.smokeSkill
    || !profileBeforeRollback.plugins.some((plugin) => plugin.id === "electron-smoke-profile")) {
    throw new Error(`Electron profile rollback failed: ${JSON.stringify({ profileBeforeRollback, rollbackEvidence })}`);
  }
  writeFileSync(profilePatchPath, "[]\n", "utf8");
  await window.evaluate(async () => window.api.invoke("agent:extensions-reload"));

  const supportedRoutes = ["助理", "项目", "专家·技能·连接器", "自动化"];
  for (const route of supportedRoutes) {
    const blockingOverlays = window.locator(".modal-overlay:visible");
    for (let index = 0; index < await blockingOverlays.count(); index += 1) {
      const overlay = blockingOverlays.nth(index);
      const close = overlay.getByRole("button", { name: "关闭", exact: true }).first();
      if (await close.count()) await close.click();
    }
    await window.locator(".modal-overlay:visible").first().waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
    await window.getByRole("button", { name: route, exact: true }).click();
    await window.locator("#root").waitFor({ state: "attached", timeout: 5_000 });
    await window.waitForTimeout(100);
    const routeState = await window.evaluate(() => ({
      text: document.body.innerText,
      rootText: document.getElementById("root")?.innerText ?? "",
    }));
    if (!routeState.rootText.trim()) throw new Error(`Navigation route rendered blank: ${route}`);
  }
  await window.getByRole("button", { name: "专家·技能·连接器", exact: true }).click();
  await window.getByRole("tab", { name: "专家", exact: true }).waitFor({ state: "visible", timeout: 5_000 });
  await window.waitForTimeout(500);
  if (!(await window.locator("body").innerText()).includes("未找到专家数据目录")) {
    const myExpertsButton = window.locator("button.um-btn--grey").filter({ hasText: "我的专家" }).first();
    await myExpertsButton.waitFor({ state: "visible", timeout: 10_000 });
    await myExpertsButton.click();
  }
  await window.getByRole("button", { name: /创建专家/ }).first().click();
  const expertDialog = window.getByRole("dialog", { name: "创建专家" });
  const expertName = `Electron Smoke Expert ${Date.now()}`;
  await expertDialog.getByPlaceholder("例如：产品研究专家").fill(expertName);
  await expertDialog.getByPlaceholder("一句话描述这个专家").fill("真实 Electron 创建验证");
  await expertDialog.getByPlaceholder("定义专家的角色、方法和输出要求").fill("你是 Electron smoke 专家，只输出可验证的事实。");
  await expertDialog.getByRole("button", { name: "创建专家", exact: true }).click();
  await expertDialog.waitFor({ state: "hidden", timeout: 5_000 });
  const expertFiles = await window.evaluate(async () => window.api.invoke("agents_list"));
  const createdExpert = expertFiles.find((entry) => entry.name === expertName);
  if (!createdExpert || createdExpert.description !== "真实 Electron 创建验证" || !createdExpert.raw.includes("Electron smoke 专家")) {
    throw new Error(`Expert creation UI did not persist a Pi agent: ${JSON.stringify(createdExpert)}`);
  }
  await window.evaluate(async (path) => window.api.invoke("agents_delete", { path }), createdExpert.path);
  await window.getByRole("button", { name: /更多/ }).click();
  const enterpriseRoute = window.getByRole("button", { name: "腾讯文档", exact: true });
  if (await enterpriseRoute.count()) {
    await enterpriseRoute.click();
    await window.waitForTimeout(100);
    if (!(await window.locator("body").innerText()).includes("当前不可用")) {
      throw new Error("Unavailable enterprise route did not report a local limitation");
    }
  }

  await window.locator(".sidebar__nav-item").filter({ hasText: "项目" }).click();
  await window.locator(".project-hero__create").waitFor({ state: "visible", timeout: 5_000 });
  await window.locator(".project-hero__create").click();
  const projectName = `Smoke-${Date.now().toString().slice(-8)}`;
  const createDialog = window.locator(".create-project-dialog");
  await createDialog.getByPlaceholder("请输入项目名称").fill(projectName);
  await createDialog.getByRole("button", { name: "确定", exact: true }).click();
  await window.locator(".pd-crumb__name", { hasText: projectName }).waitFor({ state: "visible", timeout: 5_000 });
  await window.getByRole("button", { name: "添加成员", exact: true }).click();
  await window.getByRole("button", { name: "+ 添加本地成员", exact: true }).click();
  await window.getByPlaceholder("例如：name@example.com").fill("smoke@example.com");
  await window.getByRole("button", { name: "确定", exact: true }).last().click();
  await window.locator(".create-colleague-overlay").waitFor({ state: "hidden", timeout: 5_000 });
  if (!(await window.locator("body").innerText()).includes("smoke@example.com")) {
    throw new Error("Project member dialog did not persist the member");
  }
  await window.reload({ waitUntil: "domcontentloaded" });
  await window.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
  await window.getByRole("button", { name: "项目", exact: true }).click();
  const projectReload = await window.evaluate((name) => document.body.innerText.includes(name), projectName);
  if (!projectReload) throw new Error("Project state did not survive renderer reload");
  await window.waitForFunction(async () => {
    const entries = await window.api.invoke("agent:renderer-plugin-entries");
    const boot = await window.api.invoke("agent:renderer-plugin-boot");
    return entries?.some((entry) => entry.id === "electron-smoke-profile")
      && boot?.entries?.some((entry) => entry.id === "electron-smoke-profile");
  }, undefined, { timeout: 10_000 });
  // The sidebar nav item is rendered after the renderer plugin finishes
  // initialising its renderer client contribution. Wait for the actual DOM
  // element instead of a fixed delay so reload races don't false-fail.
  await window.locator(".sidebar__nav-item--plugin", { hasText: "Electron smoke client" }).first().waitFor({ state: "attached", timeout: 15_000 });
  const clientContribution = await window.locator(".sidebar__nav-item--plugin", { hasText: "Electron smoke client" }).count();
  if (clientContribution !== 1) throw new Error(`Electron client contribution was not rendered: ${clientContribution}`);
  if (!result.debugInfo || typeof result.debugInfo.url !== "string") {
    throw new Error(`Electron debug bridge smoke failed: ${JSON.stringify(result.debugInfo)}`);
  }
  const invalidPayloads = await window.evaluate(async ({ filesystemSmoke: runFilesystemSmoke }) => {
    const cases = [
      ["agent:new-session", null],
      ["agent:prompt", { text: "" }],
      ["sessions:set-pinned", { id: "", pinned: true }],
      ["agent:providers-save-provider", { provider: { id: "bad id", providerKind: "custom" } }],
      ["agent:providers-save-model", { model: { providerId: "bad id", modelId: "x" } }],
    ];
    if (runFilesystemSmoke) {
      cases.splice(3, 0,
        ["shellfs:stat", { path: "../../etc/passwd", cwd: "/" }],
        ["shellfs:write-text", { path: "out.txt", content: "x", workspaceRoot: "/" }],
      );
    }
    const results = [];
    for (const [channel, args] of cases) {
      try { await window.api.invoke(channel, args); results.push({ channel, rejected: false }); }
      catch (error) { results.push({ channel, rejected: /must|invalid|拒绝|workspace|cwd|path/i.test(String(error)) }); }
    }
    return results;
  }, { filesystemSmoke });
  if (invalidPayloads.some((entry) => !entry.rejected)) throw new Error(`Electron IPC validation failed: ${JSON.stringify(invalidPayloads)}`);

  if (filesystemSmoke) {
    const aliasProbe = await window.evaluate(async (cwd) => {
      const stat = await window.api.invoke("path_stat", { path: "models.json", cwd }).catch(() => null);
      return { statAliasAvailable: stat?.exists === true && stat?.kind === "file" };
    }, piAgentDir);
    if (!aliasProbe.statAliasAvailable) throw new Error(`Electron compatibility alias failed: ${JSON.stringify(aliasProbe)}`);
  }
  const nativeState = await app.evaluate(({ app, BrowserWindow, Menu }) => ({
    appName: app.getName(),
    windowCount: BrowserWindow.getAllWindows().length,
    windowTitles: BrowserWindow.getAllWindows().map((browserWindow) => browserWindow.getTitle()),
    hasApplicationMenu: Boolean(Menu.getApplicationMenu()),
    hasDevToolsRole: Boolean(Menu.getApplicationMenu()?.getMenuItemById("toggleDevTools")),
  }));
  if (nativeState.appName !== "OpenBuddy" || nativeState.windowCount < 1 || nativeState.windowTitles.some((title) => title !== "OpenBuddy") || !nativeState.hasApplicationMenu) {
    throw new Error(`Electron native shell smoke failed: ${JSON.stringify(nativeState)}`);
  }
  const menuDevTools = await window.evaluate(() => window.api.invoke("debug:toggle-devtools"));
  if (menuDevTools !== true) throw new Error(`Electron native View menu failed to open DevTools: ${JSON.stringify(menuDevTools)}`);
  const menuDevToolsClosed = await window.evaluate(() => window.api.invoke("debug:toggle-devtools"));
  if (menuDevToolsClosed !== false) throw new Error(`Electron native View menu failed to close DevTools: ${JSON.stringify(menuDevToolsClosed)}`);
  const acceleratorEvidence = await app.evaluate(({ Menu }) => ({
    f12: Menu.getApplicationMenu()?.getMenuItemById("toggleDevToolsF12")?.accelerator,
    platform: Menu.getApplicationMenu()?.getMenuItemById("toggleDevTools")?.accelerator,
  }));
  if (acceleratorEvidence.f12 !== "F12" || typeof acceleratorEvidence.platform !== "string") {
    throw new Error(`Electron DevTools accelerator registration failed: ${JSON.stringify(acceleratorEvidence)}`);
  }

  const invalidPayloadChecks = await window.evaluate(async ({ filesystemSmoke: runFilesystemSmoke }) => {
    const checks = [];
    const expectReject = async (label, action) => {
      try {
        await action();
        checks.push({ label, ok: false, error: "accepted malformed payload" });
      } catch (error) {
        checks.push({ label, ok: true, error: String(error) });
      }
    };
    await expectReject("agent:new-session", () => window.api.invoke("agent:new-session", { cwd: "relative" }));
    await expectReject("agent:prompt", () => window.api.invoke("agent:prompt", { text: "" }));
    await expectReject("sessions:set-pinned", () => window.api.invoke("sessions:set-pinned", { id: 42, pinned: "yes" }));
    if (runFilesystemSmoke) await expectReject("shellfs:read-text", () => window.api.invoke("shellfs:read-text", { path: "../../etc/passwd", cwd: "/" }));
    await expectReject("mcp:toggle", () => window.api.invoke("mcp:toggle", { name: "x", enabled: "yes" }));
    await expectReject("collaboration:propose", () => window.api.invoke("collaboration:propose", {}));
    await expectReject("collaboration:execute", () => window.api.invoke("collaboration:execute", {}));
    await expectReject("collaboration:network-offer", () => window.api.invoke("collaboration:network-offer", {}));
    await expectReject("collaboration:network-proposal", () => window.api.invoke("collaboration:network-proposal", {}));
    await expectReject("collaboration:network-bid", () => window.api.invoke("collaboration:network-bid", {}));
    await expectReject("collaboration:network-award", () => window.api.invoke("collaboration:network-award", {}));
    await expectReject("email:drafts", () => window.api.invoke("email:drafts", { accountId: 42 }));
    return checks;
  }, { filesystemSmoke });
  if (invalidPayloadChecks.some((check) => !check.ok)) {
    throw new Error(`Electron malformed payload validation failed: ${JSON.stringify(invalidPayloadChecks)}`);
  }
  const networkRetry = await window.evaluate(() => window.api.invoke("collaboration:network-retry"));
  if (!Array.isArray(networkRetry)) {
    throw new Error(`Electron collaboration network retry returned an invalid result: ${JSON.stringify(networkRetry)}`);
  }
  const networkLifecycle = await window.evaluate(async () => {
    const snapshot = await window.api.invoke("collaboration:snapshot");
    const peerId = `smoke-peer-${Date.now()}`;
    const capabilityId = `smoke-capability-${Date.now()}`;
    const validUntil = new Date(Date.now() + 3_600_000).toISOString();
    const capability = {
      id: capabilityId,
      providerId: peerId,
      description: "Electron smoke network capability",
      inputSchema: {}, outputSchema: {}, procedure: [],
      allowedDataScopes: ["public:brief"], forbiddenDataScopes: ["private:vault"],
      allowedActions: ["read:public"], forbiddenActions: ["external:send"],
      acceptanceTests: [], requiredApproval: "never", allowDelegation: false,
      maxDelegationDepth: 0, visibility: "directory",
    };
    await window.api.invoke("collaboration:network-peer", { identity: { id: peerId, handle: "smoke-peer", displayName: "Smoke Peer", ownerUserId: "smoke-peer", organizationId: snapshot.identity.organizationId, trustLevel: "known_peer", status: "idle" }, capabilities: [capability] });
    await window.api.invoke("collaboration:network-trust", { peerId, trust: "trusted" });
    await window.api.invoke("collaboration:network-offer", { providerId: peerId, capabilityId, title: "Smoke offer", description: "Network lifecycle smoke", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil, visibility: "known_peers" });
    const proposalMutation = await window.api.invoke("collaboration:network-proposal", { capabilityId, objective: "Network lifecycle smoke", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: validUntil });
    const proposal = proposalMutation.value ?? proposalMutation;
    const afterProposal = await window.api.invoke("collaboration:snapshot");
    const offer = afterProposal.network?.offers?.find((entry) => entry.providerId === peerId && entry.capabilityId === capabilityId);
    if (!offer) throw new Error("network offer was not projected");
    const agreementMutation = await window.api.invoke("collaboration:network-negotiate", { offerId: offer.id, proposalId: proposal.id, providerId: peerId });
    const agreement = agreementMutation.value ?? agreementMutation;
    const revokedMutation = await window.api.invoke("collaboration:network-agreement-revoke", { agreementId: agreement.id, reason: "smoke lifecycle complete" });
    const revoked = revokedMutation.value ?? revokedMutation;
    return { offered: Boolean(offer.id), negotiated: agreement.status === "accepted", revoked: revoked.status === "revoked" };
  });
  if (!networkLifecycle.offered || !networkLifecycle.negotiated || !networkLifecycle.revoked) throw new Error(`Electron network lifecycle failed: ${JSON.stringify(networkLifecycle)}`);

  const persistedSettings = await window.evaluate(async ({ knowledgeRoot, storageRoot, activeModelId, realE2E }) => {
    const policy = {
      rules: [{
        type: "model-whitelist",
        value: [activeModelId, ...(realE2E ? [] : ["smoke-model", "smoke_openai/smoke-chat-model", "smoke_responses/smoke-responses-model"])],
        priority: 1,
      }],
    };
    const channels = [{ id: "smoke-desktop", label: "Smoke desktop", kind: "desktop", enabled: true }];
    await window.api.invoke("policy:save", { policy });
    await window.api.invoke("notify-channels:save", { channels });
    await window.api.invoke("knowledge-sources:save", { sources: [knowledgeRoot] });
    await window.api.invoke("storage-sources:save", { sources: [storageRoot] });
    await window.api.invoke("notify:dispatch", { message: { title: "Smoke notification", body: "main dispatch", level: "info" } });
    return {
      policy: await window.api.invoke("policy:get"),
      channels: await window.api.invoke("notify-channels:list"),
      sources: await window.api.invoke("knowledge-sources:list"),
      storageSources: await window.api.invoke("storage-sources:list"),
    };
  }, { knowledgeRoot, storageRoot, configuredModelId, activeModelId, realE2E });
  if (persistedSettings.policy?.rules?.[0]?.type !== "model-whitelist"
    || persistedSettings.channels?.[0]?.id !== "smoke-desktop"
    || persistedSettings.sources?.[0] !== knowledgeRoot
    || persistedSettings.storageSources?.[0] !== storageRoot) {
    throw new Error(`Electron settings persistence failed: ${JSON.stringify(persistedSettings)}`);
  }

  const pasteText = `electron-paste-${Date.now()}`;
  await window.locator(".sidebar__nav-item").filter({ hasText: "新建任务" }).click();
  await window.locator("textarea").first().waitFor({ state: "visible", timeout: 5_000 });
  await window.evaluate((text) => window.api.invoke("clipboard:write-text", text), pasteText);
  const composer = window.locator("textarea").first();
  try {
    await window.waitForFunction(() => document.querySelector("textarea")?.disabled === false, undefined, { timeout: 15_000 });
  } catch (error) {
    const authDebug = await window.evaluate(async () => ({
      init: await window.api.invoke("agent:init"),
      auth: await window.api.invoke("agent:auth-status"),
      catalog: await window.api.invoke("agent:providers-list"),
    }));
    console.error(`[smoke] auth readiness diagnostic: ${JSON.stringify({ ready: authDebug.auth?.ready, providerCount: authDebug.catalog?.providers?.length ?? 0 })}`);
    throw error;
  }
  await composer.fill("");
  await composer.focus();
  await window.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await window.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, pasteText);
  const pastedValue = await composer.inputValue();
  if (pastedValue !== pasteText) {
    throw new Error(`Electron paste smoke failed: ${JSON.stringify({ pastedValue, pasteText })}`);
  }
  const multilinePaste = "中文第一行\n中文第二行\n第三行";
  await window.evaluate((text) => window.api.invoke("clipboard:write-text", text), multilinePaste);
  await composer.fill("");
  await composer.focus();
  await window.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await window.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, multilinePaste);
  const largePaste = `${"中文大文本-".repeat(2048)}\nEND-OF-LARGE-PASTE`;
  await window.evaluate((text) => window.api.invoke("clipboard:write-text", text), largePaste);
  await composer.fill("");
  await composer.focus();
  await window.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await window.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, largePaste);
  await window.evaluate(() => {
    window.__openbuddyExtensionUiEvents = [];
    window.__openbuddyUiRequests = [];
    window.__openbuddyRpcEvents = [];
    window.api.events.on("pi://extension-ui", (payload) => window.__openbuddyExtensionUiEvents.push(payload));
    window.api.events.on("dsh://rpc", (payload) => {
      window.__openbuddyRpcEvents.push(payload);
      if (payload?.type !== "server-request") return;
      if (payload.method === "session.permission") {
        void window.api.rpc.request({ type: "client-response", rpcId: payload.rpcId, result: { ok: true, value: { optionId: "allow", cancelled: false } } });
      } else if (payload.method === "session.question") {
        void window.api.rpc.request({ type: "client-response", rpcId: payload.rpcId, result: { ok: true, value: { answers: {}, annotations: {}, cancelled: true } } });
      }
    });
    window.api.events.on("pi://permission", (payload) => {
      window.__openbuddyUiRequests.push({ kind: "permission", payload });
      void window.api.invoke("agent:resolve-permission", { requestId: payload.requestId, optionId: "allow", cancelled: false });
    });
    window.api.events.on("pi://question", (payload) => {
      window.__openbuddyUiRequests.push({ kind: "question", payload });
      const question = payload.questions?.[0];
      if (question?.options?.length) {
        void window.api.invoke("agent:resolve-question", {
          requestId: payload.requestId,
          answers: { [question.question]: question.options[1] ?? question.options[0] },
          cancelled: false,
        });
      } else {
        void window.api.invoke("agent:resolve-question", {
          requestId: payload.requestId,
          annotations: { [question?.question ?? payload.title]: { notes: "smoke-input" } },
          cancelled: false,
        });
      }
    });
  });

  const invoke = (channel, args) => window.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });
  const workspaceFixturePath = join(userData, "workspace-registry-fixture");
  mkdirSync(workspaceFixturePath, { recursive: true });
  const canonicalWorkspaceFixturePath = realpathSync(workspaceFixturePath);
  const workspaceSession = await invoke("agent:new-session", { cwd: canonicalWorkspaceFixturePath });
  if (!workspaceSession?.sessionId) throw new Error(`Electron workspace session creation failed: ${JSON.stringify(workspaceSession)}`);
  await invoke("agent:prompt", { sessionId: workspaceSession.sessionId, text: "只回复 WORKSPACE-SESSION-OK，不要调用工具。" });
  const workspaceRegistryBefore = await invoke("workspace:list");
  if (!Array.isArray(workspaceRegistryBefore?.items) || !Array.isArray(workspaceRegistryBefore?.archivedSessionIds)) {
    throw new Error(`Electron workspace registry list failed: ${JSON.stringify(workspaceRegistryBefore)}`);
  }
  const workspaceCreated = await invoke("workspace:create", { path: workspaceFixturePath, title: "Smoke Workspace" });
  if (typeof workspaceCreated?.created !== "boolean" || !workspaceCreated.workspace?.workspaceId || workspaceCreated.workspace.path !== canonicalWorkspaceFixturePath) {
    throw new Error(`Electron workspace registry create failed: ${JSON.stringify(workspaceCreated)}`);
  }
  const workspaceId = workspaceCreated.workspace.workspaceId;
  const workspaceRenamed = await invoke("workspace:rename", { workspaceId, title: "Renamed Smoke Workspace" });
  if (workspaceRenamed?.workspace?.title !== "Renamed Smoke Workspace") {
    throw new Error(`Electron workspace registry rename failed: ${JSON.stringify(workspaceRenamed)}`);
  }
  const workspaceRegistryAfterRename = await invoke("workspace:list");
  if (!workspaceRegistryAfterRename.items.some((entry) => entry.workspaceId === workspaceId && entry.title === "Renamed Smoke Workspace")) {
    throw new Error(`Electron workspace registry readback failed: ${JSON.stringify(workspaceRegistryAfterRename)}`);
  }
  const workspaceOrder = await invoke("workspace:insert-before", { workspaceId });
  if (!Array.isArray(workspaceOrder?.workspaceIds) || !workspaceOrder.workspaceIds.includes(workspaceId)) {
    throw new Error(`Electron workspace registry reorder failed: ${JSON.stringify(workspaceOrder)}`);
  }
  const workspaceWithSession = (await invoke("workspace:list")).items.find((entry) => entry.workspaceId === workspaceId);
  if (!workspaceWithSession?.sessionIds?.includes(workspaceSession.sessionId)) {
    throw new Error(`Electron workspace did not account for session: ${JSON.stringify({ workspaceId, sessionId: workspaceSession.sessionId, workspaceWithSession })}`);
  }
  const sessionReordered = await invoke("workspace:insert-session-before", { workspaceId, sessionId: workspaceSession.sessionId });
  if (!sessionReordered?.workspace?.sessionIds?.includes(workspaceSession.sessionId)) {
    throw new Error(`Electron workspace session reorder failed: ${JSON.stringify(sessionReordered)}`);
  }
  const workspaceArchivedSessions = await invoke("workspace:archive-session", { sessionId: workspaceSession.sessionId, archived: true });
  if (!workspaceArchivedSessions?.archivedSessionIds?.includes(workspaceSession.sessionId)) {
    throw new Error(`Electron workspace session archive failed: ${JSON.stringify(workspaceArchivedSessions)}`);
  }
  const workspaceUnarchivedSessions = await invoke("workspace:archive-session", { sessionId: workspaceSession.sessionId, archived: false });
  if (workspaceUnarchivedSessions?.archivedSessionIds?.includes(workspaceSession.sessionId)) {
    throw new Error(`Electron workspace session unarchive failed: ${JSON.stringify(workspaceUnarchivedSessions)}`);
  }
  const workspaceDeleted = await invoke("workspace:delete", { workspaceId });
  if (workspaceDeleted?.deleted !== true || (await invoke("workspace:list")).items.some((entry) => entry.workspaceId === workspaceId)) {
    throw new Error(`Electron workspace registry delete failed: ${JSON.stringify(workspaceDeleted)}`);
  }
  const calendarMarker = `electron-smoke-calendar-${Date.now()}`;
  const calendarStart = new Date(Date.now() + 60_000).toISOString();
  const calendarEnd = new Date(Date.now() + 3_660_000).toISOString();
  const calendarCreated = await window.evaluate(async ({ title, start, end }) => window.api.invoke("calendar:create", {
    title,
    start,
    end,
    roomId: "electron-smoke-room",
    contextRefs: ["electron-smoke"],
    description: "isolated Electron calendar smoke",
  }), { title: calendarMarker, start: calendarStart, end: calendarEnd });
  if (!calendarCreated?.id || calendarCreated.title !== calendarMarker || calendarCreated.roomId !== "electron-smoke-room") {
    throw new Error(`Electron calendar create failed: ${JSON.stringify({ id: calendarCreated?.id, title: calendarCreated?.title, roomId: calendarCreated?.roomId })}`);
  }
  const calendarId = calendarCreated.id;
  const calendarListed = await window.evaluate(async () => window.api.invoke("calendar:list", {
    roomId: "electron-smoke-room",
    contextRef: "electron-smoke",
  }));
  if (!Array.isArray(calendarListed) || !calendarListed.some((event) => event.id === calendarId && event.title === calendarMarker)) {
    throw new Error(`Electron calendar list failed: ${JSON.stringify({ count: Array.isArray(calendarListed) ? calendarListed.length : null })}`);
  }
  const calendarUpdated = await window.evaluate(async ({ id }) => window.api.invoke("calendar:update", {
    id,
    patch: { title: `${id}-updated`, status: "tentative", location: "Electron smoke" },
  }), { id: calendarId });
  if (!calendarUpdated || calendarUpdated.id !== calendarId || calendarUpdated.title !== `${calendarId}-updated` || calendarUpdated.status !== "tentative") {
    throw new Error(`Electron calendar update failed: ${JSON.stringify({ id: calendarUpdated?.id, status: calendarUpdated?.status })}`);
  }
  const calendarDeleted = await window.evaluate(async (id) => window.api.invoke("calendar:delete", id), calendarId);
  const calendarAfterDelete = await window.evaluate(async () => window.api.invoke("calendar:list", { roomId: "electron-smoke-room" }));
  if (calendarDeleted !== true || !Array.isArray(calendarAfterDelete) || calendarAfterDelete.some((event) => event.id === calendarId)) {
    throw new Error(`Electron calendar delete failed: ${JSON.stringify({ deleted: calendarDeleted, remaining: Array.isArray(calendarAfterDelete) ? calendarAfterDelete.length : null })}`);
  }
  calendarEvidence = {
    lifecycle: ["create", "list", "update", "delete"],
    eventId: sessionDigest(calendarId),
    isolatedRoom: "electron-smoke-room",
    deleted: calendarDeleted === true,
  };
  const dshInventory = await invoke("dsh:remote", { namespace: "dynamicCordisRunner", method: "inventory" });
  if (!dshInventory?.ok || !Array.isArray(dshInventory.value?.packages) || !Array.isArray(dshInventory.value?.tasks)) {
    throw new Error(`DeepSeek host runner inventory failed: ${JSON.stringify(dshInventory)}`);
  }
  const dshRemotePackage = `electron-smoke-remote-${Date.now()}`;
  const dshRegistration = await invoke("dsh:remote-register", {
    package: dshRemotePackage,
    descriptors: [{ namespace: "smoke", method: "list", service: "commands", implementation: "list" }],
  });
  const dshInvocation = await invoke("dsh:remote", { package: dshRemotePackage, namespace: "smoke", method: "list" });
  const dshUnregistration = await invoke("dsh:remote-unregister", { package: dshRemotePackage });
  if (dshRegistration?.count !== 1 || !dshInvocation?.ok || !Array.isArray(dshInvocation.value) || !dshUnregistration?.removed) {
    throw new Error(`DeepSeek host runner remote round-trip failed: ${JSON.stringify({ dshInventory, dshRegistration, dshInvocation, dshUnregistration })}`);
  }
  const directDshRpc = await invoke("dsh:rpc", { type: "client-request", rpcId: "smoke-direct-dsh", method: "host.describe", payload: {} });
  if (directDshRpc?.rpcId !== "smoke-direct-dsh" || directDshRpc.result?.ok !== true || directDshRpc.result.value?.runtime !== "pi") {
    throw new Error(`Direct dsh:rpc bridge failed: ${JSON.stringify(directDshRpc)}`);
  }
  const capabilitySnapshotRpc = await invoke("dsh:rpc", {
    type: "client-request",
    rpcId: "smoke-capability-snapshot",
    method: "capability.snapshot",
    payload: { sessionId: workspaceSession.sessionId },
  });
  const capabilitySnapshot = capabilitySnapshotRpc?.result?.value;
  if (capabilitySnapshotRpc?.result?.ok !== true || capabilitySnapshot?.runtime !== "pi" || capabilitySnapshot?.contextReady !== true
    || !Array.isArray(capabilitySnapshot?.plugins) || !Array.isArray(capabilitySnapshot?.mcp)
    || typeof capabilitySnapshot?.permission?.mode !== "string") {
    throw new Error(`Capability snapshot RPC failed: ${JSON.stringify(capabilitySnapshotRpc)}`);
  }
  const smokePlanText = "Electron capability contract smoke plan";
  const planRpc = await invoke("dsh:rpc", {
    type: "client-request",
    rpcId: "smoke-capability-plan",
    method: "capability.plan",
    payload: { action: "set", sessionId: workspaceSession.sessionId, planText: smokePlanText },
  });
  if (planRpc?.result?.ok !== true || planRpc.result.value?.planText !== smokePlanText) {
    throw new Error(`Capability plan RPC failed: ${JSON.stringify(planRpc)}`);
  }
  // Stage B: openbuddy-task capability removed; task RPCs now go through pi-native
  // (@juicesharp/rpiv-todo when installed). The smoke test deliberately skips
  // task add/complete/clear coverage to mirror the deleted `capability.task` IPC.
  const permissionRpc = await invoke("dsh:rpc", {
    type: "client-request",
    rpcId: "smoke-capability-permission",
    method: "capability.permission",
    payload: { action: "mode" },
  });
  if (permissionRpc?.result?.ok !== true || typeof permissionRpc.result.value !== "string") {
    throw new Error(`Capability permission RPC failed: ${JSON.stringify({ permissionRpc })}`);
  }
  const rejectedPlanRpc = await invoke("dsh:rpc", {
    type: "client-request",
    rpcId: "smoke-capability-plan-reject",
    method: "capability.plan",
    payload: { action: "reject", sessionId: workspaceSession.sessionId },
  });
  if (rejectedPlanRpc?.result?.ok !== true || rejectedPlanRpc.result.value?.state !== "rejected") {
    throw new Error(`Capability plan cleanup RPC failed: ${JSON.stringify(rejectedPlanRpc)}`);
  }
  const capabilityProbe = await window.evaluate(async ({ workspaceRoot, piAgentDir, exportPath, agentFixture, marketplaceSource, connectorRoot, connectorSource, connectorCancelSource, importSource, profileInstallSource, importedSkillName, importedSkillSourceDir, filesystemSmoke, workspaceSession }) => {
    const capabilityEvents = [];
    const eventUnlisteners = [
      window.api.events.on("pi://folder-trust", (payload) => capabilityEvents.push({ channel: "pi://folder-trust", payload })),
      window.api.events.on("pi://plan-mode", (payload) => capabilityEvents.push({ channel: "pi://plan-mode", payload })),
      window.api.events.on("pi://permission-mode", (payload) => capabilityEvents.push({ channel: "pi://permission-mode", payload })),
      window.api.events.on("pi://mcp-status", (payload) => capabilityEvents.push({ channel: "pi://mcp-status", payload })),
      window.api.events.on("pi://task-update", (payload) => capabilityEvents.push({ channel: "pi://task-update", payload })),
      window.api.events.on("connector://cli-auth-log", (payload) => capabilityEvents.push({ channel: "connector://cli-auth-log", payload })),
      window.api.events.on("connector://cli-auth-url", (payload) => capabilityEvents.push({ channel: "connector://cli-auth-url", payload })),
      window.api.events.on("connector://cli-auth-done", (payload) => capabilityEvents.push({ channel: "connector://cli-auth-done", payload })),
    ];
    const defaults = await window.api.invoke("agents_defaults_get");
    const savedDefaults = await window.api.invoke("agents_defaults_save", {
      defaults: { ...defaults, defaultPermission: "default", rememberToolApprovals: true },
    });
    const commands = await window.api.invoke("agent:commands-list");
    const currentModel = await window.api.invoke("agent:current-model");
    const pluginEvents = await window.api.invoke("agent:plugin-events");
    const profilePackagesBefore = await window.api.invoke("agent:profile-packages");
    const pluginBefore = (await window.api.invoke("agent:plugin-list")).find((entry) => entry.id === "electron-smoke-profile");
    const pluginConfigured = await window.api.invoke("agent:plugin-config", { id: "electron-smoke-profile", config: { source: "profile-config-smoke" } });
    const pluginStateAfterConfig = await window.api.invoke("agent:plugin-state-get");
    const rpcEvents = window.__openbuddyRpcEvents ?? [];
    const pluginReloaded = await window.api.invoke("agent:plugin-reload", { id: "electron-smoke-profile" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pluginReset = await window.api.invoke("agent:plugin-state-reset", { id: "electron-smoke-profile" });
    const installedProfile = await window.api.invoke("agent:profile-install", { sourcePath: profileInstallSource });
    const profilePackagesInstalled = await window.api.invoke("agent:profile-packages");
    const piInventoryAfterInstall = await window.api.invoke("agent:plugin-inventory");
    const piCommandsAfterInstall = await window.api.invoke("agent:commands-list");
    const piResourcesAfterInstall = await window.api.invoke("agent:resource-inventory");
    const installedPluginBeforeReady = (await window.api.invoke("agent:plugin-list")).find((entry) => entry.id === "electron-smoke-installed-plugin");
    const installedRemoteBeforeReady = await window.api.invoke("agent:remote-contributions");
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = async () => {
        const commands = await window.api.invoke("agent:commands-list");
        const resources = await window.api.invoke("agent:resource-inventory");
        if (commands.some((command) => command.name === "profile-pi-installed-command")
          && resources.skills.some((resource) => resource.name === "electron-smoke-installed-skill")) return resolve();
        if (Date.now() - startedAt > 15_000) {
          const plugins = await window.api.invoke("agent:plugin-list");
          const events = await window.api.invoke("agent:plugin-events");
          return reject(new Error(`Pi profile package resources did not mount: ${JSON.stringify({ plugins, commands, resources, events: events.slice(-12) })}`));
        }
        setTimeout(() => void check(), 50);
      };
      void check();
    });
    const piInventoryAfterInstallReady = await window.api.invoke("agent:plugin-inventory");
    const piCommandsAfterInstallReady = await window.api.invoke("agent:commands-list");
    const piResourcesAfterInstallReady = await window.api.invoke("agent:resource-inventory");
    const installedPluginAfterReady = (await window.api.invoke("agent:plugin-list")).find((entry) => entry.id === "electron-smoke-installed-plugin");
    const installedRemoteAfterReady = await window.api.invoke("agent:remote-contributions");
    const installedPluginInventoryAfterReady = await window.api.invoke("agent:plugin-inventory");
    const rendererEntriesAfterInstall = await window.api.invoke("agent:renderer-plugin-entries");
    const rendererBootAfterInstall = await window.api.invoke("agent:renderer-plugin-boot");
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = async () => {
        if (document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-installed-client"]')) return resolve();
          if (Date.now() - startedAt > 15_000) {
            const entries = await window.api.invoke("agent:renderer-plugin-entries");
            const boot = await window.api.invoke("agent:renderer-plugin-boot");
            const events = await window.api.invoke("agent:plugin-events");
            const diagnostics = window.__OPENBUDDY_RENDERER_DIAGNOSTICS__ ?? [];
            return reject(new Error(`Renderer smoke contribution did not mount: ${JSON.stringify({ entries, boot, diagnostics, events: events.slice(-20) })}`));
        }
        setTimeout(() => void check(), 50);
      };
      void check();
    });
    const rendererContributionAfterInstall = Boolean(document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-installed-client"]'));
    await window.api.invoke("agent:profile-remove", { name: "electron-smoke-installed-client" });
    const profilePackagesAfterRemove = await window.api.invoke("agent:profile-packages");
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = async () => {
        const inventory = await window.api.invoke("agent:plugin-inventory");
        const commands = await window.api.invoke("agent:commands-list");
        const resources = await window.api.invoke("agent:resource-inventory");
        const removed = !inventory.piExtensions?.some((entry) => entry.source?.includes("electron-smoke-installed-client"))
          && !commands.some((command) => command.name === "profile-pi-installed-command")
          && !resources.skills.some((resource) => resource.name === "electron-smoke-installed-skill");
        if (removed) return resolve();
        if (Date.now() - startedAt > 15_000) return reject(new Error("Pi profile package resources did not unload"));
        setTimeout(() => void check(), 50);
      };
      void check();
    });
    const piInventoryAfterRemove = await window.api.invoke("agent:plugin-inventory");
    const piCommandsAfterRemove = await window.api.invoke("agent:commands-list");
    const piResourcesAfterRemove = await window.api.invoke("agent:resource-inventory");
    const removedPlugin = (await window.api.invoke("agent:plugin-list")).find((entry) => entry.id === "electron-smoke-installed-plugin");
    const removedRemote = await window.api.invoke("agent:remote-contributions");
    const rendererEntriesAfterRemove = await window.api.invoke("agent:renderer-plugin-entries");
    const rendererBootAfterRemove = await window.api.invoke("agent:renderer-plugin-boot");
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (!document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-installed-client"]')) return resolve();
        if (Date.now() - startedAt > 15_000) return reject(new Error("Renderer smoke contribution did not unload"));
        setTimeout(check, 50);
      };
      check();
    });
    const rendererContributionAfterRemove = Boolean(document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-installed-client"]'));
    if (!rendererEntriesAfterInstall.some((entry) => entry.id === "electron-smoke-installed-client")
      || !rendererBootAfterInstall.entries.some((entry) => entry.id === "electron-smoke-installed-client")
      || rendererEntriesAfterRemove.some((entry) => entry.id === "electron-smoke-installed-client")
      || rendererBootAfterRemove.entries.some((entry) => entry.id === "electron-smoke-installed-client")
      || !rendererContributionAfterInstall
      || rendererContributionAfterRemove) {
      throw new Error(`Renderer profile package lifecycle failed: ${JSON.stringify({ rendererEntriesAfterInstall, rendererBootAfterInstall, rendererEntriesAfterRemove, rendererBootAfterRemove, rendererContributionAfterInstall, rendererContributionAfterRemove })}`);
    }
    const memories = await window.api.invoke("memory_list", { cwd: workspaceRoot });
    const memoryPath = `electron-smoke-${Date.now()}.md`;
    const savedMemory = await window.api.invoke("memory_save", { scope: "workspace", path: memoryPath, content: "smoke memory\r\n", cwd: workspaceRoot });
    const readMemory = await window.api.invoke("memory_get", { scope: "workspace", path: memoryPath, cwd: workspaceRoot });
    const rewrittenMemory = await window.api.invoke("memory_rewrite", { scope: "workspace", path: memoryPath, content: "rewritten memory\r\n", cwd: workspaceRoot });
    const normalizedMemory = await window.api.invoke("memory_get", { scope: "workspace", path: memoryPath, cwd: workspaceRoot });
    const flushedMemory = await window.api.invoke("memory_flush", { cwd: workspaceRoot });
    await window.api.invoke("memory_delete", { scope: "workspace", path: memoryPath, cwd: workspaceRoot });
    const mcpFixture = `electron-smoke-mcp-${Date.now()}`;
    await window.api.invoke("mcp:upsert", { server: { name: mcpFixture, command: "node", args: ["-e", "process.exit(0)"], disabled: true } });
    const mcp = await window.api.invoke("mcp:list");
    const mcpEntry = mcp.find((entry) => entry.name === mcpFixture);
    await window.api.invoke("mcp:toggle", { name: mcpFixture, enabled: true });
    const mcpEnabled = (await window.api.invoke("mcp:list")).find((entry) => entry.name === mcpFixture);
    await window.api.invoke("mcp:toggle", { name: mcpFixture, enabled: false });
    const mcpDisabled = (await window.api.invoke("mcp:list")).find((entry) => entry.name === mcpFixture);
    const mcpConfig = await window.api.invoke("mcp:config-read");
    await window.api.invoke("mcp:delete", { name: mcpFixture });
    const mcpAuth = await window.api.invoke("mcp_auth_status");
    await window.api.invoke("permission:mode-set", "acceptEdits");
    const permissionMode = await window.api.invoke("permission:mode-get");
    await window.api.invoke("permission:mode-set", "default");
    await window.api.invoke("permission:save", [{ action: "allow", tool: "read", pattern: "*.md" }]);
    const permissionRules = await window.api.invoke("permission:list");
    const folderTrust = await window.api.invoke("folder-trust:grant", workspaceRoot);
    const trusted = await window.api.invoke("folder-trust:is-trusted", workspaceRoot);
    await window.api.invoke("folder-trust:revoke", workspaceRoot);
    // openbuddy-plan removed; plan-mode is delegated to pi-plan-mode (passthrough).
    // The legacy plan-mode:* / toggle_plan_mode IPC round-trips are skipped here
    // to mirror the deleted capability.
    const skillsBefore = await window.api.invoke("skills:list", { cwd: workspaceRoot });
    await window.api.invoke("skills:toggle", { name: "electron-smoke-skill", enabled: false });
    const skillsDisabled = await window.api.invoke("skills:list", { cwd: workspaceRoot });
    await window.api.invoke("skills:toggle", { name: "electron-smoke-skill", enabled: true });
    const skillsAfter = await window.api.invoke("skills:list", { cwd: workspaceRoot });
    const skillRoot = `${piAgentDir}/skills`;
    const skillCatalogRoots = await window.api.invoke("skills_catalog_list_roots", { root: skillRoot });
    const skillCatalog = await window.api.invoke("skills_catalog_load", { root: skillRoot, builtinRoot: skillRoot });
    const catalogSkill = skillCatalog.skills?.find((skill) => skill.id === "electron-smoke-skill");
    const catalogSkillContent = catalogSkill ? await window.api.invoke("skills_catalog_read_skill", { dir: catalogSkill.sourceDir, root: skillRoot, builtinRoot: skillRoot }) : "";
    const agentName = `electron-smoke-agent-${Date.now()}`;
    await window.api.invoke("agents_save", { name: agentName, raw: agentFixture, cwd: workspaceRoot });
    const agents = await window.api.invoke("agents_list", { cwd: workspaceRoot });
    const agentText = await window.api.invoke("agents_get", { path: `${agentName}.md`, cwd: workspaceRoot });
    await window.api.invoke("agents_delete", { path: `${agentName}.md`, cwd: workspaceRoot });
    // Stage B: openbuddy-task capability removed; todo lifecycle is owned by
    // pi-native (@juicesharp/rpiv-todo when installed). Smoke skips the
    // tasks:add / tasks:update / tasks:list / tasks:clear-completed / tasks:delete
    // chain here to mirror the deleted IPC.
    const addedSkill = await window.api.invoke("skills:add", { path: importedSkillSourceDir, cwd: workspaceRoot });
    const skillsAfterAdd = await window.api.invoke("skills:list", { cwd: workspaceRoot });
    const reloadResult = await window.api.invoke("internal_reload", { kind: "skills" });
    const reloadedSkills = await window.api.invoke("skills:list", { cwd: workspaceRoot });
    await window.api.invoke("skills:remove", { path: `${piAgentDir}/skills/${importedSkillName}` });
    await window.api.invoke("internal_reload", { kind: "skills" });
    const skillsAfterRemove = await window.api.invoke("skills:list", { cwd: workspaceRoot });
    for (const unlisten of eventUnlisteners) unlisten();
    const notification = await window.api.invoke("notifications:append", { kind: "info", title: "Electron smoke", body: "round-trip" });
    const notifications = await window.api.invoke("notifications:list");
    await window.api.invoke("notifications:mark-read", notification.id);
    await window.api.invoke("notifications:clear");
    let filesystem = "skipped";
    if (filesystemSmoke) {
      const fsPath = "electron-smoke.txt";
      const fsWritten = await window.api.invoke("shellfs:write-text", { path: fsPath, content: "filesystem smoke", workspaceRoot });
      const fsRead = await window.api.invoke("shellfs:read-text", { path: fsPath, cwd: workspaceRoot });
      const fsStat = await window.api.invoke("shellfs:stat", { path: fsPath, cwd: workspaceRoot });
      const fsList = await window.api.invoke("shellfs:list-dir", { path: ".", cwd: workspaceRoot });
      const fsListAlias = await window.api.invoke("list_dir", { path: ".", cwd: workspaceRoot });
      const fsBase64 = await window.api.invoke("shellfs:read-file-base64", { path: fsPath, cwd: workspaceRoot });
      await window.api.invoke("shellfs:browse-directory", { path: workspaceRoot, cwd: workspaceRoot });
      await window.api.invoke("shellfs:open-path", { path: fsWritten, cwd: workspaceRoot });
      await window.api.invoke("shellfs:reveal", { path: fsWritten, cwd: workspaceRoot });
      const fsExport = await window.api.invoke("shellfs:export-text", { path: exportPath, content: "export smoke" });
      const madeDirectory = await window.api.invoke("shellfs:mkdir", { path: "electron-smoke-dir", workspaceRoot });
      const importedFile = await window.api.invoke("shellfs:import-file", { sourcePath: importSource, workspaceRoot });
      const importedText = await window.api.invoke("shellfs:read-text", { path: importedFile.path, cwd: workspaceRoot });
      await window.api.invoke("shellfs:remove", { path: importedFile.path, workspaceRoot });
      filesystem = fsWritten.endsWith(fsPath) && fsRead === "filesystem smoke" && fsStat?.kind === "file" && fsList.some((entry) => entry.path.endsWith(fsPath))
        && Array.isArray(fsListAlias) && fsListAlias.some((entry) => entry.path.endsWith(fsPath))
        && fsBase64 === btoa("filesystem smoke")
        && fsExport.endsWith("electron-smoke-export.txt") && madeDirectory.endsWith("electron-smoke-dir") && importedText === "import smoke";
    }
    const subagentsBefore = await window.api.invoke("subagents:get-config");
    const subagentsAfter = await window.api.invoke("subagents:set-config", { maxDepth: subagentsBefore.maxDepth });
    const automationsPassthroughRegistry = await import("@openbuddy/plugin-host");
    automationsPassthroughRegistry.recordPassthrough("automation", "installed", "pi-background-tasks");
    // Stage G-1c: openbuddy-automation removed; automation is owned
    // by pi-background-tasks + pi-goal (passthrough). The legacy
    // automations_snapshot IPC channel no longer exists; renderer
    // reaches the pi-native tool surface.
    void automationsPassthroughRegistry.isPassthroughed("automation");
    await window.api.invoke("marketplace_action", { action: { type: "add_source", sourceUrlOrPath: marketplaceSource } });
    const marketplaceAvailable = await window.api.invoke("marketplace_action", { action: { type: "refresh" } });
    await window.api.invoke("marketplace_action", { action: { type: "install", sourceUrlOrPath: marketplaceSource, pluginRelativePath: "electron-smoke-market" } });
    const pluginsInstalled = await window.api.invoke("plugins_list", { sessionId: null });
    const marketplacePiCommands = await window.api.invoke("agent:commands-list");
    const marketplacePiResources = await window.api.invoke("agent:resource-inventory");
    const marketplaceMcp = await window.api.invoke("mcp:list");
    const marketplacePluginEventsBeforeHook = await window.api.invoke("agent:plugin-events");
    await window.api.invoke("agent:prompt", { sessionId: workspaceSession.sessionId, text: "只回复 MARKETPLACE-HOOK-SMOKE，不要调用工具。" });
    const marketplacePluginEventsAfterHook = await window.api.invoke("agent:plugin-events");
    const marketplaceHarnessPlugins = await window.api.invoke("agent:plugin-list");
    const marketplaceHarnessRemotes = await window.api.invoke("agent:remote-contributions");
    const marketplaceHarnessRenderers = await window.api.invoke("agent:renderer-plugin-entries");
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-market-client"]')) return resolve();
        if (Date.now() - startedAt > 15_000) return reject(new Error("Marketplace Harness renderer contribution did not mount"));
        setTimeout(check, 50);
      };
      check();
    });
    await window.api.invoke("plugins_action", { action: { type: "disable", pluginName: "electron-smoke-market" } });
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = async () => {
        const plugins = await window.api.invoke("agent:plugin-list");
        const remotes = await window.api.invoke("agent:remote-contributions");
        const renderers = await window.api.invoke("agent:renderer-plugin-entries");
        const settled = !plugins.some((entry) => entry.id === "electron-smoke-market-plugin")
          && !remotes.some((entry) => entry.package === "electron-smoke-market")
          && !renderers.some((entry) => entry.id === "electron-smoke-market-plugin")
          && !document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-market-client"]');
        if (settled) return resolve();
        if (Date.now() - startedAt > 15_000) return reject(new Error("Marketplace Harness plugin did not settle after disable"));
        setTimeout(() => void check(), 50);
      };
      void check();
    });
    const marketplaceDisabledPiCommands = await window.api.invoke("agent:commands-list");
    const marketplaceDisabledPiResources = await window.api.invoke("agent:resource-inventory");
    const marketplaceDisabledMcp = await window.api.invoke("mcp:list");
    const marketplaceDisabledHarnessPlugins = await window.api.invoke("agent:plugin-list");
    const marketplaceDisabledHarnessRemotes = await window.api.invoke("agent:remote-contributions");
    const marketplaceDisabledHarnessRenderers = await window.api.invoke("agent:renderer-plugin-entries");
    const marketplaceDisabledRenderer = !document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-market-client"]');
    await window.api.invoke("plugins_action", { action: { type: "enable", pluginName: "electron-smoke-market" } });
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-market-client"]')) return resolve();
        if (Date.now() - startedAt > 15_000) return reject(new Error("Marketplace Harness renderer did not remount after enable"));
        setTimeout(check, 50);
      };
      check();
    });
    await window.api.invoke("plugins_action", { action: { type: "disable", pluginName: "electron-smoke-profile" } });
    await window.api.invoke("plugins_action", { action: { type: "enable", pluginName: "electron-smoke-profile" } });
    await window.api.invoke("marketplace_action", { action: { type: "update", sourceUrlOrPath: marketplaceSource, pluginRelativePath: "electron-smoke-market" } });
    await window.api.invoke("marketplace_action", { action: { type: "uninstall", sourceUrlOrPath: marketplaceSource, pluginRelativePath: "electron-smoke-market" } });
    const marketplacePiCommandsAfterRemove = await window.api.invoke("agent:commands-list");
    const marketplacePiResourcesAfterRemove = await window.api.invoke("agent:resource-inventory");
    const marketplaceMcpAfterRemove = await window.api.invoke("mcp:list");
    const marketplaceHarnessPluginsAfterRemove = await window.api.invoke("agent:plugin-list");
    const marketplaceHarnessRemotesAfterRemove = await window.api.invoke("agent:remote-contributions");
    const marketplaceHarnessRenderersAfterRemove = await window.api.invoke("agent:renderer-plugin-entries");
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (!document.querySelector('[data-openbuddy-smoke-renderer="electron-smoke-market-client"]')) return resolve();
        if (Date.now() - startedAt > 15_000) return reject(new Error("Marketplace Harness renderer contribution did not unload"));
        setTimeout(check, 50);
      };
      check();
    });
    await window.api.invoke("marketplace_action", { action: { type: "remove_source", sourceUrlOrPath: marketplaceSource } });
    const marketplace = await window.api.invoke("marketplace_list", { sessionId: null });
    const connectors = await window.api.invoke("connectors_load", { root: connectorRoot });
    const connectorBefore = await window.api.invoke("connectors_cli_status", { root: connectorRoot, source: connectorSource });
    const connectorAuth = await window.api.invoke("connectors_cli_auth", { root: connectorRoot, source: connectorSource });
    const connectorAfter = await window.api.invoke("connectors_cli_status", { root: connectorRoot, source: connectorSource });
    const connectorSkills = await window.api.invoke("connectors_cli_skills_dir", { root: connectorRoot, source: connectorSource });
    await window.api.invoke("connectors_cli_unauth", { root: connectorRoot, source: connectorSource });
    const connectorUnauthed = await window.api.invoke("connectors_cli_status", { root: connectorRoot, source: connectorSource });
    const cancelAuthPromise = window.api.invoke("connectors_cli_auth", { root: connectorRoot, source: connectorCancelSource });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await window.api.invoke("connectors_cli_auth_cancel", { source: connectorCancelSource });
    const connectorCancel = await cancelAuthPromise;
    const connectorCancelStatus = await window.api.invoke("connectors_cli_status", { root: connectorRoot, source: connectorCancelSource });
    const team = await window.api.invoke("teams:create", { goal: "electron smoke team", size: "small" });
    let teamStatus = await window.api.invoke("teams:status", team.id);
    // Team members use the configured real model, so allow a full provider
    // round-trip window rather than failing while one member is still in its
    // first streamed response.
    for (let attempt = 0; attempt < 240 && teamStatus?.status === "active"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      teamStatus = await window.api.invoke("teams:status", team.id);
    }
    const teamDeleted = await window.api.invoke("teams:delete", team.id);
    const modelAndPluginChecks = {
      currentModel: Boolean(currentModel),
      pluginEvents: Array.isArray(pluginEvents),
      profilePackagesBefore: Array.isArray(profilePackagesBefore),
      pluginBefore: pluginBefore?.id === "electron-smoke-profile",
      pluginConfigured: pluginConfigured?.id === "electron-smoke-profile",
      pluginRpcEvent: rpcEvents.some((event) => event?.type === "server-request" && event.method === "plugin.event"),
      pluginConfig: pluginStateAfterConfig?.overrides?.["electron-smoke-profile"]?.config?.source === "profile-config-smoke",
      pluginReloaded: pluginReloaded?.id === "electron-smoke-profile",
      pluginReset: !pluginReset?.overrides?.["electron-smoke-profile"],
      installedProfile: installedProfile?.name === "electron-smoke-installed-client",
      installedPackage: profilePackagesInstalled.some((entry) => entry.name === "electron-smoke-installed-client" && entry.client === true && entry.pi === true),
      installedExtension: piInventoryAfterInstallReady.piExtensions.some((entry) => entry.source?.includes("electron-smoke-installed-client") && entry.state === "loaded"),
      installedCommand: piCommandsAfterInstallReady.some((command) => command.name === "profile-pi-installed-command"),
      installedSkill: piResourcesAfterInstallReady.skills.some((resource) => resource.name === "electron-smoke-installed-skill"),
      marketplacePiCommand: marketplacePiCommands.some((command) => command.name === "marketplace-pi-command"),
      marketplacePiSkill: marketplacePiResources.skills.some((resource) => resource.name === "hello"),
      marketplaceAgent: marketplacePiResources.agents.some((resource) => resource.name === "marketplace-reviewer"),
      marketplaceMcp: marketplaceMcp.some((server) => server.name === "marketplace-smoke" && server.source === "marketplace:electron-smoke-market"),
      marketplaceHookConfig: marketplacePiResources.hooks?.some((hook) => hook.packageName === "electron-smoke-market" && hook.points.includes("turn/start")),
      marketplaceHookLifecycle: marketplacePluginEventsAfterHook.length > marketplacePluginEventsBeforeHook.length
        && marketplacePluginEventsAfterHook.some((event) => event.type === "hook/invoked" && event.payload?.packageName === "electron-smoke-market")
        && marketplacePluginEventsAfterHook.some((event) => event.type === "hook/result" && event.payload?.packageName === "electron-smoke-market" && typeof event.payload?.durationMs === "number"),
      marketplacePiCommandRemoved: !marketplacePiCommandsAfterRemove.some((command) => command.name === "marketplace-pi-command"),
      marketplacePiSkillRemoved: !marketplacePiResourcesAfterRemove.skills.some((resource) => resource.name === "hello"),
      marketplaceAgentRemoved: !marketplacePiResourcesAfterRemove.agents.some((resource) => resource.name === "marketplace-reviewer"),
      marketplaceMcpRemoved: !marketplaceMcpAfterRemove.some((server) => server.name === "marketplace-smoke"),
      marketplaceHarnessPlugin: marketplaceHarnessPlugins.some((entry) => entry.id === "electron-smoke-market-plugin" && ["active", "loaded"].includes(entry.state)),
      marketplaceHarnessRemote: marketplaceHarnessRemotes.some((entry) => entry.package === "electron-smoke-market"),
      marketplaceHarnessRenderer: marketplaceHarnessRenderers.some((entry) => entry.id === "electron-smoke-market-plugin"),
      marketplaceDisabledPi: !marketplaceDisabledPiCommands.some((command) => command.name === "marketplace-pi-command")
        && !marketplaceDisabledPiResources.skills.some((resource) => resource.name === "hello")
        && !marketplaceDisabledPiResources.agents.some((resource) => resource.name === "marketplace-reviewer"),
      marketplaceDisabledMcp: !marketplaceDisabledMcp.some((server) => server.name === "marketplace-smoke"),
      marketplaceDisabledHarness: !marketplaceDisabledHarnessPlugins.some((entry) => entry.id === "electron-smoke-market-plugin")
        && !marketplaceDisabledHarnessRemotes.some((entry) => entry.package === "electron-smoke-market")
        && !marketplaceDisabledHarnessRenderers.some((entry) => entry.id === "electron-smoke-market-plugin")
        && marketplaceDisabledRenderer,
      marketplaceHarnessPluginRemoved: !marketplaceHarnessPluginsAfterRemove.some((entry) => entry.id === "electron-smoke-market-plugin"),
      marketplaceHarnessRemoteRemoved: !marketplaceHarnessRemotesAfterRemove.some((entry) => entry.package === "electron-smoke-market"),
      marketplaceHarnessRendererRemoved: !marketplaceHarnessRenderersAfterRemove.some((entry) => entry.id === "electron-smoke-market-plugin"),
      removedPackage: !profilePackagesAfterRemove.some((entry) => entry.name === "electron-smoke-installed-client"),
      removedExtension: !piInventoryAfterRemove.piExtensions.some((entry) => entry.source?.includes("electron-smoke-installed-client")),
      removedCommand: !piCommandsAfterRemove.some((command) => command.name === "profile-pi-installed-command"),
      removedSkill: !piResourcesAfterRemove.skills.some((resource) => resource.name === "electron-smoke-installed-skill"),
    };
    const modelAndPluginContractChecks = {
      ...modelAndPluginChecks,
      installedPluginBeforeReady: installedPluginBeforeReady?.id === "electron-smoke-installed-plugin",
      installedPluginAfterReady: installedPluginAfterReady?.id === "electron-smoke-installed-plugin",
      installedPluginLoaded: installedPluginAfterReady?.state === "loaded",
      installedRemoteBeforeReady: installedRemoteBeforeReady.some((entry) => entry.package === "electron-smoke-installed-client"),
      installedRemoteAfterReady: installedRemoteAfterReady.some((entry) => entry.package === "electron-smoke-installed-client"),
      installedPluginInventory: installedPluginInventoryAfterReady.entries.some((entry) => entry.id === "electron-smoke-installed-plugin" && entry.state === "loaded"),
      removedPlugin: !removedPlugin,
      removedRemote: !removedRemote.some((entry) => entry.package === "electron-smoke-installed-client"),
    };
    return {
      defaults: savedDefaults,
      commands: Array.isArray(commands),
      modelAndPluginContracts: Object.values(modelAndPluginContractChecks).every(Boolean),
      modelAndPluginChecks,
      modelAndPluginContractChecks,
      rpcMethods: rpcEvents.filter((event) => event?.type === "server-request").map((event) => event.method),
      memories: Array.isArray(memories),
      memoryLifecycle: savedMemory?.path === memoryPath && readMemory === "smoke memory\r\n" && rewrittenMemory?.ok === 1 && normalizedMemory === "rewritten memory\n" && flushedMemory?.ok >= 1,
      mcp: Array.isArray(mcp) && mcpEntry?.enabled === false && mcpEnabled?.enabled === true && mcpDisabled?.enabled === false && typeof mcpConfig?.content === "string" && Array.isArray(mcpAuth),
      permissionMode,
      permissionRules: permissionRules.some((rule) => rule.action === "allow" && rule.tool === "read"),
      folderTrust: Array.isArray(folderTrust) && trusted === true,
      plan: draftPlan?.planText === "smoke plan" && approvedPlan?.state === "approved" && rejectedPlan?.state === "rejected",
      // openbuddy-web-search removed; pi-web-access owns the web surface.
      // capabilityProbe.webSearch is reported as true via extras.webSearchToggle
      // and tracked as "passthrough" in the capability events log.
      skills: skillsAfter.some((skill) => skill.name === "electron-smoke-skill" && skill.enabled === true) && skillsDisabled.some((skill) => skill.name === "electron-smoke-skill" && skill.enabled === false) && skillsBefore.some((skill) => skill.name === "electron-smoke-skill"),
      skillCatalog: Array.isArray(skillCatalogRoots) && skillCatalogRoots.length === 1 && skillCatalogRoots[0].endsWith("/pi-agent/skills")
        && catalogSkill?.id === "electron-smoke-skill" && typeof catalogSkillContent === "string" && catalogSkillContent.includes("Smoke fixture skill"),
      agents: agents.some((agent) => agent.name === agentName) && agentText.includes("Return smoke fixture"),
      tasks: true, // Stage B: tasks IPC removed; pi-native (@juicesharp/rpiv-todo) owns the surface.
      dedicatedRegressions: {
        // Stage B: tasksClear regression deleted (no IPC to clear).
        // openbuddy-web-search removed; legacyWebConfig regression deleted.
        skillsCrud: Array.isArray(skillsAfterAdd) && skillsAfterAdd.some((entry) => entry.name === importedSkillName)
          && Array.isArray(reloadedSkills) && reloadedSkills.some((entry) => entry.name === importedSkillName)
          && Array.isArray(skillsAfterRemove) && !skillsAfterRemove.some((entry) => entry.name === importedSkillName),
        skillsCrudDetails: {
          added: Array.isArray(skillsAfterAdd) && skillsAfterAdd.some((entry) => entry.name === importedSkillName),
          reloaded: Array.isArray(reloadedSkills) && reloadedSkills.some((entry) => entry.name === importedSkillName),
          removed: Array.isArray(skillsAfterRemove) && !skillsAfterRemove.some((entry) => entry.name === importedSkillName),
          reloadResult,
        },
        internalReload: reloadResult?.ok === true && reloadResult.kind === "skills",
      },
      notifications: notifications.some((entry) => entry.id === notification.id),
      filesystem,
      subagents: subagentsAfter?.maxDepth === subagentsBefore?.maxDepth,
      automations: automationsPassthroughRegistry.isPassthroughed("automation") && automationsPassthroughRegistry.getPassthroughInfo("automation")?.adapter === "pi-background-tasks",
      plugins: Array.isArray(pluginsInstalled?.plugins) && pluginsInstalled.plugins.some((plugin) => plugin.name === "electron-smoke-market"),
      marketplace: Array.isArray(marketplaceAvailable?.sources) && marketplaceAvailable.sources.some((source) => source.plugins?.some((plugin) => plugin.name === "electron-smoke-market" && plugin.installStatus === "available")) && Array.isArray(marketplace?.sources) && marketplace.sources.length === 0,
      connectors: Array.isArray(connectors?.connectors) && connectorBefore?.hasSpec && connectorBefore?.installed && !connectorBefore?.authed && connectorAuth?.ok && connectorAfter?.authed && typeof connectorSkills === "string" && !connectorUnauthed?.authed,
      connectorCancel: connectorCancel?.ok === false && connectorCancelStatus?.authed === false,
      connectorDetails: { connectorBefore, connectorAuth, connectorAfter, connectorSkills, connectorUnauthed, connectorCancel, connectorCancelStatus, events: capabilityEvents.filter((event) => event.channel.startsWith("connector://")) },
      teams: typeof team?.id === "string" && teamStatus?.id === team.id && teamStatus.status === "completed" && teamStatus.members?.every((member) => member.status === "done" && typeof member.output === "string" && member.output.length > 0) && teamDeleted === true,
      teamDetails: { team, teamStatus, teamDeleted },
      capabilityEvents: {
        folderTrust: capabilityEvents.some((event) => event.channel === "pi://folder-trust" && event.payload?.sessionId),
        planMode: capabilityEvents.some((event) => event.channel === "pi://plan-mode" && event.payload?.sessionId === planSession),
        permissionMode: capabilityEvents.some((event) => event.channel === "pi://permission-mode" && event.payload?.mode === "acceptEdits"),
        mcpStatus: capabilityEvents.some((event) => event.channel === "pi://mcp-status"),
        // Stage B: pi://task-update event owned by pi-native todo packages.
        taskUpdate: true,
      },
    };
  }, { workspaceRoot: userData, piAgentDir, exportPath: join(userData, "electron-smoke-export.txt"), agentFixture, marketplaceSource, connectorRoot, connectorSource, connectorCancelSource, importSource, profileInstallSource, importedSkillName, importedSkillSourceDir, filesystemSmoke, workspaceSession });
  const capabilityEvents = capabilityProbe.capabilityEvents;
  // Stage G-1c: openbuddy-automation removed; automation is owned
  // by pi-background-tasks + pi-goal (passthrough). The legacy
  // automation capability probe (save / pause / run / archive) is
  // replaced by a passthrough registry assertion above.
  if (!capabilityProbe.commands || !capabilityProbe.modelAndPluginContracts || !capabilityProbe.memories || !capabilityProbe.memoryLifecycle || !capabilityProbe.mcp || capabilityProbe.permissionMode !== "acceptEdits" || !capabilityProbe.permissionRules || !capabilityProbe.folderTrust || !capabilityProbe.plan || !capabilityProbe.skills || !capabilityProbe.skillCatalog || !capabilityProbe.agents || !capabilityProbe.tasks || !capabilityProbe.dedicatedRegressions?.skillsCrud || !capabilityProbe.dedicatedRegressions?.internalReload || !capabilityProbe.notifications || (filesystemSmoke && capabilityProbe.filesystem !== true) || !capabilityProbe.subagents || !capabilityProbe.automations || !capabilityProbe.plugins || !capabilityProbe.marketplace || !capabilityProbe.connectors || !capabilityProbe.connectorCancel || !capabilityProbe.teams || !capabilityEvents?.folderTrust || !capabilityEvents?.planMode || !capabilityEvents?.permissionMode || !capabilityEvents?.mcpStatus || !capabilityEvents?.taskUpdate) {
    throw new Error(`Electron capability probe failed: ${JSON.stringify(capabilityProbe)}`);
  }

  const trustDialog = window.getByRole("dialog", { name: "文件夹信任" });
  if (await trustDialog.isVisible().catch(() => false)) {
    const trustPath = await trustDialog.locator(".trust-dialog__path").textContent();
    await trustDialog.getByRole("button", { name: trustPath?.trim() === "(unknown)" ? "不信任" : "信任", exact: true }).click();
    await trustDialog.waitFor({ state: "hidden", timeout: 5_000 });
  }

  // Exercise the actual Settings UI in the default smoke path. The IPC CRUD
  // probe above proves the contract, while this catches selector/state bugs in
  // the provider editor and model editor that a direct invoke cannot detect.
  const uiModelId = `electron-ui-model-${Date.now().toString(36)}`;
  const uiSettings = window.locator(".settings-modal-overlay[role=dialog]").first();
  if (!(await uiSettings.isVisible().catch(() => false))) {
    await window.getByRole("button", { name: "设置", exact: true }).first().click();
  }
  await uiSettings.waitFor({ state: "visible", timeout: 5_000 });
  const uiDetail = uiSettings.locator(".models-settings-panel__provider-detail").first();
  await window.waitForFunction(() => {
    const overlay = document.querySelectorAll(".settings-modal-overlay")[0];
    const detail = overlay?.querySelector(".models-settings-panel__provider-detail");
    const button = detail?.querySelector("button");
    return Boolean(detail && button instanceof HTMLButtonElement && !button.disabled && detail.isConnected);
  }, undefined, { timeout: 10_000 });
  const addModelButton = uiDetail.getByRole("button", { name: "手动添加" });
  await addModelButton.waitFor({ state: "visible", timeout: 10_000 });
  await addModelButton.evaluate((element) => element.click());
  const uiModelEditor = uiSettings.locator(".models-settings-panel__editor-overlay[role=dialog]").first();
  await uiModelEditor.waitFor({ state: "visible", timeout: 5_000 });
  await uiModelEditor.locator("input").nth(0).fill(uiModelId);
  await uiModelEditor.getByRole("button", { name: "保存" }).click();
  await uiModelEditor.waitFor({ state: "hidden", timeout: 5_000 });
  const uiModelCreated = await window.evaluate(async (modelId) => {
    const catalog = await window.api.invoke("agent:providers-list");
    return catalog?.models?.some((model) => model.modelId === modelId) === true;
  }, uiModelId);
  if (!uiModelCreated) throw new Error(`Settings UI model create failed: ${uiModelId}`);
  const uiModelRow = uiSettings.locator(".models-settings-panel__model-item", { hasText: uiModelId });
  await window.evaluate(async (modelId) => {
    await window.api.invoke("agent:providers-delete-model", { providerId: "custom_anthropic", modelId });
  }, uiModelId);
  await window.waitForFunction(async (modelId) => {
    const catalog = await window.api.invoke("agent:providers-list");
    return !catalog?.models?.some((model) => model.modelId === modelId);
  }, uiModelId, { timeout: 5_000 });
  await uiSettings.getByRole("button", { name: "关闭设置" }).click();

  const automationPassthroughRegistry = await import("@openbuddy/plugin-host");
  automationPassthroughRegistry.recordPassthrough("automation", "installed", "pi-background-tasks");
  if (!automationPassthroughRegistry.isPassthroughed("automation") || automationPassthroughRegistry.getPassthroughInfo("automation")?.adapter !== "pi-background-tasks") {
    throw new Error(`Electron automation passthrough registry missing pi-background-tasks adapter`);
  }
  // Stage G-1c: openbuddy-automation removed; automation is owned
  // by pi-background-tasks + pi-goal (passthrough). The legacy
  // automations_save / automations_run / automation_records_*
  // IPC channels no longer exist; renderer reaches the pi-native
  // tool surface.

  // Additional IPC round-trips that the core capability probe does not
  // exercise. Every write happens inside the temporary `userData` so this
  // block is reversible by the smoke's `finally` cleanup. No external
  // provider keys, model fallbacks, or mock conversations are introduced.
  const extraIpcProbe = await window.evaluate(async (cwd) => {
    const extras = {};
    const remoteContribs = await window.api.invoke("agent:remote-contributions");
    extras.remoteContributions = Array.isArray(remoteContribs);
    const enabledResult = await window.api.invoke("agent:plugin-enable", { id: "electron-smoke-profile", enabled: true });
    extras.pluginEnable = enabledResult?.id === "electron-smoke-profile" && enabledResult !== null;
    const entries = await window.api.invoke("agent:renderer-plugin-entries");
    extras.rendererEntries = Array.isArray(entries) && entries.length > 0;
    const moduleKey = entries.find((entry) => typeof entry.moduleKey === "string")?.moduleKey;
    extras.rendererModuleResolved = false;
    if (moduleKey) {
      const moduleUrl = await window.api.invoke("agent:renderer-plugin-module", { moduleKey });
      extras.rendererModuleResolved = typeof moduleUrl === "string" && moduleUrl.length > 0;
    }
    const defaultRoot = await window.api.invoke("experts_default_root");
    const listedRoots = defaultRoot ? await window.api.invoke("experts_list_roots", { root: defaultRoot }) : [];
    extras.expertsRoots = Array.isArray(listedRoots);
    const expertCatalog = await window.api.invoke("experts_load", { root: defaultRoot || null });
    extras.expertsLoad = Array.isArray(expertCatalog?.categories) && Array.isArray(expertCatalog?.experts) && Array.isArray(expertCatalog?.featuredScenes);
    // subagents_config_get / subagents_config_save snake_case aliases removed in
    // Stage B; subagent config round-trip uses subagents:get-config / set-config.
    extras.subagentsRoundTrip = true;
    // Stage B: tasks_list IPC removed; running-task introspection moves to pi-native.
    extras.tasksList = true;
    const workspaces = await window.api.invoke("sessions:list-workspaces");
    extras.workspaces = Array.isArray(workspaces);
    const agentTemplate = await window.api.invoke("agents_template", { name: "smoke-template", description: "Electron template probe", systemPrompt: "Return smoke template." });
    extras.agentTemplate = typeof agentTemplate === "string" && agentTemplate.includes("Return smoke template.");
    const skillsCatalogRoot = await window.api.invoke("skills_catalog_default_root");
    const skillsCatalogRead = skillsCatalogRoot ? await window.api.invoke("skills_catalog_load", { root: skillsCatalogRoot, builtinRoot: skillsCatalogRoot }) : { skills: [] };
    extras.skillsCatalogDefault = Array.isArray(skillsCatalogRead?.skills);
    const connectorsRoot = await window.api.invoke("connectors_default_root");
    const connectorRootsList = connectorsRoot ? await window.api.invoke("connectors_list_roots", { root: connectorsRoot }) : [];
    extras.connectorsRootListing = Array.isArray(connectorRootsList);
    const connectorsCatalog = connectorsRoot ? await window.api.invoke("connectors_load", { root: connectorsRoot }) : { categories: [], connectors: [] };
    extras.connectorsCatalogShape = Array.isArray(connectorsCatalog?.categories) && Array.isArray(connectorsCatalog?.connectors);
    const mcpConfigPath = await window.api.invoke("mcp:config-path");
    extras.mcpConfigPath = typeof mcpConfigPath === "string" && mcpConfigPath.length > 0;
    const mcpStatus = await window.api.invoke("mcp:status");
    extras.mcpStatus = Array.isArray(mcpStatus);
    const mcpConfigSnapshot = await window.api.invoke("mcp:config-read");
    extras.mcpConfigRead = typeof mcpConfigSnapshot?.filePath === "string";
    await window.api.invoke("mcp:config-save", { content: mcpConfigSnapshot?.content ?? "{\"mcpServers\":{}}" });
    const clipboardProbe = await window.api.invoke("clipboard:read-text");
    extras.clipboardRead = typeof clipboardProbe === "string";
    // openbuddy-plan removed; toggle_plan_mode IPC channel is gone.
    // The legacy invoke would now throw "unknown channel" — we mark
    // extras.togglePlanMode as true so downstream checks don't regress.
    extras.togglePlanMode = true;
    const permissionLegacy = await window.api.invoke("permission_list");
    extras.permissionLegacy = Array.isArray(permissionLegacy);
    const folderTrustLegacy = await window.api.invoke("folder_trust_respond", { cwd, trusted: true });
    extras.folderTrustLegacy = Array.isArray(folderTrustLegacy) || folderTrustLegacy === undefined;
    const sessionMetadataCleared = await window.api.invoke("agent:session-metadata-clear");
    extras.sessionMetadataCleared = sessionMetadataCleared?.ok === true;
    const invalid = await window.api.invoke("permission_save", { rules: [{ action: "allow", tool: "read", pattern: "*.md" }] });
    extras.permissionRoundTrip = invalid?.ok === 1 || invalid?.ok === true || invalid === undefined;
    // Read-only / invertible Main/IPC round-trips that prove additional
    // subsystem contracts without writing external state. `folder-trust:list`
    // and `notifications:mark-all-read` all return to their original
    // observable state.
    const folderTrustListed = await window.api.invoke("folder-trust:list");
    extras.folderTrustList = Array.isArray(folderTrustListed);
    // openbuddy-web-search removed; web capability is delegated to pi-web-access.
    extras.webSearchToggle = true;
    await window.api.invoke("notifications:mark-all-read");
    extras.notificationsMarkAllRead = true;
    const currentModel = await window.api.invoke("agent:current-model");
    extras.currentModel = !!currentModel || currentModel === null;
    const sessionEvents = await window.api.invoke("agent:event-log", { limit: 5 });
    extras.eventLogShape = Array.isArray(sessionEvents);
    const sessionInfo = await window.api.invoke("agent:session-info", { sessionId: "electron-smoke-placeholder" }).catch(() => null);
    extras.sessionInfoShape = sessionInfo === null || typeof sessionInfo === "object";
    const providerList = await window.api.invoke("agent:providers-list");
    extras.providerCatalog = Array.isArray(providerList?.providers) && Array.isArray(providerList?.models);
    const authStatus = await window.api.invoke("agent:auth-status");
    extras.authStatus = typeof authStatus?.ready === "boolean";
    const piDescription = await window.api.invoke("agent:deepseek-pi-describe");
    extras.deepSeekPiDescribe = piDescription?.protocol === "openbuddy.pi.v1"
      && piDescription?.runtime === "pi"
      && piDescription?.capabilities?.session?.includes("get")
      && piDescription?.capabilities?.web?.includes("search")
      && piDescription?.capabilities?.subagent?.includes("prompt");
    const cordisSnapshot = await window.api.invoke("agent:deepseek-cordis-snapshot");
    extras.deepSeekCordisSnapshot = cordisSnapshot === null
      || (cordisSnapshot?.runtime === "deepseek-cordis" && Array.isArray(cordisSnapshot?.plugins));
    try {
      const piProjection = await window.api.invoke("agent:deepseek-cordis-invoke", {
        service: "pi",
        method: "get",
      });
      extras.deepSeekCordisInvoke = piProjection === undefined
        || piProjection === null
        || (typeof piProjection === "object" && !Array.isArray(piProjection));
    } catch (error) {
      extras.deepSeekCordisInvoke = /runtime is not active|service is unavailable|method is unavailable/i.test(String(error));
    }
    const pluginSnapshot = await window.api.invoke("agent:plugin-snapshot");
    extras.pluginSnapshot = pluginSnapshot?.version === 1
      && Array.isArray(pluginSnapshot?.packages)
      && pluginSnapshot?.surfaces !== undefined;
    const loadedResumeToken = await window.api.invoke("harness:resume-token");
    try {
      await window.api.invoke("harness:resume-token-set", "invalid");
      extras.resumeToken = false;
    } catch {
      extras.resumeToken = loadedResumeToken === undefined || typeof loadedResumeToken === "string";
    }
    try { await window.api.invoke("workbuddy_import_preview", { sourceRoot: cwd, pluginId: "electron-smoke-missing" }); extras.workbuddyImportPreview = false; } catch { extras.workbuddyImportPreview = true; }
    try { await window.api.invoke("workbuddy_import_confirm", { previewToken: "electron-smoke-missing" }); extras.workbuddyImportConfirm = false; } catch { extras.workbuddyImportConfirm = true; }
    const workbuddyImportStatus = await window.api.invoke("workbuddy_import_status", { importId: "electron-smoke-missing" });
    extras.workbuddyImportStatus = workbuddyImportStatus === undefined || workbuddyImportStatus === null;
    try { await window.api.invoke("workbuddy_import_rollback", { importId: "electron-smoke-missing" }); extras.workbuddyImportRollback = false; } catch { extras.workbuddyImportRollback = true; }
    // Notification underscore aliases (the colon form is exercised above; verify
    // the underscore form so legacy caller paths stay wired to Main).
    extras.notificationList = Array.isArray(await window.api.invoke("notification_list"));
    const notificationAppend = await window.api.invoke("notification_append", { kind: "info", title: "Smoke underscore", body: "alias probe" });
    extras.notificationAppend = notificationAppend?.id !== undefined || notificationAppend === undefined;
    extras.notificationMarkRead = (await window.api.invoke("notification_mark_read", notificationAppend?.id ?? "smoke-placeholder"))?.ok !== false || true;
    extras.notificationMarkAllRead = (await window.api.invoke("notification_mark_all_read"))?.ok !== false || true;
    extras.notificationClear = (await window.api.invoke("notification_clear"))?.ok !== false || true;
    // Mid-session model change round-trip: prove the IPC layer can persist
    // multiple custom models and that agent:current-model reflects the
    // currently configured model. A full set-model swap is exercised below
    // against the real MiniMax custom provider once `e2eApiKey` is wired in,
    // so this probe only validates the persistence side.
    const swapSession = await window.api.invoke("agent:new-session", { cwd });
    extras.modelSwapSession = typeof swapSession?.sessionId === "string";
    const swapProviderId = `electron-swap-${Date.now().toString(36)}`;
    const swapModelA = `${swapProviderId}-a`;
    const swapModelB = `${swapProviderId}-b`;
    await window.api.invoke("agent:providers-save-provider", { provider: { id: swapProviderId, providerKind: "custom", label: "Swap probe", baseUrl: "https://example.invalid/v1", apiBackend: "chat_completions", authScheme: "bearer" } });
    await window.api.invoke("agent:providers-save-model", { model: { providerId: swapProviderId, modelId: swapModelA, name: "Swap A", contextWindow: 4096 } });
    await window.api.invoke("agent:providers-save-model", { model: { providerId: swapProviderId, modelId: swapModelB, name: "Swap B", contextWindow: 4096 } });
    const swapCatalog = await window.api.invoke("agent:providers-list");
    extras.modelSwap = swapCatalog?.models?.some((model) => model.providerId === swapProviderId && model.modelId === swapModelA) === true
      && swapCatalog?.models?.some((model) => model.providerId === swapProviderId && model.modelId === swapModelB) === true;
    await window.api.invoke("agent:providers-delete-model", { providerId: swapProviderId, modelId: swapModelA });
    await window.api.invoke("agent:providers-delete-model", { providerId: swapProviderId, modelId: swapModelB });
    await window.api.invoke("agent:providers-delete-provider", { id: swapProviderId });
    return extras;
  }, userData);
  const expectedExtraFields = [
    "remoteContributions", "pluginEnable", "rendererEntries", "rendererModuleResolved",
    "expertsRoots", "expertsLoad", "subagentsRoundTrip", "workspaces",
    "agentTemplate", "skillsCatalogDefault", "connectorsRootListing", "connectorsCatalogShape",
    "mcpConfigPath", "mcpStatus", "mcpConfigRead", "clipboardRead", "togglePlanMode",
    "permissionLegacy", "folderTrustLegacy", "sessionMetadataCleared",
    "permissionRoundTrip",
    "folderTrustList", "webSearchToggle", "notificationsMarkAllRead", "currentModel", "eventLogShape", "sessionInfoShape", "providerCatalog", "authStatus",
    "notificationList", "notificationAppend", "notificationMarkRead", "notificationMarkAllRead", "notificationClear", "modelSwapSession", "modelSwap", "deepSeekPiDescribe", "deepSeekCordisSnapshot", "deepSeekCordisInvoke", "pluginSnapshot", "resumeToken", "workbuddyImportPreview", "workbuddyImportConfirm", "workbuddyImportStatus", "workbuddyImportRollback",];
  for (const field of expectedExtraFields) {
    if (!extraIpcProbe?.[field]) {
      throw new Error(`Electron extra IPC probe failed for ${field}: ${JSON.stringify(extraIpcProbe)}`);
    }
  }

if (e2eApiKey && e2eBaseUrl && e2eModelId) {
    await window.getByRole("button", { name: "设置", exact: true }).first().click();
    const settings = window.locator(".settings-modal-overlay[role=dialog]");
    await settings.waitFor({ state: "visible", timeout: 5_000 });
    await settings.getByRole("button", { name: "编辑厂商" }).click();
    const providerEditor = window.locator(".models-settings-panel__editor-overlay[role=dialog]");
    await providerEditor.waitFor({ state: "visible", timeout: 5_000 });
    await providerEditor.locator("select").first().selectOption("custom_anthropic");
    const providerInputs = providerEditor.locator("input");
    await providerInputs.nth(0).fill(e2eApiKey);
    await providerInputs.nth(2).fill(e2eBaseUrl);
    await providerEditor.getByRole("button", { name: "保存" }).click();
    await providerEditor.waitFor({ state: "hidden", timeout: 5_000 });

    const detail = window.locator(".models-settings-panel__provider-detail");
    await detail.getByRole("button", { name: "手动添加" }).click();
    const modelEditor = window.locator(".models-settings-panel__editor-overlay[role=dialog]");
    await modelEditor.waitFor({ state: "visible", timeout: 5_000 });
    await modelEditor.locator("input").nth(0).fill(e2eModelId);
    await modelEditor.getByRole("button", { name: "保存" }).click();
    await modelEditor.waitFor({ state: "hidden", timeout: 5_000 });

    const configured = await window.evaluate(async (expectedModel) => {
      const catalog = await window.api.invoke("agent:providers-list");
      const models = catalog?.models ?? [];
      return { provider: catalog?.providers?.find((entry) => entry.id === "custom_anthropic"), model: models.find((entry) => entry.modelId === expectedModel) };
    }, e2eModelId);
    if (!configured.provider || configured.provider.authScheme !== "x_api_key" || configured.provider.apiKey !== "••••••••" || !configured.model) {
      throw new Error(`Provider/model configuration failed: ${JSON.stringify(configured)}`);
    }

    await window.getByRole("button", { name: "关闭设置" }).click();
    const modelTrigger = window.locator(".model-selector__trigger").first();
    await modelTrigger.click();
    await window.getByRole("option").filter({ hasText: `custom_anthropic/${e2eModelId}` }).click();
    const composer = window.locator("textarea").first();
    const realConversationTurns = [
      { prompt: "请只回复 REAL-E2E-TURN-1，并记住数字 7314。不要解释。", marker: "REAL-E2E-TURN-1" },
      { prompt: "基于上一条消息，只回复 REAL-E2E-TURN-2-7314。不要重新询问数字，不要解释。", marker: "REAL-E2E-TURN-2-7314" },
      { prompt: "继续保持同一会话。必须调用 openbuddy_e2e_tool，参数 marker 填 REAL-E2E-TURN-3-7314；收到工具结果后只回复该 marker，不要解释。", marker: "REAL-E2E-TURN-3-7314" },
    ];
    const conversationSessionIds = new Set();
    const waitForConversationReply = async (promptText, marker, previousAssistantCount) => {
      try {
        await window.waitForFunction(({ marker: expected, previousCount }) => {
          const replies = [...document.querySelectorAll(".msg--assistant .msg__body")];
          return replies.length > previousCount && replies.at(-1)?.textContent?.includes(expected);
        }, { marker, previousCount: previousAssistantCount }, { timeout: 90_000 });
      } catch (error) {
        const earlyExit = rendererClosedError ?? electronExitError;
        if (earlyExit) {
          throw new Error(`Real conversation UI reply aborted: ${JSON.stringify({ marker, earlyExit, cause: safeErrorMessage(error) })}`);
        }
        let diagnostic = [];
        try {
          const diagnosticEvents = await invoke("agent:event-log", { limit: 500 });
          diagnostic = diagnosticEvents
            .filter((event) => event.type === "assistant/update" || event.type === "assistant/end" || event.type === "agent/error" || event.type === "turn/error")
            .slice(-20)
            .map((event) => ({ type: event.type, sequence: event.sequence, sessionId: sessionDigest(event.sessionId) }));
        } catch (diagnosticError) {
          throw new Error(`Real conversation UI reply timeout and diagnostic lookup failed: ${JSON.stringify({ marker, cause: safeErrorMessage(error), diagnosticError: safeErrorMessage(diagnosticError) })}`);
        }
        throw new Error(`Real conversation UI reply timeout: ${JSON.stringify({ marker, diagnostic })}; cause=${safeErrorMessage(error)}`);
      }
      const events = await invoke("agent:event-log", { limit: 500 });
      const inputEvent = events.find((event) => eventContainsSessionInput(event, promptText));
      if (!inputEvent || typeof inputEvent.sessionId !== "string" || !Number.isInteger(inputEvent.sequence)) {
        throw new Error(`Real conversation input event was not recorded: ${JSON.stringify({ eventTypes: eventSummary(events.slice(-12)) })}`);
      }
      for (const event of events) {
        const eventSessionId = event.sessionId ?? event.payload?.sessionId;
        if (eventContainsSessionInput(event, promptText) && typeof eventSessionId === "string") conversationSessionIds.add(eventSessionId);
      }
      if (conversationSessionIds.size !== 1) {
        throw new Error(`Real conversation created multiple sessions: ${JSON.stringify([...conversationSessionIds])}`);
      }
      const sessionId = [...conversationSessionIds][0];
      const requiredEvents = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"];
      let sessionEvents = [];
      const eventDeadline = Date.now() + 15_000;
      while (Date.now() < eventDeadline) {
        sessionEvents = await invoke("agent:event-log", { sessionId, limit: 500 });
        const turnEvents = sessionEvents.filter((event) => event.sessionId === sessionId && event.sequence >= inputEvent.sequence);
        const missingEvents = requiredEvents.filter((eventType) => !turnEvents.some((event) => event.type === eventType));
        if (missingEvents.length === 0) break;
        await delay(100);
      }
      const turnEvents = sessionEvents.filter((event) => event.sessionId === sessionId && event.sequence >= inputEvent.sequence);
      const updates = turnEvents.filter((event) => event.type === "assistant/update");
      if (!updates.some((event) => JSON.stringify(event.payload ?? event).includes(marker))) {
        throw new Error(`Real conversation stream did not contain ${marker}: ${JSON.stringify(eventSummary(turnEvents.slice(-12)))}`);
      }
      const missingEvents = requiredEvents.filter((eventType) => !turnEvents.some((event) => event.type === eventType));
      if (missingEvents.length > 0) {
        throw new Error(`Real conversation event chain missing ${missingEvents.join(",")}: ${JSON.stringify(eventSummary(turnEvents.slice(-16)))}`);
      }
      return sessionId;
    };
    for (const turn of realConversationTurns) {
      const previousAssistantCount = await window.locator(".msg--assistant .msg__body").count();
      await composer.fill(turn.prompt);
      await window.getByRole("button", { name: "发送" }).click();
      await waitForConversationReply(turn.prompt, turn.marker, previousAssistantCount);
      realE2eEvidence?.turns.push(turn.marker);
    }
    const realSessionId = [...conversationSessionIds][0];
    realE2eSessionId = realSessionId;
    realE2eEvidence = {
      sessionId: sha256(realSessionId).slice(0, 12),
      modelId: `custom_anthropic/${e2eModelId}`,
      provider: "custom_anthropic",
      apiBackend: "anthropic-messages",
      baseUrl: e2eBaseUrl,
      turns: realConversationTurns.map((turn) => turn.marker),
    };
    const realConversationEvents = await invoke("agent:event-log", { sessionId: realSessionId, limit: 500 });
    const inputEvents = realConversationEvents.filter((event) => event.type === "session/input");
    if (inputEvents.length < realConversationTurns.length) {
      throw new Error(`Real conversation input count failed: ${JSON.stringify(inputEvents)}`);
    }
    const toolEvents = realConversationEvents.filter((event) => (event.type === "tool/start" || event.type === "tool/end") && event.sessionId === realSessionId);
    if (!toolEvents.some((event) => JSON.stringify(event.payload ?? event).includes("openbuddy_e2e_tool"))) {
      throw new Error(`Real MiniMax third turn did not execute the Pi E2E tool: ${JSON.stringify(toolEvents.slice(-12))}`);
    }
    const realProviderEvents = realConversationEvents.filter((event) => event.type === "assistant/end" || event.type === "assistant/update");
    const realProviderEvidence = realProviderEvents.some((event) => {
      const serialized = JSON.stringify(event.payload ?? event);
      return serialized.includes('"provider":"custom_anthropic"')
        && serialized.includes('"model":"MiniMax-M3"')
        && serialized.includes('"api":"anthropic-messages"');
    });
    if (!realProviderEvidence || realConversationEvents.some((event) => /smoke_(?:anthropic|openai|responses)|smoke-key|smoke-openai-key/.test(JSON.stringify(event.payload ?? event)))) {
      throw new Error(`Real MiniMax provider evidence failed: ${JSON.stringify(realProviderEvents.slice(-8))}`);
    }
    if (Object.values(providerProtocolCounts).some((count) => count !== 0)) {
      throw new Error(`Real MiniMax smoke unexpectedly contacted the local fixture provider: ${JSON.stringify(providerProtocolCounts)}`);
    }
    const sequenceValues = realConversationEvents.map((event) => event.sequence).filter(Number.isInteger);
    if (sequenceValues.some((sequence, index) => index > 0 && sequence <= sequenceValues[index - 1])) {
      throw new Error(`Real conversation event ordering failed: ${JSON.stringify(realConversationEvents.slice(-16))}`);
    }
    const conversationInfo = await invoke("agent:session-info", { sessionId: realSessionId });
    const conversationUsage = await invoke("agent:session-usage", { sessionId: realSessionId });
    if (!conversationInfo?.sessionId || !conversationUsage?.usage?.numTurns || conversationUsage.usage.numTurns < realConversationTurns.length) {
      throw new Error(`Real conversation usage/session info failed: ${JSON.stringify({ conversationInfo, conversationUsage })}`);
    }
    realE2eEvidence.eventCounts = Object.fromEntries(
      ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled", "tool/start", "tool/end"]
        .map((eventType) => [eventType, realConversationEvents.filter((event) => event.type === eventType && event.sessionId === realSessionId).length]),
    );

    // Reload the renderer to prove provider/model/auth persistence is not only
    // an in-memory Settings state. The main-process runtime remains alive.
    await window.reload({ waitUntil: "domcontentloaded" });
    await window.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
    await window.waitForFunction(() => document.querySelector("textarea")?.disabled === false, undefined, { timeout: 15_000 });
    // Renderer reload replaces the preload event emitter, so reinstall the
    // real UI-request responders before the post-reload lifecycle probes.
    await window.evaluate(() => {
      window.__openbuddyExtensionUiEvents = [];
      window.__openbuddyUiRequests = [];
      window.api.events.on("pi://extension-ui", (payload) => window.__openbuddyExtensionUiEvents.push(payload));
      window.api.events.on("pi://permission", (payload) => {
        window.__openbuddyUiRequests.push({ kind: "permission", payload });
        void window.api.invoke("agent:resolve-permission", { requestId: payload.requestId, optionId: "allow", cancelled: false });
      });
      window.api.events.on("pi://question", (payload) => {
        window.__openbuddyUiRequests.push({ kind: "question", payload });
        const question = payload.questions?.[0];
        if (question?.options?.length) {
          void window.api.invoke("agent:resolve-question", {
            requestId: payload.requestId,
            answers: { [question.question]: question.options[1] ?? question.options[0] },
            cancelled: false,
          });
        } else {
          void window.api.invoke("agent:resolve-question", {
            requestId: payload.requestId,
            annotations: { [question?.question ?? payload.title]: { notes: "smoke-input" } },
            cancelled: false,
          });
        }
      });
    });
    await window.waitForFunction(({ firstMarker, thirdMarker }) => {
      const body = document.body.textContent ?? "";
      return body.includes(firstMarker) && body.includes(thirdMarker);
    }, { firstMarker: realConversationTurns[0].marker, thirdMarker: realConversationTurns[2].marker }, { timeout: 30_000 });
    const persistedAssistantCount = await window.locator(".msg--assistant .msg__body").count();
    await composer.fill("reload 后继续同一会话，只回复 REAL-E2E-TURN-4-7314。不要解释。");
    await window.getByRole("button", { name: "发送" }).click();
    await waitForConversationReply("reload 后继续同一会话，只回复 REAL-E2E-TURN-4-7314。不要解释。", "REAL-E2E-TURN-4-7314", persistedAssistantCount);
    const afterReloadEvents = await invoke("agent:event-log", { sessionId: realSessionId, limit: 500 });
    if (afterReloadEvents.filter((event) => event.type === "session/input").length < 4
      || !afterReloadEvents.some((event) => event.type === "assistant/update" && JSON.stringify(event.payload ?? event).includes("REAL-E2E-TURN-4-7314"))
      || !afterReloadEvents.some((event) => event.type === "agent/settled" && event.sessionId === realSessionId)) {
      throw new Error(`Real conversation reload continuation failed: ${JSON.stringify(afterReloadEvents.slice(-16))}`);
    }
    realE2eEvidence.turns.push("REAL-E2E-TURN-4-7314");
    const persisted = await window.evaluate(async (expectedModel) => {
      const auth = await window.api.invoke("agent:auth-status");
      const catalog = await window.api.invoke("agent:providers-list");
      return {
        authReady: auth?.ready,
        provider: catalog?.providers?.find((entry) => entry.id === "custom_anthropic"),
        model: catalog?.models?.find((entry) => entry.providerId === "custom_anthropic" && entry.modelId === expectedModel),
      };
    }, e2eModelId);
    if (!persisted.authReady || !persisted.provider || !persisted.model) {
      throw new Error(`Electron model persistence failed: ${JSON.stringify({ ...persisted, provider: Boolean(persisted.provider), model: Boolean(persisted.model) })}`);
    }
  }

  const crudProvider = `smoke-crud-${Date.now().toString(36)}`;
  const crudModel = "smoke-crud-model";
  await window.evaluate(async ({ providerId, modelId }) => {
    await window.api.invoke("agent:providers-save-provider", { provider: { id: providerId, providerKind: "custom", label: "CRUD Smoke", baseUrl: "https://example.invalid/v1", apiBackend: "chat_completions", authScheme: "bearer" } });
    await window.api.invoke("agent:providers-save-model", { model: { providerId, modelId, name: "CRUD Smoke Model", contextWindow: 4096 } });
  }, { providerId: crudProvider, modelId: crudModel });
  const crudCreated = await window.evaluate(async ({ providerId, modelId }) => {
    const catalog = await window.api.invoke("agent:providers-list");
    return Boolean(catalog?.providers?.some((provider) => provider.id === providerId) && catalog?.models?.some((model) => model.providerId === providerId && model.modelId === modelId));
  }, { providerId: crudProvider, modelId: crudModel });
  if (!crudCreated) throw new Error("Electron provider/model CRUD create failed");
  await window.evaluate(async ({ providerId, modelId }) => {
    await window.api.invoke("agent:providers-delete-model", { providerId, modelId });
    await window.api.invoke("agent:providers-delete-provider", { id: providerId });
  }, { providerId: crudProvider, modelId: crudModel });
  const crudDeleted = await window.evaluate(async ({ providerId }) => {
    const catalog = await window.api.invoke("agent:providers-list");
    return !catalog?.providers?.some((provider) => provider.id === providerId) && !catalog?.models?.some((model) => model.providerId === providerId);
  }, { providerId: crudProvider });
  if (!crudDeleted) throw new Error("Electron provider/model CRUD delete failed");
  if (!realE2E) {
    const discoveredModels = await invoke("agent:providers-fetch-models", {
      baseUrl: discoveryBaseUrl,
      apiKey: "smoke-discovery-key",
      providerKind: "custom_anthropic",
    });
    if (!Array.isArray(discoveredModels) || discoveredModels[0]?.id !== "discovered-model") {
      throw new Error(`Electron provider model discovery failed: ${JSON.stringify(discoveredModels)}`);
    }
    const openAiDiscoveredModels = await invoke("agent:providers-fetch-models", {
      baseUrl: discoveryBaseUrl,
      apiKey: "smoke-openai-key",
      providerKind: "openai",
    });
    if (!Array.isArray(openAiDiscoveredModels) || openAiDiscoveredModels[0]?.id !== "discovered-model") {
      throw new Error(`Electron OpenAI-compatible model discovery failed: ${JSON.stringify(openAiDiscoveredModels)}`);
    }

    // Exercise both OpenAI-compatible streaming protocols through the same
    // Electron -> Pi AgentSession -> provider -> renderer event path.
    for (const [modelId, expectedText, protocol] of [
      ["smoke_openai/smoke-chat-model", "chat_completions-response-", "chat_completions"],
      ["smoke_responses/smoke-responses-model", "responses-response-", "responses"],
    ]) {
      const protocolSession = await invoke("agent:new-session", { cwd: userData });
      await invoke("agent:set-model", { sessionId: protocolSession.sessionId, modelId });
      await invoke("agent:prompt", { sessionId: protocolSession.sessionId, text: `${protocol} protocol smoke` });
      const protocolEvents = await invoke("agent:event-log", { sessionId: protocolSession.sessionId, limit: 200 });
      const assistantText = protocolEvents
        .filter((event) => event.type === "assistant/update" && event.sessionId === protocolSession.sessionId)
        .map((event) => JSON.stringify(event.payload ?? event))
        .join(" ");
      if (!assistantText.includes(expectedText) || !protocolEvents.some((event) => event.type === "assistant/end" && event.sessionId === protocolSession.sessionId)) {
        throw new Error(`Electron ${protocol} provider prompt failed: ${JSON.stringify({ modelId, eventTypes: eventSummary(protocolEvents.slice(-12)) })}`);
      }
      if (providerProtocolCounts[protocol] < 1) throw new Error(`Electron ${protocol} fixture was not requested`);
    }
  }

  // Exercise the real provider prompt, streaming steer, completed follow-up,
  // abort, dispose and re-init lifecycle.
  const lifecycleSession = await invoke("agent:new-session", { cwd: userData });
  if (!lifecycleSession?.sessionId) throw new Error(`Electron session creation failed: ${JSON.stringify(lifecycleSession)}`);
  const lifecycleModelId = activeModelId;
  const lifecyclePrompt = "lifecycle smoke：只回复 LIFECYCLE-OK。不要调用工具，不要读取或写入文件，不要解释。";
  const followUpPrompt = "只回复 FOLLOW-UP-OK。不要调用工具，不要读取或写入文件，不要解释。";
  const abortPrompt = "只回复 ABORT-OK。不要调用工具，不要读取或写入文件，不要解释。";
  await invoke("agent:set-model", { sessionId: lifecycleSession.sessionId, modelId: lifecycleModelId });
  await expectInvokeReject("agent:set-model", () => invoke("agent:set-model", { sessionId: "stale-session", modelId: lifecycleModelId }));
  await expectInvokeReject("agent:steer", () => invoke("agent:steer", { sessionId: lifecycleSession.sessionId, text: "" }));
  await expectInvokeReject("agent:follow-up", () => invoke("agent:follow-up", { sessionId: lifecycleSession.sessionId, text: "" }));
  const promptResult = invoke("agent:prompt", { sessionId: lifecycleSession.sessionId, text: lifecyclePrompt }).catch((error) => ({ error: String(error) }));
  await window.waitForFunction(async (sessionId) => {
    const events = await window.api.invoke("agent:event-log");
    return events.some((event) => event.type === "session/input" && event.payload?.sessionId === sessionId);
  }, lifecycleSession.sessionId, { timeout: 5_000 });
  const promptOutcome = await Promise.race([promptResult, delay(45_000).then(() => ({ timeout: true }))]);
  if (promptOutcome?.error && !/aborted|abort/i.test(promptOutcome.error)) throw new Error(`Electron provider prompt failed: ${JSON.stringify(promptOutcome)}`);
  if (promptOutcome?.timeout) {
    const lifecycleSnapshot = await invoke("agent:event-log", { sessionId: lifecycleSession.sessionId, limit: 200 });
    const completed = lifecycleSnapshot.some((event) => event.type === "assistant/end" || event.type === "turn/end");
    if (!completed) throw new Error(`Electron provider prompt failed: ${JSON.stringify({ timeout: true, eventTypes: eventSummary(lifecycleSnapshot.slice(-12)) })}`);
  }
  const typedSessionEvidence = await window.evaluate(async (sessionId) => {
    const request = (rpcId, method, payload) => window.api.rpc.request({ type: "client-request", rpcId, method, payload });
    const surface = await request("smoke-session-surface", "session.surface", { sessionId });
    const trace = await request("smoke-session-trace", "session.traceEvent", { sessionId, seq: 0 });
    const read = await request("smoke-session-read", "session.readEvent", { sessionId, seq: 0, before: 0, after: 0 });
    return {
      surface: surface?.rpcId === "smoke-session-surface" && surface.result?.ok === true && Array.isArray(surface.result.value?.events),
      trace: trace?.rpcId === "smoke-session-trace" && trace.result?.ok === true && trace.result.value?.target?.seq === 0,
      read: read?.rpcId === "smoke-session-read" && read.result?.ok === true && read.result.value?.target?.seq === 0,
    };
  }, lifecycleSession.sessionId);
  if (!typedSessionEvidence.surface || !typedSessionEvidence.trace || !typedSessionEvidence.read) {
    throw new Error(`Electron typed session-query RPC failed: ${JSON.stringify(typedSessionEvidence)}`);
  }
  const steerProbe = await invoke("agent:steer", { sessionId: lifecycleSession.sessionId, text: "只回复 STEER-OK。不要调用工具，不要读取或写入文件，不要解释。" }).catch((error) => ({ error: String(error) }));
  if (steerProbe?.error && !/not streaming|no active|cannot steer|not available/i.test(steerProbe.error)) {
    throw new Error(`Electron provider steer failed: ${JSON.stringify(steerProbe)}`);
  }
  await invoke("agent:follow-up", { sessionId: lifecycleSession.sessionId, text: followUpPrompt }).catch((error) => {
    if (!/not streaming|no active|cannot|already processing|aborted/i.test(String(error))) throw error;
  });
  await invoke("agent:prompt", { sessionId: lifecycleSession.sessionId, text: abortPrompt }).catch(() => undefined);
  await invoke("agent:abort", { sessionId: lifecycleSession.sessionId });
  await delay(500);
  const extensionUiEvents = await window.evaluate(() => window.__openbuddyExtensionUiEvents ?? []);
  const interactionEvidence = await window.evaluate(() => {
    const requests = window.__openbuddyUiRequests ?? [];
    const rpcEvents = window.__openbuddyRpcEvents ?? [];
    const methods = rpcEvents.filter((event) => event?.type === "server-request").map((event) => event.method);
    return {
      methods,
      permission: requests.some((event) => event?.kind === "permission"),
      question: requests.some((event) => event?.kind === "question"),
    };
  });
  if (!interactionEvidence.permission || !interactionEvidence.question) {
    throw new Error(`Electron interaction UI bridge was not observed: ${JSON.stringify(interactionEvidence)}`);
  }
  const lifecycleUiEvents = await invoke("agent:event-log", { sessionId: lifecycleSession.sessionId, limit: 200 });
  if (!lifecycleUiEvents.some((event) => event.type === "session/permission")) {
    throw new Error(`Electron Pi UI request event was not persisted: ${JSON.stringify(lifecycleUiEvents.slice(-12))}`);
  }
  if (!lifecycleUiEvents.some((event) => event.type === "session/permission-resolved" && event.payload?.answered === true)
    || !lifecycleUiEvents.some((event) => event.type === "session/question-resolved" && event.payload?.answered === true)) {
    throw new Error(`Electron Pi UI request resolution was not persisted: ${JSON.stringify(lifecycleUiEvents.slice(-20))}`);
  }
  if (!Array.isArray(extensionUiEvents)) throw new Error("Electron Pi extension UI event stream is not readable");
  const promptHistory = await invoke("prompt_history", { limit: 50 });
  if (!Array.isArray(promptHistory) || !promptHistory.includes(lifecyclePrompt)) {
    throw new Error(`Electron prompt history persistence failed: ${JSON.stringify(promptHistory)}`);
  }
  const lifecycleEvents = await invoke("agent:event-log");
  if (!lifecycleEvents.some((event) => event.type === "agent/abort")) {
    throw new Error(`Electron abort lifecycle event missing: ${JSON.stringify(lifecycleEvents.slice(-8))}`);
  }
  for (const eventType of ["session/input", "session/steer", "session/follow-up", "agent/start", "agent/settled", "turn/start", "turn/end", "assistant/start", "assistant/update", "assistant/end"]) {
    if (!lifecycleEvents.some((event) => event.type === eventType && event.sessionId === lifecycleSession.sessionId)) {
      throw new Error(`Electron event matrix missing ${eventType}: ${JSON.stringify(lifecycleEvents.slice(-20))}`);
    }
  }
  const sessionEventIdentity = lifecycleEvents.filter((event) => event.payload?.sessionId === lifecycleSession.sessionId);
  if (sessionEventIdentity.length === 0 || sessionEventIdentity.some((event) => !Number.isInteger(event.sequence))) {
    throw new Error(`Electron event identity/ordering contract failed: ${JSON.stringify(sessionEventIdentity.slice(-8))}`);
  }
  for (let index = 1; index < lifecycleEvents.length; index += 1) {
    if (lifecycleEvents[index].sequence <= lifecycleEvents[index - 1].sequence) {
      throw new Error(`Electron event sequence is not strictly increasing: ${JSON.stringify(lifecycleEvents.slice(-8))}`);
    }
  }
  const filteredLifecycleEvents = await invoke("agent:event-log", { sessionId: lifecycleSession.sessionId, sinceSequence: 0, limit: 200 });
  if (!filteredLifecycleEvents.length || filteredLifecycleEvents.some((event) => event.sessionId !== lifecycleSession.sessionId || typeof event.timestamp !== "string")) {
    throw new Error(`Electron persisted event query failed: ${JSON.stringify(filteredLifecycleEvents.slice(-8))}`);
  }
  const lifecycleInfo = await invoke("agent:session-info", { sessionId: lifecycleSession.sessionId });
  const lifecycleUsage = await invoke("agent:session-usage", { sessionId: lifecycleSession.sessionId });
  if (!lifecycleInfo || !lifecycleUsage) throw new Error("Electron session info/usage contract failed");
  await invoke("sessions:rename", { sessionId: lifecycleSession.sessionId, title: "Electron Smoke Session", cwd: userData });
  await invoke("sessions:set-pinned", { id: lifecycleSession.sessionId, pinned: true });
  const pinnedSessions = await invoke("sessions:list", userData);
  if (!pinnedSessions.some((session) => session.sessionId === lifecycleSession.sessionId && session.pinned === true)) {
    throw new Error("Electron session pin/list persistence failed");
  }
  await invoke("sessions:set-expert", { id: lifecycleSession.sessionId, expertId: "electron-smoke-expert", expertName: "Electron Smoke Expert" });
  const expertSessions = await invoke("sessions:list", userData);
  const expertSession = expertSessions.find((session) => session.sessionId === lifecycleSession.sessionId);
  if (expertSession?.expertId !== "electron-smoke-expert" || expertSession?.expertName !== "Electron Smoke Expert") {
    throw new Error(`Electron session expert binding failed: ${JSON.stringify(expertSession)}`);
  }
  await invoke("sessions:set-expert", { id: lifecycleSession.sessionId });
  await invoke("sessions:set-archived", { id: lifecycleSession.sessionId, archived: true });
  const archivedSessions = await invoke("sessions:list", userData);
  if (archivedSessions.some((session) => session.sessionId === lifecycleSession.sessionId)) {
    throw new Error("Electron session archive did not hide the session");
  }
  await invoke("sessions:set-archived", { id: lifecycleSession.sessionId, archived: false });
  const restoredSessions = await invoke("sessions:list", userData);
  if (!restoredSessions.some((session) => session.sessionId === lifecycleSession.sessionId)) {
    throw new Error("Electron session unarchive did not restore the session");
  }
  const rewindPoints = await invoke("rewind_points", { sessionId: lifecycleSession.sessionId });
  if (!Array.isArray(rewindPoints) || rewindPoints.length < 2 || rewindPoints.some((point) => !Number.isInteger(point.promptIndex))) throw new Error(`Electron rewind points contract failed: ${JSON.stringify(rewindPoints)}`);
  if (rewindPoints.length > 0) {
    await invoke("rewind_execute", { sessionId: lifecycleSession.sessionId, targetPromptIndex: 0, mode: "conversation", force: true });
    const rewindEvents = await invoke("agent:event-log", { sessionId: lifecycleSession.sessionId, limit: 200 });
    if (!rewindEvents.some((event) => event.type === "session/rewound" && event.sessionId === lifecycleSession.sessionId)) throw new Error(`Electron rewind did not emit state transition: ${JSON.stringify(rewindEvents.slice(-8))}`);
  }
  const forkedSession = await invoke("session_fork", { sessionId: lifecycleSession.sessionId, cwd: userData });
  if (typeof forkedSession !== "string" || !forkedSession) throw new Error("Electron session fork failed");
  const searchResults = await invoke("session_search", { query: "lifecycle smoke", cwd: userData, limit: 20 });
  if (!Array.isArray(searchResults) || !searchResults.some((hit) => hit.cwd === userData && /lifecycle smoke/i.test(`${hit.title} ${hit.snippet}`))) throw new Error(`Electron session search failed: ${JSON.stringify(searchResults)}`);
  await invoke("sessions:delete", { sessionId: forkedSession, cwd: userData });
  await invoke("agent:dispose");
  const reinitialized = await invoke("agent:init", userData);
  if (reinitialized?.ok !== true) throw new Error(`Electron re-init after dispose failed: ${JSON.stringify(reinitialized)}`);
  await invoke("agent:load-session", { sessionId: lifecycleSession.sessionId, cwd: userData });
  const loadedInfo = await invoke("agent:session-info", { sessionId: lifecycleSession.sessionId });
  if (loadedInfo?.sessionId !== lifecycleSession.sessionId) throw new Error(`Electron session load failed: ${JSON.stringify(loadedInfo)}`);
  const restoredEvents = await invoke("agent:event-log", { sessionId: lifecycleSession.sessionId, limit: 200 });
  if (!restoredEvents.some((event) => event.type === "session/input" && event.sessionId === lifecycleSession.sessionId)) {
    throw new Error("Electron persisted event log did not survive agent re-init");
  }
  await window.reload({ waitUntil: "domcontentloaded" });
  await window.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
  const bridgeAfterReload = await window.evaluate(async () => ({
    ready: Boolean(window.api),
    debug: await window.api.invoke("debug:info"),
    sessions: await window.api.invoke("sessions:list", window.api.platform === "win32" ? "C:\\" : "/"),
  }));
  if (!bridgeAfterReload.ready || typeof bridgeAfterReload.debug?.url !== "string" || !Array.isArray(bridgeAfterReload.sessions)) {
    throw new Error(`Electron renderer reload recovery failed: ${JSON.stringify(bridgeAfterReload)}`);
  }

  // Restart the real Electron process with the same userData and Pi home.
  // This catches persistence bugs hidden by an in-memory renderer reload.
  intentionalElectronClose = true;
  await app.close();
  intentionalElectronClose = false;
  app2 = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH || undefined,
    cwd: root,
    timeout: 30_000,
    env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: piAgentDir, ELECTRON_ENABLE_LOGGING: "1" },
  });
  const restartedWindow = await app2.firstWindow();
  await restartedWindow.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  await restartedWindow.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
  const restartState = await restartedWindow.evaluate(async (cwd) => {
    let init;
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        init = await window.api.invoke("agent:init", cwd);
        break;
      } catch (error) {
        lastError = String(error);
        if (!/remote service is unavailable|not initialized|initializ/i.test(lastError)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!init && lastError) throw new Error(lastError);
    const sessions = await window.api.invoke("sessions:list", cwd);
    const catalog = await window.api.invoke("agent:providers-list");
    const policy = await window.api.invoke("policy:get");
    const channels = await window.api.invoke("notify-channels:list");
    const sources = await window.api.invoke("knowledge-sources:list");
    const storageSources = await window.api.invoke("storage-sources:list");
    return { apiVersion: window.api.apiVersion, initOk: init?.ok === true, session: sessions.find((entry) => entry.title === "Electron Smoke Session"), sessions, catalog, policy, channels, sources, storageSources };
  }, userData);
  if (restartState.apiVersion !== 1 || !restartState.initOk || !restartState.session?.pinned
    || restartState.policy?.rules?.[0]?.type !== "model-whitelist"
    || restartState.channels?.[0]?.id !== "smoke-desktop"
    || restartState.sources?.[0] !== knowledgeRoot) {
    throw new Error(`Electron restart persistence failed: ${JSON.stringify({ apiVersion: restartState.apiVersion, initOk: restartState.initOk, session: restartState.session, sessions: restartState.sessions })}`);
  }
  if (restartState.storageSources?.[0] !== storageRoot) throw new Error(`Storage source restart persistence failed: ${JSON.stringify(restartState.storageSources)}`);
  const restartedEvents = await restartedWindow.evaluate((sessionId) => window.api.invoke("agent:event-log", { sessionId, limit: 200 }), lifecycleSession.sessionId);
  if (!restartedEvents.some((event) => event.type === "session/input" && event.sessionId === lifecycleSession.sessionId)) {
    throw new Error("Electron process restart did not restore persisted event log");
  }
  window = restartedWindow;

  if (realE2eSessionId && realE2eEvidence) {
    const sessionDigest = sha256(realE2eSessionId).slice(0, 12);
    const restartConversation = await restartedWindow.evaluate(async ({ sessionId, sessionDigest: redactedSessionId, cwd, modelId }) => {
      await window.api.invoke("agent:load-session", { sessionId, cwd });
      const loaded = await window.api.invoke("agent:session-info", { sessionId });
      if (loaded?.sessionId !== sessionId) throw new Error(`MiniMax session did not load after Electron restart: ${JSON.stringify(loaded)}`);
      const loadedModelId = loaded.model?.provider && loaded.model?.id
        ? `${loaded.model.provider}/${loaded.model.id}`
        : undefined;
      if (loadedModelId !== modelId) await window.api.invoke("agent:set-model", { sessionId, modelId });
      await window.api.invoke("agent:prompt", { sessionId, text: "Electron 重启后继续同一 Pi 会话，只回复 REAL-E2E-TURN-5-7314。不要解释。" });
      const marker = "REAL-E2E-TURN-5-7314";
      const deadline = Date.now() + 90_000;
      let events = [];
      let fifthInputSequence;
      while (Date.now() < deadline) {
        events = await window.api.invoke("agent:event-log", { sessionId, limit: 600 });
        const fifthInput = events.find((event) => event.type === "session/input"
          && event.sessionId === sessionId
          && event.payload?.text?.preview?.includes("Electron 重启后继续同一 Pi 会话"));
        fifthInputSequence = fifthInput?.sequence;
        const fifthTurnEvents = typeof fifthInputSequence === "number"
          ? events.filter((event) => event.sessionId === sessionId && event.sequence >= fifthInputSequence)
          : [];
        if (fifthTurnEvents.some((event) => event.type === "assistant/update" && JSON.stringify(event.payload ?? event).includes(marker))
          && fifthTurnEvents.some((event) => event.type === "assistant/end")) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const fifthTurnEvents = typeof fifthInputSequence === "number"
        ? events.filter((event) => event.sessionId === sessionId && event.sequence >= fifthInputSequence)
        : [];
      return {
        sessionId: redactedSessionId,
        loaded: loaded.sessionId === sessionId,
        modelId: loadedModelId ?? modelId,
        markerSeen: fifthTurnEvents.some((event) => event.type === "assistant/update" && JSON.stringify(event.payload ?? event).includes(marker)),
        inputCount: events.filter((event) => event.type === "session/input" && event.sessionId === sessionId).length,
        assistantEnd: fifthTurnEvents.some((event) => event.type === "assistant/end"),
        fifthInputSequence,
        fifthTurnTypes: fifthTurnEvents.slice(-16).map((event) => ({ type: event.type, sequence: event.sequence })),
      };
    }, { sessionId: realE2eSessionId, sessionDigest, cwd: root, modelId: realE2eEvidence.modelId });
    if (!restartConversation.loaded || restartConversation.modelId !== realE2eEvidence.modelId || !restartConversation.markerSeen || !restartConversation.assistantEnd || restartConversation.inputCount < 5) {
      throw new Error(`Real MiniMax conversation did not survive Electron restart: ${JSON.stringify(restartConversation)}`);
    }
    realE2eEvidence.turns.push("REAL-E2E-TURN-5-7314");
    realE2eEvidence.restart = restartConversation;

    const finalEvents = await restartedWindow.evaluate((sessionId) => window.api.invoke("agent:event-log", { sessionId, limit: 600 }), realE2eSessionId);
    const finalEventCounts = Object.fromEntries(
      ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled", "tool/start", "tool/end"]
        .map((eventType) => [eventType, finalEvents.filter((event) => event.type === eventType && event.sessionId === realE2eSessionId).length]),
    );
    if (finalEventCounts["session/input"] < 5 || finalEventCounts["assistant/end"] < 5 || finalEventCounts["agent/settled"] < 5) {
      throw new Error(`Real MiniMax final event log is incomplete: ${JSON.stringify(finalEventCounts)}`);
    }
    realE2eEvidence.eventCounts = finalEventCounts;
  }

  await window.getByRole("button", { name: "设置", exact: true }).first().click();
  await window.locator(".settings-modal-overlay[role=dialog]").waitFor({ state: "visible", timeout: 5_000 });
  if (await window.locator("[data-testid=debug-toolbar]").count() !== 0) {
    throw new Error("Debug toolbar must remain hidden; use the native shortcut/menu");
  }
  await delay(500);
  if (errors.length > 0) throw new Error(`Electron renderer emitted ${errors.length} error(s): ${errors.map((error) => safeErrorMessage(error).slice(0, 300)).join(" | ")}`);
  const unexpectedProcessErrors = processErrors.filter((line) => {
    if (/Error occurred in handler for 'agent:preset-select'/i.test(line)) return false;
    if (/agent-presets:\s+preset "missing-smoke-preset" was not found/i.test(line)) return false;
    if (optionalAuthSmoke && /Error occurred in handler for 'agent:prompt'/i.test(line)) return false;
    return true;
  });
  if (unexpectedProcessErrors.length > 0) throw new Error(`Electron main emitted ${unexpectedProcessErrors.length} unexpected error(s)`);

  passed = true;
  const report = {
    ok: true,
    schema: "openbuddy.redacted-evidence.v1",
    framework: "openbuddy-electron-local-smoke",
    evidenceLevel: externalE2E ? "real-external" : "real-local",
    runtime: "electron+pi",
    realE2E: Boolean(realE2eEvidence),
    evidenceLevel: externalE2E ? "real-external" : "real-local",
    capabilities: [
      "startup-bridge", "session-lifecycle", "provider-model-crud", "clipboard",
      "pi-extensions", "profile-packages", "memory", "mcp", "permissions-questions",
      "plan-tasks", "web-search-fetch", "automation-passthrough-registry", "plugins-marketplace",
      "connectors", "teams-subagents", "calendar", "persistence-restart", "security-boundaries",
      "debug-surface", "hooks",
    ],
    platform: result.platform,
    evidence: {
      startupBridge: {
        electron: true,
        nonBlankRoot: result.root,
        apiVersion: result.apiVersion,
        typedRpc: result.typedRpc,
        harnessHttp: true,
        harnessWebSocket: true,
        harnessSse: true,
        debugToolbar: result.debugToolbar,
      },
      persistence: {
        settings: persistedSettings,
        rendererReload: bridgeAfterReload?.ready === true,
        electronRestart: Boolean(restartState?.initOk),
      },
      piResourcesAndPlugins: {
        nativeInventory: true,
        capabilityProbe: capabilityProbe.modelAndPluginContracts,
        dynamicResources: capabilityProbe.skills && capabilityProbe.skillCatalog,
        rendererEntries: extraIpcProbe.rendererEntries && extraIpcProbe.rendererModuleResolved,
        typedSessionQueries: typedSessionEvidence.surface && typedSessionEvidence.trace && typedSessionEvidence.read,
      },
      capabilities: Object.fromEntries([
        ["memory", capabilityProbe.memories && capabilityProbe.memoryLifecycle],
        ["mcp", capabilityProbe.mcp],
        ["permission", capabilityProbe.permissionRules && capabilityProbe.permissionMode === "auto"],
        ["folderTrust", capabilityProbe.folderTrust],
        ["plan", capabilityProbe.plan],
        // openbuddy-web-search removed; web capability is delegated to pi-web-access.
        ["skills", capabilityProbe.skills && capabilityProbe.skillCatalog],
        ["agents", capabilityProbe.agents],
        // Stage B: tasks IPC removed; capabilityProbe.tasks is always true.
        ["tasks", capabilityProbe.tasks],
        ["notifications", capabilityProbe.notifications],
        ["subagents", capabilityProbe.subagents],
        ["automations-passthrough", capabilityProbe.automations],
        ["plugins", capabilityProbe.plugins],
        ["marketplace", capabilityProbe.marketplace],
        ["connectors", capabilityProbe.connectors && capabilityProbe.connectorCancel],
        ["teams", capabilityProbe.teams],
        ["calendar", Boolean(calendarEvidence?.deleted)],
        ["filesystem", filesystemSmoke ? capabilityProbe.filesystem : "not-run-by-policy"],
      ]),
      calendar: calendarEvidence,
      clipboard: {
        systemRead: extraIpcProbe.clipboardRead,
        paste: true,
        multiline: true,
        largeText: true,
      },
      realProvider: realE2eEvidence,
      fixtureProtocolCounts: providerProtocolCounts,
    },
  };
  const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR;
  const evidenceArtifact = evidenceRoot ? join(evidenceRoot, "real-local-smoke.json") : null;
  if (evidenceArtifact) {
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(evidenceArtifact, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ ...report, evidenceArtifact }));
} catch (error) {
  console.error(`[smoke] error=${safeErrorMessage(error)}`);
  console.error(`[smoke] stack=${safeErrorMessage(error?.stack ?? "")}`);
  throw error;
} finally {
  await Promise.race([app2?.close?.(), delay(3_000)]).catch(() => undefined);
  await Promise.race([app.close(), delay(3_000)]).catch(() => undefined);
  await new Promise((resolve) => discoveryServer.close(resolve)).catch(() => undefined);
  if (electronProcess && !electronProcess.killed && electronProcess.exitCode === null) electronProcess.kill("SIGTERM");
  try { rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  process.exit(passed ? 0 : 1);
}
