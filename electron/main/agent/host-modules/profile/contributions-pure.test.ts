import { describe, expect, it } from "vitest";
import {
  disposeProfileTypertRegistrations,
  normalizePublishedRemoteContribution,
  type ProfileTypertRegistration,
} from "./contributions-pure";
import type { RemoteContribution, RemoteDescriptor } from "../../../harness/remote-dispatch";

function descriptor(partial: Partial<RemoteDescriptor> = {}): RemoteDescriptor {
  return { namespace: "test", method: "m", implementation: "m", service: "svc", invocation: [], ...partial } as RemoteDescriptor;
}

describe("normalizePublishedRemoteContribution (extracted pure)", () => {
  it("returns the contribution untouched when package is not a known capability", () => {
    const contribution: RemoteContribution = {
      package: "unknown-pkg",
      descriptors: [{ namespace: "x", method: "y", implementation: "y", service: "s" }],
    };
    expect(normalizePublishedRemoteContribution(contribution)).toBe(contribution);
  });

  it("rewrites remoteExportX method names to canonical x + keeps implementation", () => {
    const contribution: RemoteContribution = {
      package: "@deepseek-ai/dsh-commands",
      descriptors: [
        { namespace: "commands", method: "remoteExportList", implementation: "remoteExportList", service: "commands" },
      ],
    };
    const normalized = normalizePublishedRemoteContribution(contribution);
    // descriptor rewritten to canonical lower-camel method ("list") pinned to the canonical service
    expect(normalized.descriptors.some((d) => d.method === "list" && d.service === "commands")).toBe(true);
  });
});

describe("disposeProfileTypertRegistrations (extracted pure)", () => {
  it("calls remoteDispose then dispose, in reverse registration order", () => {
    const order: string[] = [];
    const reg: ProfileTypertRegistration[] = [
      {
        contribution: { package: "a", invocations: [] } as unknown as ProfileTypertRegistration["contribution"],
        remoteDispose: () => order.push("a.remote"),
        dispose: () => order.push("a"),
      },
      {
        contribution: { package: "b", invocations: [] } as unknown as ProfileTypertRegistration["contribution"],
        remoteDispose: () => order.push("b.remote"),
        dispose: () => order.push("b"),
      },
    ];
    disposeProfileTypertRegistrations(reg);
    // reverse order: b first, then a; and for each, remote before dispose
    expect(order).toEqual(["b.remote", "b", "a.remote", "a"]);
  });

  it("handles registrations without a remoteDispose", () => {
    let disposed = 0;
    disposeProfileTypertRegistrations([
      { contribution: { package: "x", invocations: [] } as unknown as ProfileTypertRegistration["contribution"], dispose: () => { disposed += 1; } },
    ]);
    expect(disposed).toBe(1);
  });
});
