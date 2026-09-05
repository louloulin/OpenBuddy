import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { installProviderRegistryTracker, type ProviderRegistryRecord, type ProviderRegistryChange } from "./agent-host-provider-registry";

type Harness = {
  runtime: ModelRuntime;
  registry: Map<string, ProviderRegistryRecord>;
  root: string;
};

async function makeHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-provider-registry-"));
  const runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: join(root, "models.json"),
    refreshOnCreate: false,
  });
  const registry = new Map<string, ProviderRegistryRecord>();
  installProviderRegistryTracker(runtime, registry);
  return { runtime, registry, root };
}

describe("installProviderRegistryTracker", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("records live registerProvider calls as pi-extension attribution", () => {
    harness.runtime.registerProvider("acme-llm", {
      baseUrl: "https://acme.test",
      apiKey: "test-key",
      api: "openai-responses",
      models: [],
    } as never);

    expect(harness.registry.get("acme-llm")).toMatchObject({
      id: "acme-llm",
      source: "pi-extension",
    });
    expect(harness.runtime.getRegisteredProviderIds()).toContain("acme-llm");
  });

  it("removes attribution when a provider is unregistered", () => {
    harness.runtime.registerProvider("temp-provider", {} as never);
    expect(harness.registry.has("temp-provider")).toBe(true);
    harness.runtime.unregisterProvider("temp-provider");
    expect(harness.registry.has("temp-provider")).toBe(false);
    expect(harness.runtime.getRegisteredProviderIds()).not.toContain("temp-provider");
  });

  it("preserves existing extensionPath attribution on subsequent registrations", () => {
    const fakeExtension = "/fake/path/extensions/acme-provider/index.ts";
    harness.registry.set("acme-llm", {
      id: "acme-llm",
      source: "pi-extension",
      extensionPath: fakeExtension,
      registeredAt: 0,
    });
    harness.runtime.registerProvider("acme-llm", {} as never);
    expect(harness.registry.get("acme-llm")?.extensionPath).toBe(fakeExtension);
    expect(harness.registry.get("acme-llm")?.registeredAt).toBeGreaterThan(0);
  });

  it("records live registerNativeProvider calls when available", () => {
    const provider = {
      id: "native-acme",
      baseUrl: "https://native.test",
      models: [],
    } as never;
    const nativeRegister = (harness.runtime as unknown as { registerNativeProvider?: (p: never) => void }).registerNativeProvider;
    if (typeof nativeRegister === "function") {
      nativeRegister(provider);
      expect(harness.registry.get("native-acme")?.source).toBe("pi-extension");
    } else {
      expect(true).toBe(true);
    }
  });
});

describe("Pi extension registerProvider flow (multi-provider fixture)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("attribution persists across multiple providers registered by the same extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-provider-fixture-"));
    try {
      const extensionDir = join(root, "extensions", "acme-multi");
      await mkdir(extensionDir, { recursive: true });
      harness.registry.set("acme-chat", {
        id: "acme-chat",
        source: "pi-extension",
        extensionPath: join(extensionDir, "index.ts"),
        registeredAt: Date.now(),
      });
      harness.registry.set("acme-embeddings", {
        id: "acme-embeddings",
        source: "pi-extension",
        extensionPath: join(extensionDir, "index.ts"),
        registeredAt: Date.now(),
      });
      harness.runtime.registerProvider("acme-chat", {} as never);
      harness.runtime.registerProvider("acme-embeddings", {} as never);

      expect(harness.registry.get("acme-chat")?.extensionPath).toContain("acme-multi");
      expect(harness.registry.get("acme-embeddings")?.extensionPath).toContain("acme-multi");
      harness.runtime.unregisterProvider("acme-chat");
      expect(harness.registry.has("acme-chat")).toBe(false);
      expect(harness.registry.has("acme-embeddings")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

describe("installProviderRegistryTracker onChange callback", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("emits register events when providers come online", async () => {
    const events: Array<{ kind: "register" | "unregister"; record: ProviderRegistryChange }> = [];
    installProviderRegistryTracker(harness.runtime, harness.registry, (event) => events.push(event));
    harness.runtime.registerProvider("event-provider", {} as never);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "register", record: { id: "event-provider", source: "pi-extension" } });
  });

  it("emits unregister events with the original source", () => {
    const events: Array<{ kind: "register" | "unregister"; record: ProviderRegistryChange }> = [];
    harness.registry.set("sourceful", {
      id: "sourceful",
      source: "pi-extension",
      extensionPath: "/fake/extension.ts",
      registeredAt: 0,
    });
    installProviderRegistryTracker(harness.runtime, harness.registry, (event) => events.push(event));
    harness.runtime.unregisterProvider("sourceful");
    expect(events).toEqual([{ kind: "unregister", record: { id: "sourceful", source: "pi-extension", extensionPath: "/fake/extension.ts", registeredAt: 0 } }]);
  });
});
});
