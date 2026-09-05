# Performance

**English** · [简体中文](PERFORMANCE.zh-CN.md)

### Performance budget

| Metric | Target | Measured by |
|---|---|---|
| Cold start to interactive (Win/macOS, M1/i7) | ≤ 2.5 s | Real-UI smoke |
| Warm start (Vite HMR dev) | ≤ 200 ms | `vite` dev server |
| Renderer entry chunk | ≤ 4 MB unzipped (CI gate) | `node scripts/perf/bundle-topology.mjs --strict` |
| Renderer total | ≤ 13 MB unzipped (CI gate) | `node scripts/perf/bundle-topology.mjs --strict` |
| Main process bundle | ≤ 4 MB | `node scripts/perf/bundle-baseline.mjs --include-main` |
| IPC dispatch hot path (validator + extraction) | ≤ 5 µs p99 per call | `node scripts/perf/ipc-latency.mjs` |
| Memory baseline (idle) | ≤ 250 MB | `process.memoryUsage()` |
| Memory per active session | ≤ 50 MB | `process.memoryUsage()` |
| Test suite (309 test files) | ≤ 3 min | CI log |

Any release that **exceeds the budget by > 10%** on the renderer entry chunk or renderer total fails the `perf-budget` job in CI and is therefore blocked from merge.

> 📊 For measured baselines, runnable scripts, and the regression matrix that
> tells engineers *which code paths to check when they change X*, see
> [`docs/perf/REGRESSION_MATRIX.md`](./perf/REGRESSION_MATRIX.md). The matrix
> is the ground-truth companion to this file — every script mentioned here
> actually runs and every number cited there is actually measured.

### How we measure

#### Locally

```bash
# Bundle topology — the CI-gate quality check
pnpm exec electron-vite build
node scripts/perf/bundle-topology.mjs --strict

# Bundle baseline — passive reporter with JSON output for trend tracking
node scripts/perf/bundle-baseline.mjs --include-main \
  --json=evidence/perf/bundle-baseline-$(date +%s).json

# IPC dispatch hot-path micro-benchmark
node scripts/perf/ipc-latency.mjs --iterations=3000 --inner=200 \
  --json=evidence/perf/ipc-latency-$(date +%s).json

# Aggregate every perf artifact into a single dashboard
node scripts/perf/dashboard.mjs --since-days=7
```

#### In CI

- **Every PR** — `perf-budget` job runs `bundle-topology.mjs --strict` and fails if entry chunk > 4 MB or total > 13 MB or a heavy chunk (markdown/katex/mermaid/cytoscape/cynefin) leaks into the entry's static graph.
- **Merge to master** — full perf dashboard updated nightly.
- **Release tag** — perf budget gate; blocks the release if violated.

### Patterns we follow

#### Renderer

- **Code-split by route**. Heavy screens (ChatView, Settings, Marketplace) are dynamic imports.
- **Memoize expensive selectors** in Zustand stores with `shallow` equality.
- **Virtualize long lists** (sessions, plugins, marketplace) with `@tanstack/virtual`.
- **Avoid layout thrashing** — never read DOM dimensions inside a write loop.
- **Throttle streaming deltas** to ≤ 60 fps with `requestAnimationFrame`.
- **Lazy-load icons** — `Icon.tsx` only imports icons used by the visible route.

#### Main process

- **Stream events don't go through IPC for every byte**. Batch at 16 ms intervals.
- **Storage writes are debounced** at 250 ms; flush on `before-quit`.
- **Plugin reload** uses worker_threads to avoid blocking the main process.

#### Build

- **Tree-shake lucide-react**. Import only the icons used.
- **`splitChunks`** for vendor libs (react, katex, mermaid).
- **`esbuild` minification** (Vite default).
- **CSS purging** via PostCSS.

#### Persistence

- **SQLite WAL** mode for memory and audit ledger.
- **Append-only** audit log with hash-chain checkpoints every 1000 entries.
- **Lazy migration** — schema changes happen on next read.

### Patterns to avoid

- ❌ **`useEffect` for derived state** — use Zustand selectors instead.
- ❌ **`React.memo` on every component** — only memoize after profiling.
- ❌ **JSON.stringify on hot paths** — use MessagePack or native structured clone.
- ❌ **Synchronous fs in main** — wrap in `fs.promises`.
- ❌ **`any` in performance-critical code** — TypeScript erasure doesn't help at runtime.
- ❌ **Big imports at module top** — dynamic-import heavy libs (mermaid, katex).

### Profiling tips

#### Renderer

1. Chrome DevTools → Performance tab → record.
2. Look for **Long Tasks (>50 ms)** in the flame graph.
3. React DevTools → "Profiler" tab → record interactions.
4. `console.time` / `console.timeEnd` for quick spot-checks.

#### Main

```typescript
import { performance } from "node:perf_hooks";

const start = performance.now();
await expensiveOperation();
console.log(`expensiveOperation: ${performance.now() - start}ms`);
```

For deep dives, use `node --prof` + `node --prof-process`.

### Optimizations shipped

Recent performance work (last 6 months):

- ⚡ Streaming deltas now batched at 16 ms (was 4 ms) — **40% fewer React re-renders**.
- ⚡ Icon bundle cut from 1.2 MB to 280 KB via tree-shaking.
- ⚡ Cold start reduced from 3.5 s to 2.1 s by lazy-loading the marketplace.
- ⚡ Memory leak in session store fixed — long-running sessions now stay at 250 MB.
- ⚡ SQLite WAL enabled — writes 6× faster.

See [`evidence/coverage-report/`](../../evidence/coverage-report/) for per-PR trends.
