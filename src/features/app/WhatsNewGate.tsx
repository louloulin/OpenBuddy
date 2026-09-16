/**
 * src/features/app/WhatsNewGate.tsx
 *
 * R23 — 「本次更新」摘要卡的宿主接线。
 *
 * 三层职责分得很干净:
 *   - 数据: `src/lib/changelog/app-changelog.ts`(构建期内联的 CHANGELOG + 纯解析);
 *   - UI:   `@openbuddy/ui-onboarding` 的 `WhatsNewCard`,以内核槽位
 *           `onboarding.whats-new` 注册(插件可以用更高优先级换掉这张卡);
 *   - 策略: 本文件 —— 什么时候弹、看过之后记什么,这两件事是产品的、不是 UI 包的。
 *
 * 触发时机:只在"从旧版本升上来"时弹。首次安装不弹(首启已经有一层引导向导,
 * 再叠一层浮层会挡住用户真正要看的首页);开发版(版本号领先 CHANGELOG)取最新
 * 已知条目,免得开发期永远看不到这张卡。
 */
import { lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";

import { APP_RELEASES, WHATS_NEW_STORAGE_KEY, decideWhatsNew } from "@/lib/changelog/app-changelog";
import type { ChangelogRelease } from "@/lib/changelog/parse-changelog";
import { invoke } from "@/lib/platform/electron-api";
import { APP_VERSION } from "@/lib/platform/app-version";

import { useSlotComponent } from "./slot-bridge";

const WhatsNewCard = lazy(() =>
  import("@openbuddy/ui-onboarding").then((m) => ({ default: m.WhatsNewCard })),
);

/** 完整更新日志的对外地址(卡片上的「查看完整更新日志」)。 */
const CHANGELOG_URL = "https://github.com/openbuddy/openbuddy/blob/main/CHANGELOG.md";

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, version);
  } catch {
    /* 隐私模式 / quota:静默降级 —— 下次启动会再弹一次,不是致命问题 */
  }
}

export function WhatsNewGate() {
  const [release, setRelease] = useState<ChangelogRelease | null>(null);

  useEffect(() => {
    const lastSeen = readLastSeen();
    const decision = decideWhatsNew(APP_VERSION, lastSeen);
    if (!lastSeen) {
      // 首次安装:静默记下当前版本,这样"下一次升级"才弹摘要。
      const first = APP_RELEASES[0];
      if (first) writeLastSeen(first.version);
      return;
    }
    if (decision.show && decision.release) setRelease(decision.release);
  }, []);

  // 无论用户是否勾「不再显示」,都记下已看过这一版 —— 勾选框只影响"这次立刻关掉"
  // 还是"以后都别弹",而"记下版本"是避免同一版本反复弹的必要条件。
  const dismiss = useCallback(() => {
    setRelease((current) => {
      if (current) writeLastSeen(current.version);
      return null;
    });
  }, []);

  const openChangelog = useCallback(() => {
    void invoke("shell:open-external", CHANGELOG_URL).catch(() => {
      /* 打不开浏览器不应打断用户 —— 摘要卡里的内容已经够看 */
    });
  }, []);

  // hook 必须在早退之前调用:槽位可能被插件接管,注册/卸载都要跟着重渲染。
  const Fallback = useMemo(
    () => WhatsNewCard as unknown as ComponentType<Record<string, unknown>>,
    [],
  );
  const Card = useSlotComponent<ComponentType<Record<string, unknown>>>(
    "onboarding.whats-new",
    Fallback,
  );

  if (!release) return null;

  return (
    <div className="whats-new-gate" data-testid="whats-new-gate">
      <Card
        version={release.version}
        releasedAt={release.date}
        items={release.items}
        onDismiss={dismiss}
        onOpenChangelog={openChangelog}
      />
    </div>
  );
}
