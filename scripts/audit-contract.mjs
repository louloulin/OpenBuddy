import ts from 'typescript';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
const paths = [...await files('electron'), ...await files('src')];
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
const location = (sf, node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
const commands = new Set();
walk(source.get('electron/shared/contract.ts'), node => {
  if (ts.isVariableDeclaration(node) && node.name.getText() === 'COMMANDS') walk(node.initializer, child => { if (literal(child)) commands.add(child.text); });
});
const handlers = new Map();
for (const path of ['electron/ipc/handlers/agent.ts', 'electron/ipc/register.ts', 'electron/services/files.ts']) {
  const sf = source.get(path);
  walk(sf, node => {
    if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name)) return;
    const name = node.name.text;
    if (!commands.has(name) && !/^(agent_|providers_|mcp_|skills_|notification_|permission_|account_|agents_defaults_|folder_trust|read_|write_|list_dir|path_stat|open_|reveal_|browse_|export_|dialog_|window_)/.test(name)) return;
    if (!ts.isArrowFunction(node.initializer) && !ts.isFunctionExpression(node.initializer)) return;
    const body = node.initializer.getText(sf);
    const entry = { location: location(sf, node), unconditionalUnsupported: /^\(?[^=]*=>\s*unsupported\(/s.test(body), conditionalUnsupported: body.includes('unsupported('), body };
    // Native handlers override injected service handlers.
    if (!handlers.has(name) || path.endsWith('register.ts')) handlers.set(name, entry);
  });
}
const calls = new Map();
const symbolCommands = new Map();
for (const [path, sf] of source) {
  if (!path.startsWith('src/')) continue;
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
  if (!path.startsWith('src/') || path === 'src/lib/agent-client.ts') continue;
  walk(sf, node => {
    if (!ts.isCallExpression(node)) return;
    const symbol = symbolOf(node.expression);
    for (const command of symbolCommands.get(symbol) ?? []) entries.set(command, [...entries.get(command) ?? [], location(sf, node)]);
  });
}
const nativeEntries = {
  dialog_open: ['src/lib/ipc.ts:open', 'WorkspacePicker/ProjectsPanel/Composer/native file pickers'],
  dialog_save: ['src/lib/ipc.ts:save', 'TopbarActions/markdown-host'],
  dialog_ask: ['src/lib/ipc.ts:ask', 'markdown-host'],
  window_minimize: ['src/components/TitleBar.tsx'], window_toggle_maximize: ['src/components/TitleBar.tsx'],
  window_close: ['src/components/TitleBar.tsx'], window_is_maximized: ['src/components/TitleBar.tsx'],
};
const matrix = [...new Set([...commands, ...calls.keys(), ...handlers.keys()])].sort().map(command => {
  const handler = handlers.get(command);
  const callers = calls.get(command) ?? [];
  const uiEntries = [...new Set([...(entries.get(command) ?? []), ...(nativeEntries[command] ?? []), ...callers.filter(c => !c.location.startsWith('src/lib/agent-client.ts:')).map(c => c.location)])];
  const whitelisted = commands.has(command);
  const status = !whitelisted ? 'deferred_not_whitelisted' : !handler ? 'missing_handler' : handler.unconditionalUnsupported ? 'unsupported' : uiEntries.length ? 'wired_static' : 'handler_without_ui_entry';
  const reachable = ['dialog_', 'window_', 'providers_', 'agent_', 'agents_defaults_', 'account_', 'notification_', 'skills_'].some(prefix => command.startsWith(prefix)) && whitelisted && status === 'wired_static' || ['folder_trust_respond', 'permission_mode_get', 'permission_mode_set', 'commands_list', 'export_text_file', 'read_text_file', 'write_text_file', 'read_file_base64', 'list_dir', 'browse_directory', 'path_stat', 'open_path', 'open_url', 'reveal_in_folder', 'mcp_auth_trigger', 'mcp_auth_status', 'mcp_config_read', 'mcp_config_save', 'mcp_config_path'].includes(command);
  return { command, whitelisted, handler: handler?.location ?? null, status, reachability: !whitelisted ? 'deferred_or_hidden_legacy' : handler?.unconditionalUnsupported ? 'unsupported_legacy_card' : reachable ? 'reachable_route_static_review' : uiEntries.length ? 'static_calls_only_route_not_confirmed' : 'no_frontend_entry', verification: 'not_runtime_verified_this_round', caveat: handler?.conditionalUnsupported && !handler.unconditionalUnsupported ? 'conditional unsupported branch; inspect implementation' : null, callers, uiEntries };
});
const counts = {};
for (const row of matrix) counts[row.status] = (counts[row.status] ?? 0) + 1;
const report = { note: 'Static TypeScript symbol inventory plus manual route review. Reachable means the route exists in the current UI, not runtime success. No runtime verification is claimed by this script.', counts,
  manualReview: [
    { area: 'MCP', status: 'reachable', evidence: 'AgentResourcesPanel.tsx embeds McpConfigEditor. JSON read/save/path and OAuth have real routes; dedicated upsert/delete/toggle buttons remain in hidden legacy connector UI.' },
    { area: 'Project collaboration', status: 'demo_or_deferred', evidence: 'ProjectDetailView.tsx invite/send actions and project-tabs.tsx uploads/storage estimates plus project-picker.tsx presets are local simulations. Must label deferred; no real cloud collaboration or upload.' },
    { area: 'Legacy feature routes', status: 'deferred', evidence: 'App.tsx blocks assistant/expert/automation/library/inspiration/cloud routes; old invoke wrappers remain to preserve source, not implemented capabilities.' },
    { area: 'Models/thinking/Pi UI/attachments/queue/fork/trusted extensions', status: 'implementation_in_progress', evidence: 'Tasks 5/6/7 are adding explicit provider+model identity and restricted IPC. Re-run this report after freeze and attach real desktop evidence.' },
    { area: 'Built-in API prices', status: 'fallback_exposed', evidence: 'providers.ts uses numeric zero internally when price unknown but returns pricingKnown=false. UI must not call this free usage.' },
    { area: 'Local settings and project data', status: 'local_only', evidence: 'Browser persisted settings/projects are local state. They are not a remote account, team, mail, policy or cloud-storage implementation.' },
  ], matrix };
const output = process.argv[2] ?? 'release/contract-matrix.json';
await mkdir(join(root, 'release'), { recursive: true });
await writeFile(join(root, output), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, counts, missingHandlers: matrix.filter(row => row.status === 'missing_handler') }, null, 2));
