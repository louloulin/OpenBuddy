import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setupProfileOptions } from "./profile-options-setup";

describe("host-modules/bootstrap/profile-options-setup", () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "openbuddy-profile-options-setup-"));
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns resolvedProfile + profileOptions under default env", async () => {
    const { resolvedProfile, profileOptions } = await setupProfileOptions({
      env: { HOME: fakeHome },
    });

    expect(resolvedProfile.profileName).toBe("desktop");
    expect(resolvedProfile.profileDir).toContain("desktop");
    // profileOptions should be non-null (ensureOpenBuddyProfile succeeded)
    expect(profileOptions).not.toBeNull();
  });

  it("respects OPENBUDDY_PROFILE override", async () => {
    const { resolvedProfile } = await setupProfileOptions({
      env: { HOME: fakeHome, OPENBUDDY_PROFILE: "my-custom-profile" },
    });

    expect(resolvedProfile.profileName).toBe("my-custom-profile");
    expect(resolvedProfile.profileDir).toContain("my-custom-profile");
  });

  it("respects PI_PROFILE legacy alias", async () => {
    const { resolvedProfile } = await setupProfileOptions({
      env: { HOME: fakeHome, PI_PROFILE: "legacy-profile" },
    });

    expect(resolvedProfile.profileName).toBe("legacy-profile");
  });

  it("OPENBUDDY_PROFILE_DIR overrides default path resolution", async () => {
    const customDir = join(fakeHome, "explicit-profile");
    const { resolvedProfile } = await setupProfileOptions({
      env: { HOME: fakeHome, OPENBUDDY_PROFILE_DIR: customDir },
    });

    expect(resolvedProfile.profileDirRaw).toBe(customDir);
    expect(resolvedProfile.profileDir).toBe(customDir);
  });

  it("profileOptions is idempotent across multiple calls", async () => {
    // Calling setupProfileOptions twice with the same env should not throw.
    await setupProfileOptions({ env: { HOME: fakeHome } });
    await expect(setupProfileOptions({ env: { HOME: fakeHome } })).resolves.toBeDefined();
  });
});
