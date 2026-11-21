/**
 * Main-process risk reading of a shell command (`!cmd` strong confirmation, the agent's `bash`
 * card). The renderer has its own badge classifier (chat-core `command-risk.ts`) and sends its
 * reading along with `agent_bash`; that value may only raise the level decided here, never lower
 * it (permissions.ts `userCommand`).
 *
 * The command is split the way a POSIX shell would split it — quotes, escapes, `;` `&&` `||` `|`,
 * subshells and `$(…)` / `` `…` `` / `<(…)` substitutions (also inside double quotes) — and every
 * simple command is judged on its real command name: `/bin/rm`, `\rm`, `r''m`, `sudo rm`,
 * `xargs rm`, `bash -c 'rm …'`, `find -exec rm` and `find -delete` all count as `rm`, while quoted
 * arguments (`grep -r "rm -rf" .`, `echo rm`) stay data. A command that cannot be parsed is risky.
 */

export type RiskLevel = "low" | "medium" | "high";

export interface CommandAssessment {
  level: RiskLevel;
  /** Why (Chinese, for the card's tooltip); empty when low. */
  reasons: string[];
  /** Set when the command deletes or overwrites files: the paths it names (possibly none). */
  deletes?: string[];
}

const MAX_DEPTH = 6;
const MAX_PATHS = 20;
/** Marks a word that held a substitution: its value is only known at run time. */
const DYNAMIC = "\u0000$";

interface Acc { level: RiskLevel; reasons: string[]; deletes?: string[] }
const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
function raise(acc: Acc, level: RiskLevel, reason: string) {
  if (RANK[level] > RANK[acc.level]) acc.level = level;
  if (!acc.reasons.includes(reason)) acc.reasons.push(reason);
}
function deleting(acc: Acc, paths: string[], level: RiskLevel, reason: string) {
  acc.deletes = [...(acc.deletes ?? []), ...paths.filter((p) => !acc.deletes?.includes(p))].slice(0, MAX_PATHS);
  raise(acc, level, reason);
}

// ---------- lexer ----------

/** Index of the `)` closing the `(` at `open`, skipping quotes, escapes and nested parentheses; -1 if none. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "'") { i = s.indexOf("'", i + 1); if (i < 0) return -1; }
    else if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === "\\") i++;
      if (i >= s.length) return -1;
    } else if (c === "`") { i = backtick(s, i); if (i < 0) return -1; }
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}
/** Index of the backtick closing the one at `open`; -1 if none. */
function backtick(s: string, open: number): number {
  for (let i = open + 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "`") return i;
  }
  return -1;
}

/**
 * Splits `script` into simple commands (words after quote removal), appended to `out`.
 * Substitutions become commands of their own. Redirection targets are dropped. False when the
 * script is unbalanced or nested too deep.
 */
function lex(script: string, depth: number, out: string[][]): boolean {
  if (depth > MAX_DEPTH) return false;
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let redirect = false;
  let ok = true;
  const endWord = () => {
    if (inWord) { if (redirect) redirect = false; else words.push(word); }
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
    redirect = false;
  };
  /** A `$(…)` / `` `…` `` / `<(…)` body: its commands run too; the word's value becomes dynamic. */
  const substitution = (body: string) => {
    if (!lex(body, depth + 1, out)) ok = false;
    word += DYNAMIC;
    inWord = true;
  };
  for (let i = 0; i < script.length; ) {
    const c = script[i];
    const next = script[i + 1];
    if (c === "\\") {
      if (next !== undefined && next !== "\n") { word += next; inWord = true; }
      i += 2;
    } else if (c === "'") {
      const end = script.indexOf("'", i + 1);
      if (end < 0) return false;
      word += script.slice(i + 1, end);
      inWord = true;
      i = end + 1;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < script.length && script[i] !== '"'; ) {
        const d = script[i];
        if (d === "\\" && i + 1 < script.length && '"\\$`\n'.includes(script[i + 1])) {
          if (script[i + 1] !== "\n") word += script[i + 1];
          i += 2;
        } else if (d === "$" && script[i + 1] === "(") {
          const end = closing(script, i + 1);
          if (end < 0) return false;
          substitution(script.slice(i + 2, end));
          i = end + 1;
        } else if (d === "`") {
          const end = backtick(script, i);
          if (end < 0) return false;
          substitution(script.slice(i + 1, end));
          i = end + 1;
        } else {
          word += d;
          i++;
        }
      }
      if (i >= script.length) return false;
      i++;
    } else if ((c === "$" || c === "<" || c === ">") && next === "(") {
      const end = closing(script, i + 1);
      if (end < 0) return false;
      substitution(script.slice(i + 2, end));
      i = end + 1;
    } else if (c === "`") {
      const end = backtick(script, i);
      if (end < 0) return false;
      substitution(script.slice(i + 1, end));
      i = end + 1;
    } else if (c === "#" && !inWord) {
      const end = script.indexOf("\n", i);
      i = end < 0 ? script.length : end;
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
    } else if (c === "&" && next === ">") {
      endWord();
      redirect = true;
      i += script[i + 2] === ">" ? 3 : 2;
    } else if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      endCommand();
      i++;
    } else if (c === "<" || c === ">") {
      // `2>file`: the descriptor number is part of the operator, not an argument.
      if (inWord && /^\d+$/.test(word)) { word = ""; inWord = false; } else endWord();
      for (i++; i < script.length && "<>|&".includes(script[i]); i++);
      redirect = true;
    } else {
      word += c;
      inWord = true;
      i++;
    }
  }
  endCommand();
  return ok;
}

// ---------- simple commands ----------

const RESERVED = new Set(["!", "{", "}", "if", "then", "else", "elif", "fi", "while", "until", "do", "done", "esac", "time", "coproc"]);
/** Prefix commands that run the rest of their arguments, with the options that take a value. */
const WRAPPERS: Record<string, { valued?: string[]; positional?: number }> = {
  sudo: { valued: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T", "-R", "--user", "--group", "--chdir", "--prompt", "--role", "--type", "--host", "--other-user", "--close-from", "--chroot", "--command-timeout"] },
  doas: { valued: ["-u", "-C"] }, pkexec: { valued: ["--user"] },
  command: {}, builtin: {}, exec: { valued: ["-a"] }, nohup: {}, noglob: {}, setsid: {},
  stdbuf: { valued: ["-i", "-o", "-e"] }, nice: { valued: ["-n", "--adjustment"] }, ionice: { valued: ["-c", "-n", "-p", "-P", "-u"] },
  timeout: { valued: ["-s", "-k", "--signal", "--kill-after"], positional: 1 },
  xargs: { valued: ["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file", "--max-lines", "--max-chars", "--replace", "--eof", "--process-slot-var"] },
  busybox: {}, npx: { valued: ["-p", "--package"] }, pnpx: {}, bunx: { valued: ["-p", "--package"] },
};
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish"]);
const INTERPRETERS: Record<string, string[]> = {
  python: ["-c"], python3: ["-c"], python2: ["-c"], perl: ["-e", "-E"], ruby: ["-e"], node: ["-e", "--eval", "-p", "--print"],
  deno: ["eval"], bun: ["-e", "--eval"], php: ["-r"],
};
const DELETE_API = /\b(rmtree|removedirs|unlink(Sync)?|rmSync|rmdirSync|rm_rf|rm_r|os\.remove|fs\.rm|File\.delete|FileUtils\.rm)\b|\brm\s+-[a-zA-Z]*[rRf]/;
const REMOVERS = new Set(["rm", "rmdir", "unlink", "shred", "srm", "wipe", "del", "erase", "rd", "remove-item", "rimraf", "trash", "trash-put"]);
const FORMATTERS = /^(mkfs(\..+)?|mke2fs|mkswap|mkntfs|mkdosfs|newfs(_.+)?|wipefs)$/;

/** Paths whose deletion or recursive permission change is catastrophic (the chat-core list, a bit wider). */
export function isBroadPath(path: string): boolean {
  if (!path) return false;
  if (path.includes("*")) return true;
  const p = path.length > 1 ? path.replace(/\/\.?$/, "").replace(/\/+$/, "") || "/" : path;
  if (p === "/" || p === ".." || /^~[A-Za-z0-9_.-]*$/.test(p) || /^\$\{?HOME\}?$/.test(p)) return true;
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return true;
  if (p === ".git" || /(^|\/)\.git(\/|$)/.test(p)) return true;
  return /^\/(usr|var|etc|bin|sbin|lib|lib64|opt|boot|root|home|Users|System|Library|Applications|private|tmp|dev|proc|sys|srv|mnt|media)$/.test(p);
}

/** Operands of a command: words that are not options (everything after `--`), skipping option values. */
function operands(args: string[], valued: string[] = [], slashFlags = false): string[] {
  const out: string[] = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest) out.push(a);
    else if (a === "--") rest = true;
    else if (valued.includes(a)) i++;
    else if ((a.startsWith("-") && a.length > 1) || (slashFlags && /^\/[A-Za-z?]$/.test(a))) continue;
    else out.push(a);
  }
  return out;
}
const shortFlags = (args: string[]) => args.filter((a) => /^-[A-Za-z]+$/.test(a)).join("");
const has = (args: string[], ...flags: string[]) => args.some((a) => flags.includes(a));

/** Judge one script (`bash -c` / `eval` bodies too); false when it cannot be parsed. */
function judgeScript(script: string, depth: number, acc: Acc): boolean {
  const commands: string[][] = [];
  const ok = lex(script, depth, commands);
  for (const words of commands) judge(words, depth, acc);
  return ok;
}

function judge(input: string[], depth: number, acc: Acc): void {
  if (depth > MAX_DEPTH) return raise(acc, "medium", "命令嵌套过深，无法判断");
  let words = input;
  // Assignments, reserved words and function headers before the command name.
  for (;;) {
    const [first] = words;
    if (first === undefined) return;
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(first) || RESERVED.has(first)) words = words.slice(1);
    else if (first === "function") words = words.slice(2);
    else break;
  }
  // `{rm,-rf,~}` is brace-expanded into `rm -rf ~`.
  if (/^\{[^{}\s]*,[^{}\s]*\}$/.test(words[0])) words = [...words[0].slice(1, -1).split(","), ...words.slice(1)].filter(Boolean);
  if (!words.length) return;
  const raw = words[0];
  const args = words.slice(1);
  if (raw.includes(DYNAMIC) || raw.includes("$")) return raise(acc, "medium", "命令名在运行时才确定，无法判断");
  const name = (raw.replace(/^\\+/, "").split("/").pop() ?? "").toLowerCase();

  const wrapper = WRAPPERS[name];
  if (wrapper) {
    if (name === "command" && args.some((a) => /^-[a-zA-Z]*[vV]/.test(a))) return; // `command -v rm` only prints
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === "--") { i++; break; }
      if (!a.startsWith("-") || a.length === 1) break;
      if (wrapper.valued?.includes(a)) i++;
    }
    i += Math.min(wrapper.positional ?? 0, args.length - i);
    return judge(args.slice(i), depth + 1, acc);
  }
  if (name === "env") {
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === "-S" || a === "--split-string") { judgeScript([args[i + 1] ?? "", ...args.slice(i + 2)].join(" "), depth + 1, acc) || raise(acc, "medium", "命令无法解析"); return; }
      if (a === "-u" || a === "-C" || a === "--unset" || a === "--chdir") { i++; continue; }
      if (a.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue;
      break;
    }
    return judge(args.slice(i), depth + 1, acc);
  }
  if (name === "watch") return void (judgeScript(operands(args, ["-n", "--interval", "-d"]).join(" "), depth + 1, acc) || raise(acc, "medium", "命令无法解析"));
  if (name === "eval") return void (judgeScript(args.join(" "), depth + 1, acc) || raise(acc, "medium", "命令无法解析"));
  if (SHELLS.has(name)) {
    const flag = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (flag >= 0) {
      const body = args.slice(flag + 1).find((a) => !/^[-+]/.test(a));
      if (body !== undefined && !judgeScript(body, depth + 1, acc)) raise(acc, "medium", "命令无法解析");
      return;
    }
    if (!operands(args).length) raise(acc, "medium", "从标准输入执行脚本");
    return;
  }
  const inline = INTERPRETERS[name];
  if (inline) {
    const at = args.findIndex((a) => inline.includes(a));
    const code = at >= 0 ? args[at + 1] ?? "" : "";
    if (DELETE_API.test(code)) deleting(acc, [], "medium", "内联脚本会删除文件");
    return;
  }

  if (REMOVERS.has(name)) {
    const paths = operands(args, [], ["del", "erase", "rd"].includes(name));
    const recursive = /[rR]/.test(shortFlags(args)) || has(args, "--recursive", "-Recurse", "/s", "/S") || name === "rimraf";
    const broad = paths.some((p) => isBroadPath(p) || p.startsWith("/dev/"));
    return deleting(acc, paths, broad && (recursive || name !== "rm") ? "high" : "medium", broad ? `删除危险路径：${paths.filter((p) => isBroadPath(p) || p.startsWith("/dev/")).join("、")}` : "删除文件");
  }
  if (name === "find") return judgeFind(args, depth, acc);
  if (name === "git") return judgeGit(args, acc);
  if (name === "dd") {
    const target = args.find((a) => a.startsWith("of="))?.slice(3);
    if (target !== undefined) deleting(acc, [target], target.startsWith("/dev/") ? "high" : "medium", target.startsWith("/dev/") ? "dd 写入块设备" : "dd 覆盖文件");
    return;
  }
  if (FORMATTERS.test(name)) return deleting(acc, operands(args, ["-t", "-L", "-b", "-c", "-l", "-O", "-E", "-m", "-N", "-T", "-U"]), "high", "格式化文件系统");
  if (name === "truncate") return deleting(acc, operands(args, ["-s", "-r", "--size", "--reference"]), "medium", "截断文件");
  if (name === "rsync" && args.some((a) => a.startsWith("--delete") || a === "--remove-source-files"))
    return deleting(acc, operands(args).slice(-1), "medium", "rsync --delete 删除目标中多出的文件");
  if (name === "chmod" || name === "chown" || name === "chgrp") {
    const recursive = /R/.test(shortFlags(args)) || has(args, "--recursive");
    const targets = operands(args).slice(args.some((a) => a.startsWith("--reference")) ? 0 : 1);
    if (targets.includes("/") || (recursive && targets.some(isBroadPath))) raise(acc, "high", `${name} 修改宽泛路径：${targets.join("、")}`);
    return;
  }
  if (name === "kill" || name === "killall" || name === "pkill") raise(acc, "medium", `${name} 终止进程`);
}

/** `find`: `-delete`, or `-exec` / `-execdir` / `-ok` running a deleting command. */
function judgeFind(args: string[], depth: number, acc: Acc) {
  let i = 0;
  while (i < args.length && ["-H", "-L", "-P"].includes(args[i])) i++;
  const roots: string[] = [];
  for (; i < args.length && !/^[-(!)]/.test(args[i]); i++) roots.push(args[i]);
  const paths = roots.length ? roots : ["."];
  for (; i < args.length; i++) {
    if (args[i] === "-delete") deleting(acc, paths, paths.some(isBroadPath) ? "high" : "medium", "find -delete 批量删除");
    else if (["-exec", "-execdir", "-ok", "-okdir"].includes(args[i])) {
      const end = args.findIndex((a, j) => j > i && (a === ";" || a === "+"));
      const inner: Acc = { level: "low", reasons: [] };
      judge(args.slice(i + 1, end < 0 ? undefined : end), depth + 1, inner);
      if (inner.deletes) deleting(acc, paths, inner.level, "find -exec 批量删除");
      else if (inner.level !== "low") inner.reasons.forEach((r) => raise(acc, inner.level, r));
      if (end < 0) break;
      i = end;
    }
  }
}

/** `git`: commands that delete untracked files or throw away work. */
function judgeGit(input: string[], acc: Acc) {
  let i = 0;
  for (; i < input.length && input[i].startsWith("-"); i++) if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(input[i])) i++;
  const sub = input[i];
  const args = input.slice(i + 1);
  const flags = shortFlags(args);
  switch (sub) {
    case "clean":
      if (!/n/.test(flags) && !has(args, "--dry-run")) deleting(acc, operands(args, ["-e", "--exclude"]), "high", "git clean 删除未跟踪的文件");
      return;
    case "rm":
      if (!has(args, "--cached")) deleting(acc, operands(args), "medium", "git rm 删除文件");
      return;
    case "reset":
      if (has(args, "--hard")) raise(acc, "high", "git reset --hard 丢弃工作区改动");
      return;
    case "checkout":
      if (/f/.test(flags) || has(args, "--force", ".")) raise(acc, "high", "git checkout 丢弃本地改动");
      return;
    case "push":
      if (/f/.test(flags) || args.some((a) => a.startsWith("--force") || a === "--mirror")) raise(acc, "high", "git push --force 覆盖远端");
      return;
    case "branch":
      if (/D/.test(flags)) raise(acc, "medium", "git branch -D 强制删除分支");
      return;
    case "stash":
      if (args[0] === "drop" || args[0] === "clear") raise(acc, "medium", "git stash drop/clear 丢弃储藏");
      return;
  }
}

/** The main process's reading of a command; unparseable input is medium (and deleting if it names a remover). */
export function assessCommand(command: string): CommandAssessment {
  const acc: Acc = { level: "low", reasons: [] };
  if (!judgeScript(command, 0, acc)) {
    raise(acc, "medium", "命令无法解析");
    if (/(^|[^\w.-])(rm|rmdir|unlink|shred|mkfs[\w.]*|truncate|dd|find|xargs|git)([^\w.-]|$)/.test(command)) acc.deletes ??= [];
  }
  return acc;
}
