/**
 * host-modules/_surface/profile-remote-contributions.test.ts
 *
 * v7-A — Verify listProfileRemoteContributions projects state.profileRemoteContributions
 * correctly and clones each contribution's descriptors array (so renderer mutations
 * don't leak back to the host).
 */
import { describe, expect, it } from "vitest";

import { listProfileRemoteContributions } from "./profile-remote-contributions";
import type { RemoteContribution } from "../_state-shape";

const makeDescriptor = (name: string): RemoteContribution["descriptors"][number] =>
  ({ name, namespace: name, method: name } as unknown as RemoteContribution["descriptors"][number]);

describe("listProfileRemoteContributions", () => {
  it("returns an empty array when no contributions are present", () => {
    const state: { profileRemoteContributions: Map<string, RemoteContribution> } = {
      profileRemoteContributions: new Map(),
    };
    expect(listProfileRemoteContributions(state)).toEqual([]);
  });

  it("projects the Map values to an array of contributions", () => {
    const state: { profileRemoteContributions: Map<string, RemoteContribution> } = {
      profileRemoteContributions: new Map([
        ["plugin-a", { package: "plugin-a", descriptors: [makeDescriptor("tool-1")] }],
        ["plugin-b", { package: "plugin-b", descriptors: [makeDescriptor("tool-2"), makeDescriptor("tool-3")] }],
      ]),
    };
    const result = listProfileRemoteContributions(state);
    expect(result).toHaveLength(2);
    expect(result[0].package).toBe("plugin-a");
    expect(result[1].package).toBe("plugin-b");
  });

  it("clones each contribution to avoid shared identity", () => {
    const descriptors = [makeDescriptor("tool-1")];
    const state: { profileRemoteContributions: Map<string, RemoteContribution> } = {
      profileRemoteContributions: new Map([
        ["plugin-a", { package: "plugin-a", descriptors }],
      ]),
    };
    const result = listProfileRemoteContributions(state);
    // Mutating the result must not affect the source Map.
    result[0].descriptors.push(makeDescriptor("tool-2"));
    expect(descriptors).toHaveLength(1);
    expect(result[0].descriptors).toHaveLength(2);
  });

  it("clones each descriptor to avoid shared identity", () => {
    const sharedDescriptor = makeDescriptor("tool-1");
    const state: { profileRemoteContributions: Map<string, RemoteContribution> } = {
      profileRemoteContributions: new Map([
        ["plugin-a", { package: "plugin-a", descriptors: [sharedDescriptor] }],
      ]),
    };
    const result = listProfileRemoteContributions(state);
    expect(result[0].descriptors[0]).not.toBe(sharedDescriptor);
    expect(result[0].descriptors[0]).toEqual(sharedDescriptor);
  });
});
