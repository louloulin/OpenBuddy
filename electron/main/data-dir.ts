/**
 * electron/main/data-dir.ts
 *
 * 数据目录(userData)覆盖:用户在设置里换一个目录,重启后生效。
 *
 * 为什么需要"指针文件"而不是直接把路径写进 userData 里的配置:
 *   数据目录本身就是 userData —— 把"我该用哪个目录"记在**它自己**里面,换目录
 *   的那一刻就把这条记录一起丢掉了。所以指针必须存在 userData **之外**:
 *   `<appData>/OpenBuddy/data-dir.json`(默认目录的同级),与当前生效的目录无关。
 *
 * 为什么只在开机时应用(`applyDataDirOverride`):
 *   Electron 的 `app.setPath("userData", …)` 必须在 app ready 之前调用才彻底
 *   生效(缓存 / 日志 / 会话 / 审计全部派生自它)。运行中改路径会让同一进程里
 *   一半子系统看新路径、一半看旧路径 —— 与其半途改,不如明确"重启后生效"。
 *
 * 失败一律**降级为默认目录**而不是抛错:指针文件损坏 / 目标盘离线 / 只读挂载
 * 都不该让应用起不来 —— 那是用户数据的家,不是配置的开关。
 */
import { app } from "electron";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const POINTER_FILE_NAME = "data-dir.json";
/** 产品级的指针目录名(与默认 userData 同级的兄弟目录)。 */
const POINTER_DIR_NAME = "OpenBuddy";

let defaultUserDataPath = "";
let overridePath: string | null = null;

/** 开机第一件事调用:记下默认目录(此后 `app.getPath` 可能已被覆盖)。 */
export function captureDefaultUserDataPath(): string {
  if (!defaultUserDataPath) defaultUserDataPath = app.getPath("userData");
  return defaultUserDataPath;
}

export function getDefaultUserDataPath(): string {
  return defaultUserDataPath || app.getPath("userData");
}

/** 指针文件位置。默认目录还没记下来时返回 null(调用方按"没有覆盖"处理)。 */
export function pointerFilePath(): string | null {
  const base = defaultUserDataPath;
  if (!base) return null;
  return join(dirname(base), POINTER_DIR_NAME, POINTER_FILE_NAME);
}

function isWritableDir(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 读取指针文件。任何异常都视为"没有覆盖"。 */
export function readDataDirOverride(): string | null {
  const file = pointerFilePath();
  if (!file) return null;
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { path?: unknown };
    const dir = typeof parsed?.path === "string" ? parsed.path.trim() : "";
    if (!dir || !isAbsolute(dir)) return null;
    return resolve(dir);
  } catch {
    return null;
  }
}

/**
 * 把指针文件里的目录应用到 Electron。返回真正生效的目录(null = 用默认)。
 *
 * 会顺手确保目录存在可写:用户可能把数据放在外接盘上,拔盘启动时应该安静地
 * 回到默认目录,而不是让整个应用崩在启动阶段。
 */
export function applyDataDirOverride(): string | null {
  const dir = readDataDirOverride();
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  if (!isWritableDir(dir)) return null;
  app.setPath("userData", dir);
  overridePath = dir;
  return dir;
}

export interface DataDirDescription {
  /** 当前生效的目录。 */
  path: string;
  /** 未设置覆盖时的默认目录(给"恢复默认"用)。 */
  defaultPath: string;
  /** 指针文件里记的目录(未覆盖时为 null)。 */
  override: string | null;
  /** 当前是否处于覆盖状态。 */
  isOverridden: boolean;
}

export function describeDataDir(): DataDirDescription {
  const current = app.getPath("userData");
  return {
    path: current,
    defaultPath: getDefaultUserDataPath(),
    override: overridePath,
    isOverridden: Boolean(overridePath) && current !== getDefaultUserDataPath(),
  };
}

/**
 * 写入覆盖(不立即生效 —— 需要重启)。
 *
 * 校验:必须是绝对路径、必须可创建可写、不能与默认目录/当前目录相同。
 * 这些校验在 main 侧做,因为只有 main 知道目录的绝对语义。
 */
export function setDataDir(rawDir: string): { ok: true; path: string; requiresRestart: boolean } {
  const dir = typeof rawDir === "string" ? rawDir.trim() : "";
  if (!dir) throw new Error("数据目录不能为空");
  if (!isAbsolute(dir)) throw new Error("数据目录必须是绝对路径");
  const target = resolve(dir);

  const current = app.getPath("userData");
  const fallback = getDefaultUserDataPath();
  if (target === current) {
    return { ok: true, path: target, requiresRestart: false };
  }
  if (target === fallback) {
    // 选回了默认位置 = 清掉覆盖,而不是写一条指向默认目录的"覆盖"。
    resetDataDir();
    return { ok: true, path: target, requiresRestart: true };
  }

  try {
    mkdirSync(target, { recursive: true });
  } catch (cause) {
    throw new Error(`无法创建目录:${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!isWritableDir(target)) throw new Error("目录不可写,请换一个位置");

  const file = pointerFilePath();
  if (!file) throw new Error("无法定位数据目录指针文件");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ path: target }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { ok: true, path: target, requiresRestart: true };
}

/** 清掉覆盖(回到默认目录)。同样重启后生效。 */
export function resetDataDir(): { ok: true; requiresRestart: boolean } {
  const file = pointerFilePath();
  if (file && existsSync(file)) {
    try {
      rmSync(file);
    } catch {
      /* 删不掉就当没删掉 —— 下次启动仍会用旧目录,不是数据损失 */
    }
  }
  return { ok: true, requiresRestart: true };
}
