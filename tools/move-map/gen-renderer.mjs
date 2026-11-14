#!/usr/bin/env node
// Generates the renderer move maps M7–M10 (20261115-md §6.2) from explicit rules.
// Every file under src/ gets a destination; nothing is deleted. Tests follow the module they
// test (`<subject dir>/__tests__/`), inferred from the test's name or its first internal import.
//   node tools/move-map/gen-renderer.mjs   → writes tools/move-map/M7..M10-*.json
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const files = execFileSync('git', ['ls-files', 'src', 'index.html', 'public', 'vite.config.ts'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
const W = 'apps/web/src';
const F = n => `${W}/features/${n}`;

// [match (exact path or prefix ending in "/"), destination (file or prefix)]
const RULES = [
  // ---------- packages (M7–M9) ----------
  ['src/lib/ipc.ts', 'packages/client/src/ipc.ts'],
  ['src/lib/agent-client.ts', 'packages/client/src/agent-client.ts'],
  ['src/lib/types.ts', 'packages/protocol/src/dto.ts'],
  ['src/lib/platform.ts', 'packages/platform/src/platform.ts'],
  ['src/lib/clipboard.ts', 'packages/platform/src/clipboard.ts'],
  ['src/foundation/components/Icon/', 'packages/ui/src/icon/'],
  ['src/components/Toast.tsx', 'packages/ui/src/Toast.tsx'],
  ['src/components/ImageLightbox.tsx', 'packages/ui/src/ImageLightbox.tsx'],
  ['src/components/ThemeProvider.tsx', 'packages/ui/src/ThemeProvider.tsx'],
  ['src/styles/tokens.css', 'packages/ui/src/styles/tokens.css'],
  ['src/styles/global.css', 'packages/ui/src/styles/global.css'],
  ['src/components/markdown/', 'packages/markdown/src/'],
  ['src/lib/markdown-blocks.ts', 'packages/markdown/src/markdown-blocks.ts'],
  ['src/lib/markdown-host.ts', 'packages/markdown/src/markdown-host.ts'],
  ...['user-text', 'unified-diff', 'error-format', 'tool-summary', 'export-markdown', 'share', 'extract-text', 'file-changes',
    'session-artifacts', 'command-risk', 'token-estimate', 'timeline-utils', 'tool-renderers', 'plan-utils', 'content-blocks']
    .map(n => [`src/lib/${n}.ts`, `packages/chat-core/src/${n}.ts`]),
  ['src/components/chat/turns.ts', 'packages/chat-core/src/turns.ts'],

  // ---------- apps/web: app shell ----------
  ['index.html', 'apps/web/index.html'],
  ['public/', 'apps/web/public/'],
  ['vite.config.ts', 'apps/web/vite.config.ts'],
  ['src/main.tsx', `${W}/app/main.tsx`],
  ['src/App.tsx', `${W}/app/App.tsx`],
  ['src/__tests__/', `${W}/app/__tests__/`],
  ['src/test-setup.ts', `${W}/test-setup.ts`],
  ['src/types/', `${W}/types/`],
  ['src/assets/', `${W}/assets/`],
  ['src/components/PlaceholderPage.tsx', `${W}/app/routing/PlaceholderPage.tsx`],
  ['src/components/TitleBar.tsx', `${W}/app/shell/TitleBar.tsx`],
  ['src/components/TopbarTitle.tsx', `${W}/app/shell/TopbarTitle.tsx`],
  ['src/components/TopbarActions.tsx', `${W}/app/shell/TopbarActions.tsx`],
  ['src/components/ShortcutsPanel.tsx', `${W}/app/palette/ShortcutsPanel.tsx`],
  ['src/components/SearchOverlay.tsx', `${W}/app/palette/SearchOverlay.tsx`],
  ['src/lib/app-version.ts', `${W}/app/app-version.ts`],
  ['src/stores/ui-prefs-store.ts', `${W}/app/state/ui-prefs-store.ts`],
  ['src/stores/unseen-store.ts', `${W}/app/state/unseen-store.ts`],
  ['src/styles/', `${W}/styles/`],

  // ---------- apps/web: shared ----------
  ['src/components/AppDialog.tsx', `${W}/shared/ui/AppDialog.tsx`],
  ['src/components/experts-panel/shared/ThumbImg.tsx', `${W}/shared/ui/ThumbImg.tsx`],
  ['src/components/experts-panel/shared/LetterAvatar.tsx', `${W}/shared/ui/LetterAvatar.tsx`],
  ['src/components/Markdown.tsx', `${W}/shared/Markdown.tsx`],
  ['src/components/ToolCallCard.tsx', `${W}/shared/agent-ui/ToolCallCard.tsx`],
  ['src/components/chat/icons.tsx', `${W}/shared/agent-ui/icons.tsx`],
  ['src/components/home-scenes.ts', `${W}/shared/content/home-scenes.ts`],
  ['src/components/use-horizontal-scroll.ts', `${W}/shared/hooks/use-horizontal-scroll.ts`],
  ['src/lib/shortcuts.ts', `${W}/shared/lib/shortcuts.ts`],
  ...['drop-utils', 'file-kind', 'file-utils', 'doc-preview', 'zip-reader'].map(n => [`src/lib/${n}.ts`, `${W}/shared/lib/files/${n}.ts`]),
  ['src/lib/telemetry-contract.ts', `${W}/shared/telemetry/telemetry-contract.ts`],
  ['src/lib/otlp-exporter.ts', `${W}/shared/telemetry/otlp-exporter.ts`],
  ['src/lib/oidc-auth.ts', `${W}/shared/auth/oidc-auth.ts`],
  ['src/lib/sandbox-guard.ts', `${W}/shared/security/sandbox-guard.ts`],
  ['src/lib/sandbox-init.ts', `${W}/shared/security/sandbox-init.ts`],
  ['src/lib/container-executor.ts', `${W}/shared/security/container-executor.ts`],

  // ---------- apps/web: features ----------
  // chat
  ['src/components/ChatView.tsx', `${F('chat')}/ChatView.tsx`],
  ['src/components/chat/', `${F('chat')}/`],
  ['src/components/LoadingRow.tsx', `${F('chat')}/LoadingRow.tsx`],
  ['src/components/FindBar.tsx', `${F('chat')}/FindBar.tsx`],
  ['src/components/ShareMenu.tsx', `${F('chat')}/ShareMenu.tsx`],
  ['src/components/FeedbackDialog.tsx', `${F('chat')}/FeedbackDialog.tsx`],
  ['src/components/PlanPanel.tsx', `${F('chat')}/PlanPanel.tsx`],
  ['src/lib/use-smooth-text.ts', `${F('chat')}/use-smooth-text.ts`],
  ['src/lib/loading-tips.ts', `${F('chat')}/loading-tips.ts`],
  ['src/stores/session-store.ts', `${F('chat')}/state/session-store.ts`],
  ['src/stores/feedback-store.ts', `${F('chat')}/state/feedback-store.ts`],
  // composer
  ...['Composer', 'SlashCommands', 'InputAddMenu', 'WorkspacePicker', 'ContextUsagePill', 'QueuePanel'].map(n => [`src/components/${n}.tsx`, `${F('composer')}/${n}.tsx`]),
  ['src/lib/input-history.ts', `${F('composer')}/input-history.ts`],
  ['src/lib/voice-contract.ts', `${F('composer')}/voice-contract.ts`],
  ['src/stores/pi-queue-store.ts', `${F('composer')}/state/pi-queue-store.ts`],
  ['src/stores/message-queue-store.ts', `${F('composer')}/state/message-queue-store.ts`],
  // approvals
  ...['PermissionDialog', 'PermissionPicker', 'QuestionInlineCard', 'FolderTrustDialog'].map(n => [`src/components/${n}.tsx`, `${F('approvals')}/${n}.tsx`]),
  ...['permission-store', 'question-store', 'extension-ui-store'].map(n => [`src/stores/${n}.ts`, `${F('approvals')}/state/${n}.ts`]),
  // sessions
  ['src/components/Sidebar.tsx', `${F('sessions')}/Sidebar.tsx`],
  ['src/components/sidebar/', `${F('sessions')}/sidebar/`],
  ['src/components/SecondarySidebar.tsx', `${F('sessions')}/SecondarySidebar.tsx`],
  ['src/components/TasksPanel.tsx', `${F('sessions')}/TasksPanel.tsx`],
  ['src/stores/sessions-store.ts', `${F('sessions')}/state/sessions-store.ts`],
  ['src/lib/ensure-session.ts', `${F('sessions')}/ensure-session.ts`],
  // workbench
  ['src/components/bench/', `${F('workbench')}/`],
  ['src/components/workspace-panel/', `${F('workbench')}/workspace-panel/`],
  ...['FilePreview', 'BrowserPreview', 'FileChangesPanel', 'ToolSidePanel'].map(n => [`src/components/${n}.tsx`, `${F('workbench')}/${n}.tsx`]),
  ['src/lib/browser-preview.ts', `${F('workbench')}/browser-preview.ts`],
  ['src/lib/use-unified-tabs.ts', `${F('workbench')}/use-unified-tabs.ts`],
  ['src/stores/artifacts-store.ts', `${F('workbench')}/state/artifacts-store.ts`],
  // models
  ['src/components/ModelSelector.tsx', `${F('models')}/ModelSelector.tsx`],
  ['src/components/models-settings/', `${F('models')}/settings/`],
  ['src/stores/agent-model-store.ts', `${F('models')}/state/agent-model-store.ts`],
  // settings
  ...['SettingsPanel', 'SettingsSections', 'AboutDialog', 'NotifyChannelsPanel', 'PolicySettingsPanel', 'UsageQuotaPanel'].map(n => [`src/components/${n}.tsx`, `${F('settings')}/${n}.tsx`]),
  ...['notify-channels', 'policy-engine', 'usage-quota'].map(n => [`src/lib/${n}.ts`, `${F('settings')}/${n}.ts`]),
  // agent-resources
  ['src/components/AgentResourcesPanel.tsx', `${F('agent-resources')}/AgentResourcesPanel.tsx`],
  ['src/components/TrustedExtensionsPanel.tsx', `${F('agent-resources')}/TrustedExtensionsPanel.tsx`],
  ['src/lib/mcp-capabilities.ts', `${F('agent-resources')}/mcp-capabilities.ts`],
  // home
  ['src/components/HomePage.tsx', `${F('home')}/HomePage.tsx`],
  ['src/components/home/', `${F('home')}/parts/`],
  // projects
  ...['ProjectsPanel', 'ProjectDetailView'].map(n => [`src/components/${n}.tsx`, `${F('projects')}/${n}.tsx`]),
  ['src/components/project-picker.tsx', `${F('projects')}/project-picker.tsx`],
  ['src/components/project-tabs.tsx', `${F('projects')}/project-tabs.tsx`],
  ['src/stores/projects-store.ts', `${F('projects')}/state/projects-store.ts`],
  // assistant
  ['src/components/LocalAssistantView.tsx', `${F('assistant')}/LocalAssistantView.tsx`],
  ['src/components/AssistantsPanel.tsx', `${F('assistant')}/AssistantsPanel.tsx`],
  // experts (deferred feature)
  ['src/components/experts-panel/', `${F('experts')}/`],
  ...['MarketplacePanel', 'PluginsPanel', 'DiscoverPanel'].map(n => [`src/components/${n}.tsx`, `${F('experts')}/${n}.tsx`]),
  ['src/stores/pending-expert-store.ts', `${F('experts')}/state/pending-expert-store.ts`],
  // automation (deferred feature)
  ['src/components/AutomationPanel.tsx', `${F('automation')}/AutomationPanel.tsx`],
  ['src/components/automation/', `${F('automation')}/`],
  // library (deferred feature)
  ...['ResourcesPanel', 'MyFilesPanel', 'KnowledgeBasePanel', 'CloudStoragePanel', 'InspirationPanel'].map(n => [`src/components/${n}.tsx`, `${F('library')}/${n}.tsx`]),
  ...['knowledge-base', 'local-kb-provider', 'desktop-kb-reader', 'cloud-storage'].map(n => [`src/lib/${n}.ts`, `${F('library')}/${n}.ts`]),
];

const isTest = f => /__tests__\//.test(f) && !f.startsWith('src/__tests__/');
const dest = new Map();
for (const f of files) {
  if (isTest(f)) continue;
  const rule = RULES.find(([m]) => (m.endsWith('/') ? f.startsWith(m) : f === m));
  if (!rule) throw new Error(`no rule for ${f}`);
  const [m, d] = rule;
  dest.set(f, m.endsWith('/') ? d + f.slice(m.length) : d);
}

// Tests: subject by name, else first internal import.
const byBase = new Map();
for (const [f] of dest) byBase.set(posix.basename(f).replace(/\.(tsx?|ts)$/, ''), f);
const SPEC = /(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]|vi\.mock\(\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g;
function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return undefined;
  for (const e of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (dest.has(base + e)) return base + e;
  return undefined;
}
const testNotes = [];
for (const f of files.filter(isTest)) {
  const name = posix.basename(f).replace(/\.test\.(tsx?|ts)$/, '');
  // Tests without an internal import (environment smoke tests) live with the app shell.
  if (f === 'src/components/__tests__/smoke.test.tsx') { dest.set(f, `${W}/app/__tests__/smoke.test.tsx`); testNotes.push(`${f} -> app (no internal import)`); continue; }
  // Subject = the internal module the test imports whose name matches the test (exact, then
  // prefix: ChatViewWindow → ChatView), else its first internal import (ignoring shared plumbing).
  const src = readFileSync(resolve(ROOT, f), 'utf8');
  const imports = [...src.matchAll(SPEC)].map(m => resolveSpec(f, m[1] ?? m[2] ?? m[3])).filter(Boolean);
  const base = p => posix.basename(p).replace(/\.(tsx?|ts)$/, '');
  let how = 'import-name';
  let subject = imports.find(i => base(i) === name)
    ?? imports.filter(i => name.startsWith(base(i))).sort((a, b) => base(b).length - base(a).length)[0];
  if (!subject) { how = 'name'; subject = byBase.get(name); }
  if (!subject) { how = 'import'; subject = imports.find(i => !/agent-client|types\.ts|ipc\.ts/.test(i)); }
  if (!subject) throw new Error(`cannot place test ${f}`);
  const to = `${posix.dirname(dest.get(subject))}/__tests__/${posix.basename(f)}`;
  dest.set(f, to);
  testNotes.push(`${f} -> ${to} (${how}: ${subject})`);
}

const step = to =>
  /^packages\/(client|protocol)\//.test(to) ? 'M7' :
  /^packages\/(platform|ui|markdown)\//.test(to) ? 'M8' :
  /^packages\/chat-core\//.test(to) ? 'M9' : 'M10';
const NAMES = { M7: 'M7-client', M8: 'M8-platform-ui-markdown', M9: 'M9-chat-core', M10: 'M10-web' };
const out = { M7: [], M8: [], M9: [], M10: [] };
for (const [from, to] of dest) out[step(to)].push({ from, to });
for (const [k, moves] of Object.entries(out)) {
  moves.sort((a, b) => a.from.localeCompare(b.from));
  writeFileSync(resolve(ROOT, `tools/move-map/${NAMES[k]}.json`), JSON.stringify({ step: k, moves }, null, 1) + '\n');
}
const targets = [...dest.values()];
const dup = targets.filter((t, i) => targets.indexOf(t) !== i);
if (dup.length) throw new Error(`duplicate targets: ${dup.join(', ')}`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))), 'files total', dest.size);
if (process.argv.includes('--tests')) console.log(testNotes.join('\n'));
