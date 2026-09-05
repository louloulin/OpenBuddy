import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPiPackageInstalled, probePiPackage } from "./pi-package-installed";

describe("isPiPackageInstalled", () => {
  it("returns false for a package that is not in node_modules", () => {
    expect(isPiPackageInstalled("pi-package-installed-test-does-not-exist-xyz")).toBe(false);
  });

  it("returns true for a package that exists in the workspace", () => {
    // @earendil-works/pi-coding-agent is a real dependency of OpenBuddy.
    expect(isPiPackageInstalled("@earendil-works/pi-coding-agent")).toBe(true);
  });

  // R-X1: packages installed via the marketplace land under
  // `<agentHome>/plugins/<name>/`, which is outside projectRoot's
  // node_modules. The detector must find them, otherwise the auto-
  // passthrough path never fires for marketplace-installed packages.
  describe("marketplace plugin tree (R-X1)", () => {
    let fakeAgentHome: string;
    let prevAgentDir: string | undefined;

    beforeEach(() => {
      fakeAgentHome = mkdtempSync(join(tmpdir(), "pi-pkg-installed-rx1-"));
      prevAgentDir = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = fakeAgentHome;
    });

    afterEach(() => {
      if (prevAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      }
      rmSync(fakeAgentHome, { recursive: true, force: true });
    });

    it("returns true for a package installed under <agentHome>/plugins/<name>", () => {
      const pkgDir = join(fakeAgentHome, "plugins", "pi-rx1-fixture");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "pi-rx1-fixture", version: "9.9.9" }),
      );
      expect(isPiPackageInstalled("pi-rx1-fixture")).toBe(true);
    });

    it("returns false when the plugins directory exists but lacks the package", () => {
      mkdirSync(join(fakeAgentHome, "plugins"), { recursive: true });
      expect(isPiPackageInstalled("pi-rx1-missing")).toBe(false);
    });

    it("returns false when the plugins directory does not exist at all", () => {
      // no mkdir — agentHome()/plugins/ does not exist
      expect(isPiPackageInstalled("pi-rx1-missing")).toBe(false);
    });

    it("returns false when package.json exists but cannot be parsed", () => {
      const pkgDir = join(fakeAgentHome, "plugins", "pi-rx1-broken");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), "{ not valid json");
      expect(isPiPackageInstalled("pi-rx1-broken")).toBe(false);
    });
  });

  it("returns false for the empty string (defensive guard)", () => {
    expect(isPiPackageInstalled("")).toBe(false);
  });
});

describe("probePiPackage", () => {
  it("reports installed:false with null version for missing packages", () => {
    const result = probePiPackage("pi-package-installed-test-does-not-exist-xyz");
    expect(result).toEqual({ installed: false, version: null });
  });

  it("reports installed:true with a version for an installed package", () => {
    const result = probePiPackage("@earendil-works/pi-coding-agent");
    expect(result.installed).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // R-X1: probePiPackage must report version from the marketplace tree.
  describe("marketplace plugin tree (R-X1)", () => {
    let fakeAgentHome: string;
    let prevAgentDir: string | undefined;

    beforeEach(() => {
      fakeAgentHome = mkdtempSync(join(tmpdir(), "pi-pkg-probe-rx1-"));
      prevAgentDir = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = fakeAgentHome;
    });

    afterEach(() => {
      if (prevAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      }
      rmSync(fakeAgentHome, { recursive: true, force: true });
    });

    it("reports installed:true + the version from the marketplace tree", () => {
      const pkgDir = join(fakeAgentHome, "plugins", "pi-rx1-probe");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "pi-rx1-probe", version: "0.1.2" }),
      );
      const result = probePiPackage("pi-rx1-probe");
      expect(result).toEqual({ installed: true, version: "0.1.2" });
    });

    it("returns null version when marketplace package.json lacks a version field", () => {
      const pkgDir = join(fakeAgentHome, "plugins", "pi-rx1-no-version");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "pi-rx1-no-version" }),
      );
      const result = probePiPackage("pi-rx1-no-version");
      expect(result).toEqual({ installed: true, version: null });
    });
  });
});
