/**
 * pi-extensions-model — 「Pi 扩展」区块的纯函数模型层。
 *
 * 与 `marketplace-model`(ui-modules)同一套路:这里**不 import React / IPC**,
 * 只做数据整形,因此每条规则都能被单测直接覆盖;组件
 * (`PiExtensionsSection.tsx`)只负责渲染与调用动作,不重复实现业务判断。
 *
 * 为什么单独一层而不是塞进组件:UI 需要把**同一份市场数据**呈现成三种语义
 * (已安装 / 可升级 / 可安装),还要把桥接层的错误码翻译成补救动作。这两件事
 * 都是纯逻辑,放在组件里就只能靠渲染测试间接覆盖。
 */
import type {
  InstallState,
  MarketplaceCapability,
  MarketplaceEntry,
  MarketplaceKind,
} from "@openbuddy/ui-modules/components/marketplace-model";
import type {
  PiMarketEntryView,
  PiMarketErrorInfo,
  PiMarketRegistrySource,
  PiMarketSourceState,
  PiMarketSourceStatus,
  PiMarketSourcesView,
} from "@openbuddy/shared-types";

/**
 * 把桥接层的条目投影成市场 UI 的条目。
 *
 * 只搬 UI 真的会读的字段:`manifest` 不搬(渲染端只关心版本与能力),
 * `sourceId` / `alsoOfferedBy` 搬成卡片上的来源标注。
 */
export function toMarketplaceEntry(entry: PiMarketEntryView): MarketplaceEntry {
  return {
    id: entry.id,
    name: entry.name,
    publisher: entry.publisher,
    description: entry.description,
    version: entry.version,
    kinds: entry.kinds as readonly MarketplaceKind[],
    capabilities: entry.capabilities as readonly MarketplaceCapability[],
    ...(entry.installedVersion ? { installedVersion: entry.installedVersion } : {}),
    ...(entry.incompatible ? { incompatible: true } : {}),
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    ...(entry.dependencies ? { dependencies: entry.dependencies } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(typeof entry.installedBytes === "number" ? { installedBytes: entry.installedBytes } : {}),
  };
}

/**
 * 安装状态(`MarketplaceTab` 用它把卡片切到 installed / update-available 等外观)。
 *
 * 与 `marketplace-model.resolveInstallState` 的区别:这里的输入是桥接层的
 * 权威结论(`installedVersion` / `updateAvailable` / `incompatible` 由 main 判定),
 * 渲染端不再自己比较 semver —— 版本语义只有一处实现(main)。
 */
export function installStateOf(entry: PiMarketEntryView): InstallState {
  if (entry.incompatible) return "blocked";
  if (!entry.installedVersion) return "available";
  if (entry.updateAvailable) return "update-available";
  return "installed";
}

/** 「亦有镜像」标注:同 id 还被哪些低权重源提供。 */
export function mirrorLabel(entry: PiMarketEntryView): string | undefined {
  const mirrors = entry.alsoOfferedBy ?? [];
  return mirrors.length > 0 ? `亦有镜像:${mirrors.join(" / ")}` : undefined;
}

/** 来源标注:`local` 是本地索引,其余是配置的源 id。 */
export function sourceLabel(entry: PiMarketEntryView): string | undefined {
  if (!entry.sourceId) return undefined;
  return entry.sourceId === "local" ? "本地索引" : entry.sourceId;
}

export interface PiExtensionsGroups {
  readonly installed: readonly PiMarketEntryView[];
  readonly updatable: readonly PiMarketEntryView[];
  readonly available: readonly PiMarketEntryView[];
  readonly blocked: readonly PiMarketEntryView[];
}

/** 按「需要用户注意的程度」分组:可升级 → 已安装 → 可安装 → 被阻止。 */
export function groupPiMarketEntries(
  entries: readonly PiMarketEntryView[],
): PiExtensionsGroups {
  const installed: PiMarketEntryView[] = [];
  const updatable: PiMarketEntryView[] = [];
  const available: PiMarketEntryView[] = [];
  const blocked: PiMarketEntryView[] = [];
  for (const entry of entries) {
    switch (installStateOf(entry)) {
      case "update-available":
        updatable.push(entry);
        break;
      case "installed":
        installed.push(entry);
        break;
      case "blocked":
        blocked.push(entry);
        break;
      default:
        available.push(entry);
    }
  }
  return { installed, updatable, available, blocked };
}

export interface PiMarketSourceSummary {
  readonly fresh: number;
  readonly cached: number;
  readonly failed: number;
  readonly skipped: number;
  /** 「N 个源不可达,已用缓存」这类提示;没有需要注意的源时为 undefined。 */
  readonly warning?: string;
}

/**
 * 汇总每源状态。
 *
 * `cached` 与 `failed` 都会产生提示,但文案不同:前者「正在用上次的缓存」是可用
 * 状态,后者「没有缓存」需要用户去修源地址 —— 把两者混成一句会让用户以为市场坏了。
 */
export function summarizeSources(
  sources: readonly PiMarketSourceStatus[] | undefined,
): PiMarketSourceSummary {
  const list = sources ?? [];
  const fresh = list.filter((s) => s.state === "fresh").length;
  const cached = list.filter((s) => s.state === "cached").length;
  const failed = list.filter((s) => s.state === "failed").length;
  const skipped = list.filter((s) => s.state === "skipped").length;
  const parts: string[] = [];
  if (cached > 0) parts.push(`${cached} 个源不可达,已用上次缓存`);
  if (failed > 0) parts.push(`${failed} 个源不可达且没有缓存`);
  return {
    fresh,
    cached,
    failed,
    skipped,
    ...(parts.length > 0 ? { warning: parts.join("；") } : {}),
  };
}

export interface PiSourceChip {
  readonly id: string;
  readonly label: string;
  readonly state?: PiMarketSourceState;
  readonly entryCount: number;
  readonly error?: string;
}

/**
 * 顶部的来源 chips。
 *
 * 优先用一次刷新拿到的**权威**每源状态(`fresh` / `cached` / `failed` / `skipped`);
 * 没有刷新过时退回**从条目反推**(按 `sourceId` 分组计数)—— 这样打开市场就有
 * 来源信息,不需要为了画几个 chip 去强制联网。
 */
export function sourceChips(
  entries: readonly PiMarketEntryView[],
  statuses?: readonly PiMarketSourceStatus[],
): PiSourceChip[] {
  if (statuses && statuses.length > 0) {
    return statuses.map((status) => ({
      id: status.id,
      label: status.label ?? status.id,
      state: status.state,
      entryCount: status.entryCount,
      ...(status.error ? { error: status.error } : {}),
    }));
  }
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.sourceId ?? "local";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, entryCount]) => ({
    id,
    label: id === "local" ? "本地索引" : id,
    entryCount,
  }));
}

export interface PiMarketErrorAction {
  /** 一句话说明发生了什么。 */
  readonly title: string;
  /** 用户下一步该做什么。 */
  readonly hint: string;
  /** 是否值得重试(网络/源问题),false 表示重试同样的动作也不会成功。 */
  readonly retryable: boolean;
}

/**
 * 把错误码翻译成补救动作。
 *
 * 这张表是 UI 里**唯一**读错误码的地方 —— 桥接层新增错误码时只需要在这里补一行,
 * 不会被散落在各处的 `if (code === ...)` 漏掉。
 */
export function describePiMarketError(info: PiMarketErrorInfo): PiMarketErrorAction {
  switch (info.code) {
    case "consent-required":
      return {
        title: "该扩展申请高风险能力",
        hint: "在安装对话框里勾选「同意高风险能力」后重试。",
        retryable: false,
      };
    case "incompatible":
      return {
        title: "宿主版本不兼容",
        hint: "该扩展要求的 OpenBuddy 版本区间与当前宿主不匹配,先升级宿主或换一个版本。",
        retryable: false,
      };
    case "corrupt-install":
      return {
        title: "已安装载荷被外部改写",
        hint: "勾选「强制重新物化」后重试,会用索引里的内容覆盖本地目录。",
        retryable: false,
      };
    case "version-not-found":
      return {
        title: "索引里没有这个版本",
        hint: "换成索引提供的版本,或先刷新索引。",
        retryable: true,
      };
    case "not-found":
      return {
        title: "索引里没有这个扩展",
        hint: "源可能已经更新,刷新索引后重试。",
        retryable: true,
      };
    case "payload-unavailable":
      return {
        title: "取不到安装载荷",
        hint: "该源没有提供可用的载荷(内联 files / 本地目录 / 远端下载),联系源维护者。",
        retryable: false,
      };
    case "payload-rejected":
      return {
        title: "写入失败",
        hint: "载荷写入或提交被拒绝,检查数据目录权限后重试。",
        retryable: true,
      };
    case "unsafe-target":
      return {
        title: "安装目录不安全",
        hint: "目标版本目录是一个符号链接,请先手动清理该目录。",
        retryable: false,
      };
    case "no-previous-version":
      return {
        title: "没有可回滚的版本",
        hint: "该扩展只有一个版本被安装过,回滚栈是空的。",
        retryable: false,
      };
    case "invalid-id":
      return { title: "扩展 id 不合法", hint: "刷新索引后重试。", retryable: true };
    case "invalid-registry":
      return {
        title: "索引不可用",
        hint: "没有配置任何索引源,或所有源都拉不到且没有缓存。检查 sources.json / 环境变量。",
        retryable: true,
      };
    case "invalid-descriptor":
      return {
        title: "扩展描述不合法",
        hint: "该条目的 manifest 没有通过校验,联系源维护者。",
        retryable: false,
      };
    default:
      return { title: "操作失败", hint: info.detail || "未知错误。", retryable: true };
  }
}

// ---------------------------------------------------------------------------
// R35 — 源管理(编辑态模型)
// ---------------------------------------------------------------------------

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * 一行源配置的**编辑态**。
 *
 * 为什么数字字段也存字符串:`weight` / `timeoutMs` 是输入框里的文本。存成
 * number 的话,用户敲到一半的 "1." 或手滑的 "abc" 会在 onChange 里被 `Number()`
 * 悄悄变成 0 —— 然后"我明明设了权重"变成一个查不出来的谜。留字符串,校验时
 * 才报错。
 */
export interface PiSourceDraft {
  id: string;
  url: string;
  label: string;
  weight: string;
  timeoutMs: string;
  trusted: boolean;
  /** 来自环境变量 / 宿主注入 —— 只读行,不参与保存,也不允许删除。 */
  readonly: boolean;
  /** 上一次刷新时这个源的结果。 */
  status?: PiMarketSourceState;
  entryCount?: number;
  error?: string;
  /** 上一次「测试可达」的结论文案(与 `status` 无关,是用户主动触发的)。 */
  probe?: string;
}

export interface PiSourceDraftErrors {
  /** 行号(0 基)→ 该行的错误文案。 */
  readonly rows: Readonly<Record<number, string>>;
  /** 整表级错误(不是某一行的错)。 */
  readonly form?: string;
}

export interface PiSourceDraftValidation {
  /** 校验通过时可直接交给 `setPiMarketSources()` 的载荷(不含只读行)。 */
  readonly sources: readonly PiMarketRegistrySource[];
  readonly errors: PiSourceDraftErrors;
  readonly ok: boolean;
}

/** 把线契约的源视图摊成编辑态行:只读源排在最前(和"生效顺序"一致)。 */
export function sourcesToDrafts(view: PiMarketSourcesView): PiSourceDraft[] {
  const statusById = new Map(view.statuses.map((status) => [status.id, status]));
  const readonlyIds = new Set(view.readonlySourceIds);
  const rows: PiSourceDraft[] = [];
  const push = (source: PiMarketRegistrySource, readonly: boolean): void => {
    const status = statusById.get(source.id);
    rows.push({
      id: source.id,
      url: source.url,
      label: source.label ?? "",
      weight: typeof source.weight === "number" ? String(source.weight) : "",
      timeoutMs: typeof source.timeoutMs === "number" ? String(source.timeoutMs) : "",
      trusted: source.trusted === true,
      readonly,
      ...(status ? { status: status.state, entryCount: status.entryCount } : {}),
      ...(status?.error ? { error: status.error } : {}),
    });
  };
  // 只读源排在前面:它们权重相同时也永远赢(部署优先),放最前才不会让用户
  // 以为"拖到上面就能改优先级"。
  for (const source of view.effective) {
    if (readonlyIds.has(source.id)) push(source, true);
  }
  for (const source of view.file) {
    if (readonlyIds.has(source.id)) continue; // 同 id:生效的是只读那份
    push(source, false);
  }
  return rows;
}

/** 空行(「添加源」按钮)。 */
export function blankSourceDraft(): PiSourceDraft {
  return {
    id: "",
    url: "",
    label: "",
    weight: "",
    timeoutMs: "",
    trusted: false,
    readonly: false,
  };
}

/**
 * 从本地索引文件路径造一行草稿(「导入 registry.json」)。
 *
 * 索引文件就是一种 `file` 源:main 侧的 `deriveSourceId()` 对绝对路径同样容忍,
 * 所以导入 = 把路径填进「地址」列。名称取文件名(去掉 .json),让列表里一眼看出
 * 这是"哪个索引";id 留空 —— 保存时按 url 生成稳定 id,重复导入同一文件不会
 * 悄悄变成两条。
 */
export function sourceDraftFromPath(path: string): PiSourceDraft {
  const trimmed = path.trim();
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const label = base.replace(/\.json$/i, "") || base;
  return { ...blankSourceDraft(), url: trimmed, label };
}

/**
 * 找到已经引用同一个地址的行(0 基);没有则返回 -1。
 *
 * 用途:导入前查重。比"先加进去再让校验报 id 重复"友好 —— 用户看到的是
 * "这个索引已经在第 3 行",而不是一条红色错误。
 */
export function findSourceDraftIndex(
  drafts: readonly PiSourceDraft[],
  url: string,
): number {
  const needle = url.trim();
  if (!needle) return -1;
  return drafts.findIndex((draft) => draft.url.trim() === needle);
}

function absolutePathLike(value: string): boolean {
  return value.startsWith("/") || /^[a-z]:[\\/]/i.test(value);
}

/**
 * 校验整张表。
 *
 * 规则刻意比 main 侧更**早**(在保存前就给出行号),但判定口径完全一致 ——
 * 否则会出现"UI 说没问题、保存却报错"的分裂体验。只读行不参与校验与提交:
 * 它们由部署决定,写进 `sources.json` 也不会生效。
 */
export function validateSourceDrafts(drafts: readonly PiSourceDraft[]): PiSourceDraftValidation {
  const rows: Record<number, string> = {};
  const sources: PiMarketRegistrySource[] = [];
  const seen = new Set<string>();
  drafts.forEach((draft, index) => {
    if (draft.readonly) return;
    const url = draft.url.trim();
    if (!url) {
      rows[index] = "源地址必填";
      return;
    }
    // 接受 URL(http/https/file…)或绝对路径 —— 与 main 侧 `deriveSourceId()`
    // 的容忍度一致:非 URL 的本地路径也是合法输入。
    if (!absolutePathLike(url)) {
      try {
        new URL(url);
      } catch {
        rows[index] = "不是合法的 URL 或绝对路径";
        return;
      }
    }
    const id = draft.id.trim();
    if (id && !SOURCE_ID_RE.test(id)) {
      rows[index] = "id 只能包含字母、数字、. _ -";
      return;
    }
    const resolvedId = id || deriveDraftId(url, index);
    if (seen.has(resolvedId)) {
      rows[index] = `id 重复:${resolvedId}`;
      return;
    }
    seen.add(resolvedId);
    const weight = draft.weight.trim();
    if (weight && !Number.isFinite(Number(weight))) {
      rows[index] = "权重必须是数字";
      return;
    }
    const timeoutMs = draft.timeoutMs.trim();
    if (timeoutMs && (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0)) {
      rows[index] = "超时必须是正数(毫秒)";
      return;
    }
    const label = draft.label.trim();
    sources.push({
      id: resolvedId,
      url,
      ...(label ? { label } : {}),
      ...(weight ? { weight: Number(weight) } : {}),
      ...(draft.trusted ? { trusted: true } : {}),
      ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
    });
  });
  return Object.keys(rows).length === 0
    ? { sources, errors: { rows: {} }, ok: true }
    : { sources, errors: { rows }, ok: false };
}

const SOURCE_URL_EXT_RE = /\.(json|json5|ya?ml|txt)$/i;

/** 与 main 侧 `slugifySourcePath()` 同一口径(否则 UI 会算出一个保存后被改掉的 id)。 */
function slugifySourcePath(pathname: string): string {
  return pathname
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .replace(SOURCE_URL_EXT_RE, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * 用户没写 id 时从 URL 里凑一个 —— 与 main 侧 `deriveSourceId()` **同一口径**。
 *
 * 必须带 path:同一个 host 上放多个索引是常态(stable / nightly),只按 host
 * 派生会让两个源撞成一个 id,用户就会看到"id 重复"却不知道自己哪里错了。
 */
function deriveDraftId(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/[^a-z0-9.-]/gi, "").toLowerCase();
    if (host) {
      const slug = slugifySourcePath(parsed.pathname);
      return slug ? `${host}-${slug}` : host;
    }
  } catch {
    const slug = slugifySourcePath(url);
    if (slug) return `local-${slug}`;
  }
  return `source-${index + 1}`;
}

/** 当前编辑态是否与已保存的配置不同(决定「保存」是否可点)。 */
export function sourceDraftsDirty(
  drafts: readonly PiSourceDraft[],
  saved: readonly PiMarketRegistrySource[],
): boolean {
  const current = validateSourceDrafts(drafts).sources;
  const normalize = (list: readonly PiMarketRegistrySource[]): string =>
    JSON.stringify(
      list.map((item) => [
        item.id,
        item.url,
        item.label ?? "",
        typeof item.weight === "number" ? item.weight : null,
        item.trusted === true,
        typeof item.timeoutMs === "number" ? item.timeoutMs : null,
      ]),
    );
  return normalize(current) !== normalize(saved);
}

/**
 * 上下移动一行(权重相同时**声明顺序**决定优先级,所以顺序是可编辑语义的一部分)。
 *
 * 只读行不参与移动:它们在保存时会被排除,允许拖动只会让用户以为改了优先级。
 */
export function moveSourceDraft(
  drafts: readonly PiSourceDraft[],
  index: number,
  delta: number,
): PiSourceDraft[] {
  const target = index + delta;
  if (index < 0 || index >= drafts.length) return [...drafts];
  if (target < 0 || target >= drafts.length) return [...drafts];
  if (drafts[index].readonly || drafts[target].readonly) return [...drafts];
  const next = [...drafts];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** 每源状态的短标签(与区块顶部 chips 用同一套文案)。 */
export function sourceStateLabel(state: PiMarketSourceState | undefined): string | undefined {
  switch (state) {
    case "fresh":
      return "已拉取";
    case "cached":
      return "用缓存";
    case "failed":
      return "不可达";
    case "skipped":
      return "已跳过";
    default:
      return undefined;
  }
}

/** 「测试可达」的结果文案。 */
export function describeProbeResult(result: {
  ok: boolean;
  entryCount: number;
  sampleId?: string;
  error?: string;
}): string {
  if (!result.ok) return `不可达:${result.error ?? "未知错误"}`;
  const sample = result.sampleId ? `,例如 ${result.sampleId}` : "";
  return `可达:${result.entryCount} 条${sample}`;
}
