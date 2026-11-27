import { useEffect, useState } from "react";
import { appsIcon, appsList, type AppEntry } from "@openbuddy/client/api/files";
import { useAppsStore } from "./state/apps-store";

export interface CurrentApp {
  app: AppEntry;
  /** 应用图标的 data URI（缺失为 undefined）。 */
  icon?: string;
  /** 第一个场景 prompt：点输入卡的快捷图标时填入。 */
  prompt?: string;
}

/**
 * 当前应用 + 图标 + 首个场景 prompt（WorkBuddy 输入卡 `+` 旁的应用快捷图标，gap E）。
 *
 * 只在输入卡里用，数据来自真实 `apps_list`；没有已安装应用时返回 null（不渲染入口）。
 */
export function useCurrentApp(cwd?: string): CurrentApp | null {
  const currentAppId = useAppsStore((s) => s.currentAppId);
  const [value, setValue] = useState<CurrentApp | null>(null);

  useEffect(() => {
    let alive = true;
    // Promise.resolve().then 包一层：没有宿主桥（单测/浏览器预览）时 appsList 会同步抛错，
    // 直接 .catch 接不住同步异常，会污染调用方组件（如 Composer）。
    void Promise.resolve()
      .then(() => appsList(cwd))
      .then(async (list) => {
        if (!alive) return;
        const real = list.filter((app) => app.kind !== "extension");
        const app = real.find((item) => item.id === currentAppId) ?? real[0];
        if (!app) {
          setValue(null);
          return;
        }
        let icon: string | undefined;
        if (app.icon && app.packageSource) {
          icon = (await appsIcon(app.packageSource, app.icon).catch(() => ({ dataUri: null }))).dataUri ?? undefined;
        }
        if (!alive) return;
        setValue({ app, icon, prompt: app.sceneList?.[0]?.prompt });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cwd, currentAppId]);

  return value;
}
