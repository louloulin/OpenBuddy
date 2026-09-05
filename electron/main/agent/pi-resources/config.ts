/**
 * P2-13: Application config + KB citation sub-module.
 *
 * Owns the per-user config JSON files (`settings.json`, `openbuddy-*.json`)
 * and the knowledge-base citation validator.
 *
 * The `@openbuddy/files-kb` office parser is dynamic-imported inside
 * `validateKnowledgeContextCitation` (P1-08) so we don't pull xlsx/docx/pdf
 * parsers into the cold-start entry chunk.
 */
import { basename, extname, isAbsolute, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { EmailAnalysisContextCitation } from "@openbuddy/capability-email";
import {
  agentRoot,
  assertResourcePath,
  readJson,
  writeJson,
} from "./shared";

export interface AgentDefaults {
  defaultModel: string;
  defaultPermission: string;
  rememberToolApprovals?: boolean;
}

const defaultAgentDefaults: AgentDefaults = {
  defaultModel: "",
  defaultPermission: "default",
  rememberToolApprovals: true,
};

export interface OpenBuddyPolicyConfig {
  rules: Array<{
    type: string;
    value: unknown;
    priority?: number;
    source?: string;
  }>;
}

export interface OpenBuddyNotifyChannel {
  id: string;
  label: string;
  kind: "slack-webhook" | "discord-webhook" | "generic-webhook" | "email" | "desktop";
  endpoint?: string;
  enabled: boolean;
}

export interface OpenBuddySubagentsConfig {
  maxDepth?: number;
}

export async function readAgentDefaults(): Promise<AgentDefaults> {
  const settings = await readJson<Record<string, unknown>>(join(agentRoot(), "settings.json"), {});
  const ui = (settings.ui && typeof settings.ui === "object" ? settings.ui : {}) as Record<string, unknown>;
  return {
    defaultModel: typeof settings.defaultModel === "string" ? settings.defaultModel : defaultAgentDefaults.defaultModel,
    defaultPermission: typeof ui.default_selected_permission === "string" ? ui.default_selected_permission : defaultAgentDefaults.defaultPermission,
    rememberToolApprovals: typeof ui.remember_tool_approvals === "boolean" ? ui.remember_tool_approvals : defaultAgentDefaults.rememberToolApprovals,
  };
}

export async function writeAgentDefaults(value: Partial<AgentDefaults>): Promise<AgentDefaults> {
  const file = join(agentRoot(), "settings.json");
  const settings = await readJson<Record<string, unknown>>(file, {});
  const current = await readAgentDefaults();
  const next = { ...current, ...value };
  settings.defaultModel = next.defaultModel;
  settings.ui = {
    ...(settings.ui && typeof settings.ui === "object" ? settings.ui : {}),
    default_selected_permission: next.defaultPermission,
    remember_tool_approvals: next.rememberToolApprovals,
  };
  await writeJson(file, settings);
  return next;
}

export async function readSubagentsConfig(): Promise<OpenBuddySubagentsConfig | null> {
  return readJson<OpenBuddySubagentsConfig | null>(join(agentRoot(), "openbuddy-subagents.json"), null);
}

export async function writeSubagentsConfig(config: OpenBuddySubagentsConfig): Promise<OpenBuddySubagentsConfig> {
  await writeJson(join(agentRoot(), "openbuddy-subagents.json"), config, 0o600);
  return config;
}

export async function readPolicyConfig(): Promise<OpenBuddyPolicyConfig> {
  return readJson<OpenBuddyPolicyConfig>(join(agentRoot(), "openbuddy-policy.json"), { rules: [] });
}

export async function writePolicyConfig(config: OpenBuddyPolicyConfig): Promise<OpenBuddyPolicyConfig> {
  await writeJson(join(agentRoot(), "openbuddy-policy.json"), config, 0o600);
  return config;
}

export async function readNotifyChannels(): Promise<OpenBuddyNotifyChannel[]> {
  return readJson<OpenBuddyNotifyChannel[]>(join(agentRoot(), "openbuddy-notify-channels.json"), []);
}

export async function writeNotifyChannels(channels: OpenBuddyNotifyChannel[]): Promise<OpenBuddyNotifyChannel[]> {
  await writeJson(join(agentRoot(), "openbuddy-notify-channels.json"), channels, 0o600);
  return channels;
}

export async function readKnowledgeSources(): Promise<string[]> {
  return readJson<string[]>(join(agentRoot(), "openbuddy-knowledge-sources.json"), []);
}

export async function writeKnowledgeSources(sources: string[]): Promise<string[]> {
  await writeJson(join(agentRoot(), "openbuddy-knowledge-sources.json"), sources, 0o600);
  return sources;
}

export async function validateKnowledgeContextCitation(input: {
  sourceId: string;
  sourcePath?: string;
  quote?: string;
}): Promise<EmailAnalysisContextCitation> {
  // P1-08: dynamic-import the KB / Office parser module. The user only
  // reaches this path when validating a knowledge citation, which is
  // typically a few times per email analysis, not per chat turn.
  const { extractOfficeText, isAnyKnowledgeFile, isOfficeFile } = await import("@openbuddy/files-kb");
  const configuredRoots = (await readKnowledgeSources()).filter((root): root is string => typeof root === "string" && isAbsolute(root));
  const requestedPath = input.sourcePath?.trim() || input.sourceId.trim();
  if (!requestedPath || !isAbsolute(requestedPath)) throw new Error("知识库引用必须指向已授权根目录下的绝对路径");
  const safePath = await assertResourcePath(requestedPath, configuredRoots);
  if (!isAnyKnowledgeFile(basename(safePath))) throw new Error("知识库引用文件类型不受支持");
  const bytes = isOfficeFile(safePath) ? await readFile(safePath) : undefined;
  const text = bytes ? extractOfficeText(bytes, safePath) : await readFile(safePath, "utf8");
  if (text === null || text === undefined) throw new Error("知识库引用文件无法读取");
  if (input.quote?.trim()) {
    const normalizedText = text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const normalizedQuote = input.quote.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (!normalizedQuote || !normalizedText.includes(normalizedQuote)) throw new Error("知识库引用摘录不属于真实文件内容");
  }
  return {
    sourceId: safePath,
    sourceTitle: basename(safePath, extname(safePath)),
    sourcePath: safePath,
    ...(input.quote?.trim() ? { quote: input.quote.slice(0, 1000) } : {}),
  };
}

export async function readStorageSources(): Promise<string[]> {
  return readJson<string[]>(join(agentRoot(), "openbuddy-storage-sources.json"), []);
}

export async function writeStorageSources(sources: string[]): Promise<string[]> {
  await writeJson(join(agentRoot(), "openbuddy-storage-sources.json"), sources, 0o600);
  return sources;
}
