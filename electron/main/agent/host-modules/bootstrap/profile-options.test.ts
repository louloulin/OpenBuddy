import { describe, expect, it, vi } from "vitest";
import { isAbsolute, join } from "node:path";

// Mock electron before any agent-host import.
vi.mock("electron", () => ({
  app: { on: () => undefined, getPath: () => "/tmp/openbuddy-bootstrap-profile-options-test" },
}));

import { resolveProfileOptions, bootstrapProfileOptions } from "./profile-options";

describe("host-modules/bootstrap/profile-options", () => {
  it("defaults to profileName='desktop' and a home-relative profileDir", () => {
    const resolved = resolveProfileOptions({});
    expect(resolved.profileName).toBe("desktop");
    expect(resolved.profileDir).toMatch(/profiles[\\/]desktop$/);
    expect(resolved.profileDirRaw).toBeUndefined();
    expect(resolved.home).toBeTruthy();
  });

  it("uses OPENBUDDY_PROFILE when set, ignoring PI_PROFILE", () => {
    const resolved = resolveProfileOptions({
      OPENBUDDY_PROFILE: "research",
      PI_PROFILE: "ignored",
    });
    expect(resolved.profileName).toBe("research");
  });

  it("falls back to PI_PROFILE when OPENBUDDY_PROFILE is unset", () => {
    const resolved = resolveProfileOptions({ PI_PROFILE: "legacy-profile" });
    expect(resolved.profileName).toBe("legacy-profile");
  });

  it("resolves OPENBUDDY_PROFILE_DIR to an absolute path", () => {
    const resolved = resolveProfileOptions({
      OPENBUDDY_PROFILE_DIR: "relative/dir",
    });
    expect(resolved.profileDirRaw).toBe("relative/dir");
    // 不要写 `^[/\\]` —— Windows 的绝对路径以盘符开头(D:\...),那条正则必挂。
    expect(isAbsolute(resolved.profileDir)).toBe(true);
    expect(resolved.profileDir.endsWith(join("relative", "dir"))).toBe(true);
    expect(resolved.profileName).toBe("desktop"); // profileName still defaults
  });

  it("OPENBUDDY_PROFILE_DIR takes precedence over home-relative resolution", () => {
    const resolved = resolveProfileOptions({
      OPENBUDDY_PROFILE: "alpha",
      OPENBUDDY_PROFILE_DIR: "/abs/profile",
    });
    expect(resolved.profileName).toBe("alpha");
    expect(resolved.profileDir).toMatch(/[/\\]abs[/\\]profile$/);
  });

  it("bootstrapProfileOptions returns OpenBuddyProfileOptions shape", () => {
    const opts = bootstrapProfileOptions({ OPENBUDDY_PROFILE: "staging" });
    expect(opts.profileName).toBe("staging");
    expect(opts.profileDir).toBeUndefined(); // raw env value, may be undefined
    expect(opts.home).toBeTruthy();
  });

  it("bootstrapProfileOptions preserves OPENBUDDY_PROFILE_DIR (raw) as undefined when relative", () => {
    const opts = bootstrapProfileOptions({ OPENBUDDY_PROFILE_DIR: "x/y" });
    expect(opts.profileDir).toBe("x/y");
  });
});
