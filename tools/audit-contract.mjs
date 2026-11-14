import ts from 'typescript';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
async function files(dir) {
  const result = [];
  for (const item of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...await files(path));
    else if (/\.(tsx?|cjs)$/.test(path) && !/(?:__tests__|\.test\.|test-setup)/.test(path)) result.push(path);
  }
  return result;
}
// Layout-agnostic source discovery: the same audit runs before, during and after the mv-first
// migration (20261115-md §6), so collect from whichever main/renderer roots currently exist.
const MAIN_ROOTS = ['electron', 'apps/desktop/src', 'packages/protocol/src', 'packages/services/src', 'packages/engine/src', 'packages/host/src'];
const RENDERER_ROOTS = ['src', 'apps/web/src', 'packages/client/src', 'packages/chat-core/src', 'packages/platform/src', 'packages/ui/src', 'packages/markdown/src'];
// Renderer DTOs move from src/lib/types.ts into the protocol package (M7) but stay renderer code.
const RENDERER_FILES = ['packages/protocol/src/dto.ts'];
const AGENT_CLIENT = ['src/lib/agent-client.ts', 'packages/client/src/agent-client.ts'];
const isRenderer = path => RENDERER_ROOTS.some(dir => path.startsWith(`${dir}/`)) || RENDERER_FILES.includes(path);
const paths = [];
for (const dir of [...MAIN_ROOTS, ...RENDERER_ROOTS]) if (existsSync(join(root, dir))) paths.push(...await files(dir));
const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const program = ts.createProgram(paths.map(path => join(root, path)), options);
const checker = program.getTypeChecker();
const source = new Map(paths.map(path => [path, program.getSourceFile(join(root, path))]));
function symbolOf(node) {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
const walk = (node, callback) => { callback(node); ts.forEachChild(node, child => walk(child, callback)); };
const location = (sf, node) => `${relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
const commands = new Set();
walk(source.get('packages/protocol/src/contract.ts'), node => {
  if (ts.isVariableDeclaration(node) && node.name.getText() === 'COMMANDS') walk(node.initializer, child => { if (literal(child)) commands.add(child.text); });
});
const handlers = new Map();
// R4 (20261115-md §5.3): host commands live in packages/host/src/modules/*, desktop-native ones in
// apps/desktop/src/native/*. Both lists are discovered, so a new module or native group is audited too.
const hostModules = paths.filter(path => /^packages\/host\/src\/modules\/[^/]+\.ts$/.test(path)).sort();
const nativeGroups = paths.filter(path => /^apps\/desktop\/src\/native\/[^/]+\.ts$/.test(path)).sort();
const isNative = path => path.endsWith('register.ts') || nativeGroups.includes(path);
for (const path of ['packages/host/src/handlers.ts', ...hostModules, 'apps/desktop/src/ipc/register.ts', ...nativeGroups, 'packages/services/src/files/files.ts']) {
  const sf = source.get(path);
  walk(sf, node => {
    if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name)) return;
    const name = node.name.text;
    if (!commands.has(name) && !/^(agent_|providers_|mcp_|skills_|notification_|permission_|account_|agents_defaults_|folder_trust|read_|write_|list_dir|path_stat|open_|reveal_|browse_|export_|dialog_|window_)/.test(name)) return;
    if (!ts.isArrowFunction(node.initializer) && !ts.isFunctionExpression(node.initializer)) return;
    const body = node.initializer.getText(sf);
    const entry = { location: location(sf, node), unconditionalUnsupported: /^\(?[^=]*=>\s*unsupported\(/s.test(body), conditionalUnsupported: body.includes('unsupported('), body };
    // Native handlers override injected service handlers.
    if (!handlers.has(name) || isNative(path)) handlers.set(name, entry);
  });
}
const calls = new Map();
const symbolCommands = new Map();
for (const [path, sf] of source) {
  if (!isRenderer(path)) continue;
  walk(sf, node => {
    if (!ts.isCallExpression(node) || node.expression.getText(sf) !== 'invoke') return;
    const command = literal(node.arguments[0]);
    if (!command) return;
    let ancestor = node.parent;
    while (ancestor && !(ts.isFunctionDeclaration(ancestor) && ancestor.name) && !(ts.isVariableDeclaration(ancestor) && ts.isIdentifier(ancestor.name))) ancestor = ancestor.parent;
    const symbol = ancestor?.name?.getText(sf);
    const call = { location: location(sf, node), symbol };
    calls.set(command, [...calls.get(command) ?? [], call]);
    const resolvedSymbol = ancestor?.name && symbolOf(ancestor.name);
    if (resolvedSymbol) symbolCommands.set(resolvedSymbol, [...symbolCommands.get(resolvedSymbol) ?? [], command]);
  });
}
const entries = new Map();
for (const [path, sf] of source) {
  if (!isRenderer(path) || AGENT_CLIENT.includes(path)) continue;
  walk(sf, node => {
    // Include function values in conditional dispatch, not just direct calls.
    if (!ts.isIdentifier(node) || ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent) || ts.isExportSpecifier(node.parent)) return;
    const symbol = symbolOf(node);
    for (const command of symbolCommands.get(symbol) ?? []) entries.set(command, [...entries.get(command) ?? [], location(sf, node)]);
  });
}
const nativeEntries = {
  dialog_open: ['packages/client/src/ipc.ts:open', 'WorkspacePicker/ProjectsPanel/Composer/native file pickers'],
  dialog_save: ['packages/client/src/ipc.ts:save', 'TopbarActions/markdown-host'],
  dialog_ask: ['packages/client/src/ipc.ts:ask', 'markdown-host'],
  window_minimize: ['apps/web/src/app/shell/TitleBar.tsx'], window_toggle_maximize: ['apps/web/src/app/shell/TitleBar.tsx'],
  window_close: ['apps/web/src/app/shell/TitleBar.tsx'], window_is_maximized: ['apps/web/src/app/shell/TitleBar.tsx'],
};
let runtimeEvidence = null;
const verifiedCommands = new Set();
try {
  const evidence = JSON.parse(await readFile(join(root, 'release/electron-ui-check.json'), 'utf8'));
  if (evidence.artifact && evidence.artifactSha256 === createHash('sha256').update(await readFile(evidence.artifact)).digest('hex')) {
    runtimeEvidence = { file: 'release/electron-ui-check.json', artifact: evidence.artifact, sha256: evidence.artifactSha256, mode: evidence.mode, checks: evidence.checks.map(check => check.name) };
    for (const name of ['providers_save_provider', 'providers_save_model', 'agent_init', 'agent_list_sessions', 'agent_get_model_state', 'agent_new_session', 'agent_send', 'agent_set_model', 'agent_set_thinking_level']) verifiedCommands.add(name);
    const names = evidence.checks.map(check => check.name);
    if (names.some(name => name.includes('extension input accepted')) && names.some(name => name.includes('extension select cancelled'))) for (const command of ['agent_resolve_ui', 'agent_extensions_add', 'agent_extensions_set_enabled']) verifiedCommands.add(command);
    if (names.some(name => name.includes('queues steering and follow-up'))) for (const command of ['agent_steer', 'agent_follow_up', 'agent_get_queue', 'agent_clear_queue']) verifiedCommands.add(command);
    if (names.some(name => name.includes('topbar fork'))) for (const command of ['agent_fork_session', 'agent_rename_session']) verifiedCommands.add(command);
    if (names.some(name => name.includes('sidebar restore'))) verifiedCommands.add('agent_load_session');
    if (names.some(name => name.includes('BrowserWindow'))) for (const command of ['window_minimize', 'window_toggle_maximize', 'window_is_maximized']) verifiedCommands.add(command);
  }
} catch { /* A static audit must also work before any UI run. */ }
const matrix = [...new Set([...commands, ...calls.keys(), ...handlers.keys()])].sort().map(command => {
  const handler = handlers.get(command);
  const callers = calls.get(command) ?? [];
  const uiEntries = [...new Set([...(entries.get(command) ?? []), ...(nativeEntries[command] ?? []), ...callers.filter(c => !AGENT_CLIENT.some(file => c.location.startsWith(`${file}:`))).map(c => c.location)])];
  const whitelisted = commands.has(command);
  const status = !whitelisted ? 'deferred_not_whitelisted' : !handler ? 'missing_handler' : handler.unconditionalUnsupported ? 'unsupported' : uiEntries.length ? 'wired_static' : 'handler_without_ui_entry';
  const reachable = ['dialog_', 'window_', 'providers_', 'agent_', 'agents_defaults_', 'account_', 'notification_', 'skills_'].some(prefix => command.startsWith(prefix)) && whitelisted && status === 'wired_static' || ['folder_trust_respond', 'permission_mode_get', 'permission_mode_set', 'commands_list', 'export_text_file', 'read_text_file', 'write_text_file', 'read_file_base64', 'list_dir', 'browse_directory', 'path_stat', 'open_path', 'open_url', 'reveal_in_folder', 'mcp_auth_trigger', 'mcp_auth_status', 'mcp_config_read', 'mcp_config_save', 'mcp_config_path'].includes(command);
  return { command, whitelisted, handler: handler?.location ?? null, status, reachability: !whitelisted ? 'deferred_or_hidden_legacy' : handler?.unconditionalUnsupported ? 'unsupported_legacy_card' : reachable ? 'reachable_route_static_review' : uiEntries.length ? 'static_calls_only_route_not_confirmed' : 'no_frontend_entry', verification: verifiedCommands.has(command) ? 'verified_real_electron_local_fixture' : 'not_runtime_verified_this_round', caveat: handler?.conditionalUnsupported && !handler.unconditionalUnsupported ? 'conditional unsupported branch; inspect implementation' : null, callers, uiEntries };
});
const counts = {};
for (const row of matrix) counts[row.status] = (counts[row.status] ?? 0) + 1;
const report = { note: 'Static TypeScript symbol inventory plus manual route review. Reachable means the route exists in the current UI, not runtime success. Runtime verification is attached only when the supplied main/ASAR artifact hash still matches the successful UI report.', counts, runtimeEvidence,
  manualReview: [
    { area: 'MyFiles', status: 'local_listing_artifacts_deferred', evidence: 'MyFilesPanel uses list_dir/kind for actual local entries; the former memory_list artifacts default was unsupported and is explicitly deferred. Cloud upload is not implemented.' },
    { area: 'Policy', status: 'local_preview_not_enforced', evidence: 'PolicySettingsPanel edits localStorage only. It does not enforce model/skill/permission restrictions in Pi or the main process; the UI states this limit.' },
    { area: 'Usage quotas', status: 'local_reminder_not_enforced', evidence: 'Usage records come from actual session events, but thresholds are reminders. They do not stop sends and costs are estimates.' },
    { area: 'External notification channels', status: 'drafts_only', evidence: 'Channel drafts remain local. External send/test is disabled until a restricted main-process transport is implemented; production CSP remains strict.' },
    { area: 'MCP', status: 'reachable', evidence: 'AgentResourcesPanel.tsx embeds McpConfigEditor. JSON read/save/path and OAuth have real routes; dedicated upsert/delete/toggle buttons remain in hidden legacy connector UI.' },
    { area: 'Project collaboration', status: 'local_only_cloud_deferred', evidence: 'ProjectDetailView.tsx and project-tabs.tsx cloud invite/upload/project-level fake bindings are disabled or explicitly deferred. Local project metadata, instructions, tasks and actual Pi conversations remain; storage metadata estimates are not a capacity quota.' },
    { area: 'Legacy feature routes', status: 'deferred', evidence: 'App.tsx blocks assistant/expert/automation/library/inspiration/cloud routes; old invoke wrappers remain to preserve source, not implemented capabilities.' },
    { area: 'Models/thinking/Pi UI/attachments/queue/fork/trusted extensions', status: 'implemented', evidence: 'Explicit provider/model identity, actual thinking state, typed extension forms, native attachment grants, SDK queues/fork and opt-in extension loading are implemented. See hash-bound runtimeEvidence for the tested subset.' },
    { area: 'Built-in API prices', status: 'fallback_exposed', evidence: 'providers.ts uses numeric zero internally when price unknown but returns pricingKnown=false. UI must not call this free usage.' },
    { area: 'Local settings and project data', status: 'local_only', evidence: 'Browser persisted settings/projects are local state. They are not a remote account, team, mail, policy or cloud-storage implementation.' },
  ], matrix };
const output = process.argv[2] ?? 'release/contract-matrix.json';
await mkdir(join(root, 'release'), { recursive: true });
await writeFile(join(root, output), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, counts, missingHandlers: matrix.filter(row => row.status === 'missing_handler') }, null, 2));
