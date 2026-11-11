import { loadSkills, type Skill } from "@earendil-works/pi-coding-agent";
import { realpath, stat } from "node:fs/promises";
import type { Settings } from "./settings.js";
export class SkillsService {
  constructor(private settings: Settings) {}
  discover(cwd: string): Skill[] {
    const c = this.settings.config.read();
    return loadSkills({
      cwd,
      agentDir: this.settings.dir,
      skillPaths: c.skillPaths,
      includeDefaults: true,
    }).skills;
  }
  active(cwd: string) {
    const disabled = this.settings.config.read().disabledSkills;
    return this.discover(cwd).filter((s) => !disabled.includes(s.name));
  }
  list(cwd: string) {
    const disabled = this.settings.config.read().disabledSkills;
    return this.discover(cwd).map((s) => ({
      name: s.name,
      description: s.description,
      path: s.baseDir,
      scope: s.filePath.startsWith(this.settings.dir) ? "user" : "repo",
      enabled: !disabled.includes(s.name),
      userInvocable: true,
    }));
  }
  async add(path: string) {
    const actual = await realpath(path);
    await stat(actual);
    const c = this.settings.config.read();
    if (!c.skillPaths.includes(actual)) c.skillPaths.push(actual);
    this.settings.config.write(c);
  }
  async remove(path: string) {
    const actual = await realpath(path),
      c = this.settings.config.read();
    if (!c.skillPaths.includes(actual))
      throw Error("只能移除通过添加路径安装的技能");
    c.skillPaths = c.skillPaths.filter((p) => p !== actual);
    this.settings.config.write(c);
  }
  toggle(name: string, enabled: boolean) {
    const c = this.settings.config.read();
    c.disabledSkills = c.disabledSkills.filter((n) => n !== name);
    if (!enabled) c.disabledSkills.push(name);
    this.settings.config.write(c);
  }
}
