import { describe, it, expect } from "vitest";
import { checkCommandRisk, riskLabel, type RiskLevel } from "../security/command-risk";

describe("checkCommandRisk — 空命令与无风险", () => {
  it("空字符串 / undefined / null 为 low", () => {
    expect(checkCommandRisk("")).toEqual({ level: "low", reasons: [] });
    expect(checkCommandRisk(undefined)).toEqual({ level: "low", reasons: [] });
    expect(checkCommandRisk(null)).toEqual({ level: "low", reasons: [] });
    expect(checkCommandRisk("   ")).toEqual({ level: "low", reasons: [] });
  });

  it("普通安全命令为 low", () => {
    expect(checkCommandRisk("ls -la").level).toBe("low");
    expect(checkCommandRisk("echo hello").level).toBe("low");
    expect(checkCommandRisk("npm install").level).toBe("low");
    expect(checkCommandRisk("git status").level).toBe("low");
  });
});

describe("checkCommandRisk — rm 解析", () => {
  it("rm -rf 危险路径(/) 为 high", () => {
    const r = checkCommandRisk("rm -rf /");
    expect(r.level).toBe("high");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("rm -rf ~ 与 $HOME / ${HOME} 为 high", () => {
    expect(checkCommandRisk("rm -rf ~").level).toBe("high");
    expect(checkCommandRisk("rm -rf $HOME").level).toBe("high");
    expect(checkCommandRisk("rm -rf ${HOME}").level).toBe("high");
  });

  it("rm -rf 含通配符路径为 high", () => {
    expect(checkCommandRisk("rm -rf /*").level).toBe("high");
    expect(checkCommandRisk("rm -rf node_modules/*").level).toBe("high");
  });

  it("rm -rf .git / 含 .git 片段为 high", () => {
    expect(checkCommandRisk("rm -rf .git").level).toBe("high");
    expect(checkCommandRisk("rm -rf repo/.git").level).toBe("high");
    expect(checkCommandRisk("rm -rf .git/objects").level).toBe("high");
  });

  it("rm -rf 系统顶层目录为 high", () => {
    expect(checkCommandRisk("rm -rf /usr").level).toBe("high");
    expect(checkCommandRisk("rm -rf /etc").level).toBe("high");
    expect(checkCommandRisk("rm -rf /System").level).toBe("high");
  });

  it("rm -rf 普通项目路径为 medium(不是 low)", () => {
    const r = checkCommandRisk("rm -rf build");
    expect(r.level).toBe("medium");
  });

  it("sudo 前缀仍识别", () => {
    expect(checkCommandRisk("sudo rm -rf /").level).toBe("high");
    expect(checkCommandRisk("sudo rm -rf build").level).toBe("medium");
  });

  it("\\rm 与 /bin/rm 形式仍识别", () => {
    expect(checkCommandRisk("\\rm -rf /").level).toBe("high");
    expect(checkCommandRisk("/bin/rm -rf /").level).toBe("high");
  });

  it("短选项分写 -r -f 等价于 -rf", () => {
    expect(checkCommandRisk("rm -r -f /").level).toBe("high");
    expect(checkCommandRisk("rm -R -f /").level).toBe("high");
  });

  it("短选项连写 -fr / -Rf 等价于 -rf", () => {
    expect(checkCommandRisk("rm -fr /").level).toBe("high");
    expect(checkCommandRisk("rm -Rf /").level).toBe("high");
  });

  it("长选项 --recursive --force", () => {
    expect(checkCommandRisk("rm --recursive --force /").level).toBe("high");
  });

  it("-- 之后的 token 视为路径", () => {
    expect(checkCommandRisk("rm -rf -- /").level).toBe("high");
  });

  it("仅 rm 无选项为 low", () => {
    expect(checkCommandRisk("rm file.txt").level).toBe("low");
    expect(checkCommandRisk("rm -f file.txt").level).toBe("low");
  });

  it("仅递归无强制为 low", () => {
    expect(checkCommandRisk("rm -r build").level).toBe("low");
  });
});

describe("checkCommandRisk — 非 rm 高危正则", () => {
  it("dd 写入块设备", () => {
    expect(checkCommandRisk("dd if=img.iso of=/dev/sda").level).toBe("high");
  });
  it("mkfs 格式化", () => {
    expect(checkCommandRisk("mkfs.ext4 /dev/sda1").level).toBe("high");
  });
  it("chmod 777 根目录", () => {
    expect(checkCommandRisk("chmod 777 /").level).toBe("high");
  });
  it("git reset --hard", () => {
    expect(checkCommandRisk("git reset --hard HEAD~1").level).toBe("high");
  });
  it("git clean -fd", () => {
    expect(checkCommandRisk("git clean -fd").level).toBe("high");
  });
  it("git push --force", () => {
    expect(checkCommandRisk("git push --force origin main").level).toBe("high");
    expect(checkCommandRisk("git push -f origin main").level).not.toBe("high");
  });
  it("git checkout --force / checkout -- .", () => {
    expect(checkCommandRisk("git checkout -f main").level).toBe("high");
    expect(checkCommandRisk("git checkout -- .").level).toBe("high");
  });
  it("find -exec / -delete", () => {
    expect(checkCommandRisk("find . -exec rm {} \\;").level).toBe("high");
    expect(checkCommandRisk("find . -name tmp -delete").level).toBe("high");
  });
});

describe("checkCommandRisk — 中危正则", () => {
  it("git branch -D", () => {
    expect(checkCommandRisk("git branch -D feature").level).toBe("medium");
  });
  it("git stash drop / clear", () => {
    expect(checkCommandRisk("git stash drop").level).toBe("medium");
    expect(checkCommandRisk("git stash clear").level).toBe("medium");
  });
  it("kill / killall", () => {
    expect(checkCommandRisk("kill 1234").level).toBe("medium");
    expect(checkCommandRisk("killall node").level).toBe("medium");
  });
});

describe("riskLabel", () => {
  it("返回中文标签", () => {
    expect(riskLabel("high")).toBe("高危");
    expect(riskLabel("medium")).toBe("中危");
    expect(riskLabel("low")).toBe("");
  });
  it("reasons 在 low 时为空数组", () => {
    expect(checkCommandRisk("ls").reasons).toEqual([]);
  });
  it("类型约束:level 仅三种", () => {
    const levels: RiskLevel[] = ["low", "medium", "high"];
    for (const l of levels) expect(typeof riskLabel(l)).toBe("string");
  });
});
