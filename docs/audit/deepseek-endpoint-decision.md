# deepseek `dynamicCordisRunner/inventory` — Endpoint Decision Recommendation

> **Goal**: `mu7rpkze-gc769z` / deepseek-decision (doc-only — no implementation).
> **Date**: 2026-09-19
> **Author**: this session's agent
> **Status**: **RECOMMENDATION = Option C (Remove)**.
> **Implementation**: out of scope for this task — the team should
> schedule a separate work item to execute Option C if the
> recommendation is accepted.

---

## 1. Problem statement

`scripts/electron/smoke.mjs:1363-1365` invokes
`api.invoke("dsh:remote", { namespace: "dynamicCordisRunner", method: "inventory" })`
and throws if the response is not successful:

```js
const dshInventory = await invoke("dsh:remote", { namespace: "dynamicCordisRunner", method: "inventory" });
if (!dshInventory || (dshInventory as { ok?: boolean }).ok === false) {
  throw new Error(`DeepSeek host runner inventory failed: ${JSON.stringify(dshInventory)}`);
}
```

### What actually happens

The `dsh:remote` IPC handler (`electron/main/ipc/index.ts:831`) delegates
to `capabilityMethod` in `electron/main/deepseek/deepseek-capabilities.ts:108`:

```ts
function capabilityMethod(ctx: Context, serviceKey: string, method: string, args: readonly unknown[]): unknown {
  const remotes = ctx.get("dshRemotes") as Record<string, CapabilityMethod> | undefined;
  const suffix = `${method[0]!.toUpperCase()}${method.slice(1)}`;
  const implementation = remotes?.[`${serviceKey}${suffix}`] ?? remotes?.[method];
  if (typeof implementation !== "function")
    throw new Error(`deepseek-compat: ${serviceKey}.${method} is unavailable`);
  return implementation(...args);
}
```

For `{namespace:"dynamicCordisRunner", method:"inventory"}` this looks up
`dshRemotes["dynamicCordisRunnerInventory"]` and
`dshRemotes["inventory"]`. Neither is registered, so the call throws
`deepseek-compat: dynamicCordisRunner.inventory is unavailable`. The
release-readiness report summarises this as
`dynamicCordisRunner/inventory endpoint-not-registered` — same root
cause, slightly different framing.

### Why nothing is registered

`workbench-scope.ts:109` declares the workbench entry:

```ts
["openbuddy-dsh-cordis-host-runner", "dynamicCordisRunner", "@deepseek-ai/dsh-cordis-host-runner"],
```

But the actual wiring in `bootstrap/wire-dsh-services.ts:81` provides
`dshRemotes` for the legacy `@deepseek-ai/dsh-*` capability services —
**none of which is `dynamicCordisRunner`**.

`@deepseek-ai/dsh-cordis-host-runner` is:

- **NOT** listed in any `package.json` in this repo (verified).
- **NOT** present under `node_modules/@deepseek-ai/` (verified — the
  directory does not exist).
- Declared aspirationally in `deepseek-capabilities.ts` (15 methods,
  only 4 descriptors) and in `workbench-scope.ts` (1 line).

### Scope of the gap

Of the 4 wired descriptors:

| Method | Declared in `methods:` | Descriptor | Smoke/runtime caller |
| --- | --- | --- | --- |
| `inventory` | ✅ | ✅ line 101 | ✅ `smoke.mjs:1363` |
| `invoke` | ✅ | ✅ line 102 | ❌ no runtime caller |
| `stopFromPanel` | ✅ | ✅ line 103 | ❌ no runtime caller |
| `undefineFromPanel` | ✅ | ✅ line 104 | ❌ no runtime caller |
| 11 others (`define`, `undefine`, `runHostHalf`, `getClientCode`, `resolveRequestRun`, `settleUserRun`, `stop`, `syncInspectManifest`, `resolveInspectQuery`, `reportRenderFailure`, `reportClientGuardFailure`) | ✅ declared | ❌ **no descriptor** | ❌ none |

In other words: the capability declaration is mid-implementation. The
4 descriptors exist on paper; none is wired to a real implementation;
only `inventory` is even *attempted* (and that by smoke, not by the
app).

## 2. Options

### Option A — Register (implement the missing service)

- **What**: add `@deepseek-ai/dsh-cordis-host-runner` to deps (if it
  exists on npm), import `DynamicCordisRunnerService`, wire its 4
  methods into `dshRemotes` in `wire-dsh-services.ts`, plus implement
  any plumbing needed for the 11 unwired methods.
- **LOC**: ~150–250 + new dep + tests.
- **Risk**: **high**. The package is **not installed** anywhere in this
  repo and not in `package.json`. If it doesn't exist on npm (or has a
  diverged API), Option A is **infeasible** and would burn the budget.
  This is an unknown external dependency that the team has not
  validated yet.
- **Win**: enables `dynamicCordisRunner` "remote inventory" mode, which
  the codebase suggests was an aspirational feature for panel-driven
  cordis runtime exploration.

### Option B — Abstract (make the gap tolerable)

- **What**: change `capabilityMethod` to return `{ ok: false, reason:
  "service-unavailable" }` instead of throwing, and update
  `smoke.mjs:1363-1365` to log a skip and continue rather than fail.
- **LOC**: ~15-25.
- **Risk**: **low for code, medium for tech debt**. Silently dropping
  a feature that was explicitly declared creates a "ghost capability"
  that future readers will mistake for live. The capability
  declaration still implies the feature exists.
- **Win**: unblocks smoke with minimal change. Preserves the option to
  revisit A later.

### Option C — Remove (delete the declaration + smoke call)

- **What**: delete the `@deepseek-ai/dsh-cordis-host-runner` block
  from `deepseek-capabilities.ts` (15 lines, 1 capability entry × 4
  descriptors + methods line), delete the workbench-scope entry
  (`workbench-scope.ts:109`, 1 line), and delete the smoke call
  (`smoke.mjs:1363-1365`, 3 lines). Total ~30 LOC deletions.
- **Risk**: **low**. The feature was never wired. Only smoke calls it.
  Deletion is fully reversible via git revert. No external consumer
  depends on the declaration (verified via repo-wide grep for
  `dynamicCordisRunner`).
- **Win**: unblocks smoke, removes dead declaration, reduces surface
  area. If remote runner is needed later, it can be re-added as a
  complete feature in a dedicated work item.

## 3. Recommendation: **Option C (Remove)**

Reasons:

1. **The feature was never implemented**. Only 4 of 15 declared methods
   have descriptors; only 1 of 4 has a caller; nothing is wired to a
   real `dshRemotes` entry. Deleting an aspirational declaration is
   cheaper than pretending it works.

2. **Cost is small and bounded**. ~30 LOC of deletion across 3 files.
   No new code, no new dep, no new tests, no risk of regressions in
   real code paths.

3. **Reversibility**. Git revert restores the exact previous state. If
   the team later wants Option A, they can start from a clean tree
   and do it properly with validated package availability.

4. **No silent regressions**. The smoke that exercises this today is
   the only consumer. Other dsh:remote calls in unit tests
   (`collaboration-and-runtime-ipc-dispatch-realserver.test.ts`,
   `expanded-ipc-coverage-realserver.test.ts`) only test the IPC
   contract's argument-validation; they do not invoke
   `dynamicCordisRunner`.

5. **Aligns with the rest of this session's discipline**: be honest
   about pre-existing gaps (the "完成 / 严禁" pattern from
   `docs/release-readiness-report.md` §七) rather than carry them as
   deferred technical debt.

If the team later decides they want the feature:

- Schedule a separate work item to evaluate
  `@deepseek-ai/dsh-cordis-host-runner` availability on npm.
- If the package exists and is maintained, redo Option A with proper
  tests and a quota-backed real-model end-to-end run.
- If it does not exist, design a smaller alternative scoped to the
  actually-needed inventory surface.

## 4. Verification evidence (this session)

- Capability declaration: `electron/main/deepseek/deepseek-capabilities.ts:93-105`
  (15 methods, 4 descriptors).
- Resolver: `electron/main/deepseek/deepseek-capabilities.ts:108-114`
  (`capabilityMethod` throws when `dshRemotes["${serviceKey}${suffix}"]`
  is missing).
- Workbench entry: `electron/main/agent/host-modules/workbench-scope.ts:109`.
- Smoke caller: `scripts/electron/smoke.mjs:1363-1365`.
- DSH registry wire: `bootstrap/wire-dsh-services.ts:81` (`dshRemotes`
  provided, but no `dynamicCordisRunner*` keys).
- Package absence: `@deepseek-ai/dsh-cordis-host-runner` not found in
  any `package.json` (root or workspaces) and not present under
  `node_modules/@deepseek-ai/`.
- A1 smoke evidence (prior session battery `bb22b6379`):
  `[smoke] error=DeepSeek host runner inventory failed: {"ok":false,"error":{"code":"endpoint-not-registered","message":"DeepSeek remote endpoint is not registered: dynamicCordisRunner/inventory",...}}` — same root cause, surfaced through `wire-dsh-services.ts`'s error wrapper.