/**
 * src/lib/changelog/parse-changelog.ts
 *
 * 把仓库根的 `CHANGELOG.md` 解析成"应用内可渲染"的发布条目。
 *
 * 为什么在渲染进程里解析、而不是让 main 进程吐 JSON:
 *   - `CHANGELOG.md` 是随包发布的静态文本,构建期就能内联进 renderer bundle
 *     (`?raw`),不需要为它新增一条 IPC —— 少一条通道就少一块跨进程契约;
 *   - 解析是纯函数,可测、无副作用,失败只会退化成"没有条目",不会白屏。
 *
 * 为什么只取顶层 `-` 列表项:
 *   CHANGELOG 的嵌套项(`  - **Path A · BYOK**: …`)是上一层的细节补充。
 *   更新摘要卡是"一眼扫过"的位置,把嵌套项也铺上去只会让卡片变成一面墙。
 */

/** 与 `@openbuddy/ui-onboarding` 的 `WhatsNewItem` 结构一致(不反向依赖 UI 包)。 */
export interface ChangelogItem {
  title: string;
  description?: string;
}

export interface ChangelogRelease {
  /** 去掉 `v` 前缀的版本号,例如 `0.15.0`。 */
  version: string;
  /** 括号里的日期,原样保留(可能是 `未发布`)。 */
  date?: string;
  /** 标题行破折号之后的短句。 */
  headline?: string;
  items: ChangelogItem[];
}

export interface ParseChangelogOptions {
  /** 最多返回多少个版本,默认 3。 */
  maxReleases?: number;
  /** 每个版本最多保留多少条,默认 6。 */
  maxItems?: number;
  /** 单条标题 / 描述的字符上限(超出截断并加省略号)。 */
  maxTitleLength?: number;
  maxDescriptionLength?: number;
}

// `### v0.15.0 (2026-09-01) — Enterprise Casdoor × NewAPI × OpenBuddy integration`
const RELEASE_RE = /^###\s+v?([0-9][0-9A-Za-z.\-+]*)\s*(?:\(([^)]*)\))?\s*(?:[—–-]{1,2}\s*(.*))?$/;
const SECTION_RE = /^####\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.+)$/;

/** 行内 markdown → 纯文本(卡片里按纯文本渲染,不解析 HTML)。 */
function inlineText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * 拆分一条 bullet 的"标题 + 说明"。
 *
 * 三种写法都要认(CHANGELOG 里三种都真实存在):
 *   `- **Billing model v2**: 8 ledger flows …`   → 加粗标签作标题
 *   `- src/lib/newapi-provider.ts — BYOK adapter` → 破折号前的路径作标题
 *   `- Verified: NewAPI v1.0.0-rc.22 …`           → 冒号前作标题
 *
 * 输入是**原始行**(保留 `**` / 反引号),行内清洗交给调用方 ——
 * 顺序反过来的话,加粗标记会先被 inlineText 抹掉,这条分支永远进不来。
 */
function splitItem(text: string): ChangelogItem {
  const parts =
    // `**标签**:` 后面可以什么都不跟(分组性质的条目,细节在嵌套 bullet 里),
    // 所以正文部分是可选的 —— 早期版本要求 `(.+)` 会把这类条目整条漏掉。
    text.match(/^\*\*([^*]+)\*\*\s*(?:[:：—–-]\s*(.+))?$/) ??
    text.match(/^(.{4,60}?)\s+[—–]\s+(.+)$/) ??
    text.match(/^([^:：]{3,60})\s*[:：]\s+(.+)$/);
  if (!parts) return { title: stripTrailingPunctuation(text) };
  return {
    title: stripTrailingPunctuation(parts[1].trim()),
    description: parts[2] ? parts[2].trim() : undefined,
  };
}

/** `Dual-path NewAPI integration:` → 去掉行尾冒号(标题不该带标点)。 */
function stripTrailingPunctuation(text: string): string {
  return text.replace(/[:：。]\s*$/, "").trim();
}

export function parseChangelog(
  markdown: string,
  options: ParseChangelogOptions = {},
): ChangelogRelease[] {
  const {
    maxReleases = 3,
    maxItems = 6,
    maxTitleLength = 88,
    maxDescriptionLength = 200,
  } = options;

  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const release = line.match(RELEASE_RE);
    if (release) {
      current = {
        version: release[1],
        date: release[2] ? release[2].trim() : undefined,
        headline: release[3] ? inlineText(release[3]) || undefined : undefined,
        items: [],
      };
      releases.push(current);
      continue;
    }
    if (!current) continue;
    // 段内小标题(`#### 🎯 Commercial architecture`)只是分组,不进摘要。
    if (SECTION_RE.test(line)) continue;

    const bullet = line.match(BULLET_RE);
    if (!bullet) continue;
    // 嵌套项(有前导空白)是上一层细节,跳过。
    if (/^[ \t]/.test(line)) continue;

    const raw = bullet[1].trim();
    if (!raw) continue;

    // 先按原文拆分(加粗标签要靠 `**` 才能认出来),再逐段做行内清洗。
    const { title, description } = splitItem(raw);
    current.items.push({
      title: clamp(inlineText(title), maxTitleLength),
      description: description ? clamp(inlineText(description), maxDescriptionLength) : undefined,
    });
  }

  return releases
    .map((release) => ({ ...release, items: release.items.slice(0, maxItems) }))
    .filter((release) => release.items.length > 0)
    .slice(0, maxReleases);
}
