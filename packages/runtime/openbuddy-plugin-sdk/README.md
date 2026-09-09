# `@openbuddy/plugin-sdk` (v0.1)

PI-native plugin manifest serializer for OpenBuddy. Phase K.1 of the DSH v6 plan (`docs/OPENBUDDY_PI_NATIVE_PLAN.md` §25).

## What it does

The SDK is a **thin manifest helper**:

1. Parses a `plugin.json` file (or the `openbuddy` block of a `package.json`) using a strict zod schema.
2. Validates that the plugin declares at least one of the four tracks (`pi` / `cordis` / `ui` / `harness`).
3. Serializes the validated manifest into a **PI `ExtensionFactory`** the host can pass straight to `loadExtensions()`.

The SDK does **not** install plugins into a microkernel, register tools, or run any side effects. Actual loading is still PI's responsibility — see `loadExtensions(paths, cwd)` in `@earendil-works/pi-coding-agent`.

## Why this shape (v6 reframing)

DSH v4 originally planned for the SDK to be a unified "4-track loader" replacing PI / Cordis / Slot / Harness with a single entrypoint. v6 explicitly re-scopes it:

> The SDK is **not** the DSH loader replacement. It is the **PI ExtensionFactory's manifest serializer** — it parses `plugin.json` and produces PI standard descriptors. Actual loading remains `PI.loadExtensions(paths)`.

This keeps the loader surface owned by PI (where it belongs) while letting OpenBuddy ship a structured manifest format.

## Layout

```
src/
  types.ts        # TS contracts: OpenBuddyPlugin + 4 tracks
  manifest.ts     # zod schema + parsePluginManifest / parsePluginPackageJson
  serializer.ts   # manifest → PI ExtensionFactory
  index.ts        # public barrel
  __tests__/      # vitest unit tests (~10 cases)
  __fixtures__/   # sample plugin.json + package.json exercising all 4 tracks
```

## Manifest shape

`plugin.json`:

```json
{
  "schema": "openbuddy.plugin.v1",
  "name": "@openbuddy/sample-plugin",
  "version": "0.1.0",
  "engines": { "openbuddy": ">=0.14.0" },
  "main": "./index.js",
  "pi": {
    "handlers": { "session_start": "./handlers/session-start.js" },
    "tools":    ["./tools/sample-tool.js"],
    "commands": ["./commands/sample-cmd.js"]
  },
  "ui": {
    "chat-header:status": {
      "type": "react-component",
      "component": "./components/StatusBadge.jsx"
    }
  },
  "harness": {
    "contributes": { "dsh.service": { "name": "sample-service" } }
  }
}
```

### Track semantics

| Track | Carried in manifest? | Notes |
|---|---|---|
| `pi` | ✅ | `handlers` / `tools` / `commands` reference module paths. The serializer produces a PI `ExtensionFactory` that registers stubs at those paths; the host loads the real modules. |
| `ui` | ✅ | Slot declarations live in the manifest as `react-component` / `menu-item` / `status-bar` entries. |
| `harness` | ✅ | Static DSH-compatible declaration. Used during the Phase L DSH retirement; eventually replaced by direct PI commands. |
| `cordis` | ❌ | Runtime-only track — Cordis installers cannot be statically declared. The host wires Cordis plugins at boot time. |

## Usage

```typescript
import { readFile } from "node:fs/promises";
import {
  parsePluginManifest,
  manifestToExtensionFactory,
  // The returned factory can be fed straight to PI:
  // loadExtensionFromFactory(serialized.factory, cwd, eventBus, runtime)
} from "@openbuddy/plugin-sdk";

const raw = JSON.parse(await readFile("plugin.json", "utf8"));
const parsed = parsePluginManifest(raw, "/abs/path/plugin.json");
const serialized = manifestToExtensionFactory(parsed, "/abs/path/plugin.json");

console.log(serialized.tracks);    // [ "pi", "ui", "harness" ]
console.log(serialized.diagnostics); // [] (or warning strings)
serialized.factory(piApi);           // PI ExtensionAPI
```

## Verification

- `pnpm typecheck` (covers both root and the package via moon)
- `pnpm test openbuddy-plugin-sdk` (vitest, ~10 cases in `__tests__/`)
- The bundled fixture (`src/__fixtures__/sample-plugin/plugin.json`) is parsed and serialized to confirm the 4-track dispatch produces a real `ExtensionFactory`.
