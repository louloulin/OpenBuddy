# OpenBuddy Golden Snapshots

Golden snapshots are per-runner reference outputs that the AI Agent Harness
compares against to detect regressions. Each runner owns one directory under
`evals/golden/{runner-id}/` keyed by the **dataset version hash**, so a
dataset change automatically invalidates the prior golden rather than
silently flagging every test as a regression.

## Layout

```
evals/golden/
├── README.md                         ← this file
├── core-regression/
│   └── {datasetHash}.json            ← one per dataset version
├── closed-loop-vitest/
│   └── {datasetHash}.json
└── {runner-id}/
    └── {datasetHash}.json
```

## Schema

```json
{
  "schema": "openbuddy.golden-snapshot.v1",
  "runnerId": "core-regression",
  "datasetHash": "a1b2c3d4e5f60718",
  "createdAt": "2026-09-01T12:34:56.000Z",
  "results": [
    {
      "id": "task-001",
      "ok": true,
      "eventsFingerprint": "1234567890abcdef",
      "errorDigest": null
    }
  ]
}
```

## Lifecycle

1. **Seed**: Run the runner with `OPENBUDDY_GOLDEN_UPDATE=1`. The runner
   writes `evals/golden/{runner-id}/{datasetHash}.json` from the live run.
2. **Compare**: Subsequent runs read the matching golden (same datasetHash)
   and report `mismatches[]` if any result's `ok` / `eventsFingerprint` /
   `errorDigest` differs.
3. **Update**: When the dataset hash changes (data changed, prompt shape
   changed), the runner produces a **new** golden file alongside the old
   one. Both remain until a human reviews and removes the stale one.
4. **Fail-closed**: Mismatches against the current golden produce a
   non-zero exit unless `OPENBUDDY_GOLDEN_TOLERATE=1` is set.

## Governance

- `OPENBUDDY_GOLDEN_UPDATE=1` lands with the change that requires it (no
  second-review commit). The PR description must call out the golden bump.
- Stale goldens (datasetHash no longer produced) should be removed in the
  same PR that drops the dataset.
- Never edit a golden file by hand — re-seed from a clean run.

## Adding a new runner

1. Add a `goldenPolicy` entry to `evals/benchmark-manifest.json` or
   `evals/agent-scenario-manifest.json`:

   ```json
   {
     "runnerId": "my-runner",
     "goldenPolicy": {
       "dir": "evals/golden/my-runner",
       "schemaVersion": "openbuddy.golden-snapshot.v1",
       "requireMatch": true
     }
   }
   ```

2. In the runner script, import and call `compareToGolden`:

   ```js
   import { compareToGolden } from "./golden-compare.mjs";
   const goldenComparison = compareToGolden({
     runnerId: "my-runner",
     datasetHash,
     results,
     goldenDir: join(repoRoot, "evals", "golden", "my-runner"),
   });
   summary.goldenComparison = goldenComparison;
   ```

3. Run once with `OPENBUDDY_GOLDEN_UPDATE=1` to seed.

## CI behavior

- `evals/node/audit_evaluation_suite.mjs` validates that every
  `goldenPolicy` entry in the manifests points at an existing directory.
- `.github/workflows/harness.yml` runs the curated eval subset; a golden
  mismatch fails the job unless `OPENBUDDY_GOLDEN_TOLERATE=1`.