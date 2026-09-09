import { describe, expect, it } from "vitest";
import {
  RENDERER_PERSISTENCE_CLASSIFICATIONS,
  assertRendererPersistenceClassification,
  classifyRendererPersistence,
} from "./persistence-contract";

describe("renderer persistence contract", () => {
  it("classifies durable project and feedback state for SQLite migration", () => {
    expect(classifyRendererPersistence("openbuddy.projects")).toMatchObject({ owner: "sqlite-ipc", migrationRequired: true });
    expect(classifyRendererPersistence("openbuddy.feedback")).toMatchObject({ owner: "sqlite-ipc", migrationRequired: true });
  });

  it("keeps drafts as an explicit renderer cache", () => {
    expect(assertRendererPersistenceClassification("openbuddy.drafts")).toMatchObject({ owner: "renderer-cache", migrationRequired: false });
  });

  it("assigns PI ownership to conversation state", () => {
    expect(assertRendererPersistenceClassification("sessions-store").owner).toBe("pi-session");
  });

  it("fails closed for an unclassified durable key", () => {
    expect(() => assertRendererPersistenceClassification("openbuddy.unknown")).toThrow("Unclassified renderer persistence key");
    expect(RENDERER_PERSISTENCE_CLASSIFICATIONS).toHaveLength(5);
  });
});
