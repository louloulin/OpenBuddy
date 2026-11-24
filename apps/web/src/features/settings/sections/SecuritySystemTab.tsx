import { useEffect, useState } from "react";
import { MonitorCog } from "lucide-react";
import { useLocale } from "@/shared/i18n";

/**
 * 系统授权 (G2-6)：把浏览器的真实授权状态汇总到安全中心。
 *
 * 这里只读 `navigator.permissions` 的真实结果（麦克风 / 摄像头 / 通知），不做任何申请；
 * 需要授权时由用户在触发具体功能时决定。桌面端的 macOS 授权（TCC）由系统管理，
 * 这里说明清楚，不假装能读到。
 */
type PermissionName = "microphone" | "camera" | "notifications";

const ROWS: Array<{ name: PermissionName; labelKey: string; hintKey: string }> = [
  { name: "microphone", labelKey: "security.system.microphone", hintKey: "security.system.microphone.hint" },
  { name: "camera", labelKey: "security.system.camera", hintKey: "security.system.camera.hint" },
  { name: "notifications", labelKey: "security.system.notifications", hintKey: "security.system.notifications.hint" },
];

type State = "granted" | "denied" | "prompt" | "unsupported";

export function SecuritySystemTab() {
  const { t } = useLocale();
  const [states, setStates] = useState<Record<string, State>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, State> = {};
      for (const row of ROWS) {
        try {
          const status = await navigator.permissions?.query({ name: row.name } as PermissionDescriptor);
          next[row.name] = (status?.state ?? "prompt") as State;
        } catch {
          next[row.name] = "unsupported";
        }
      }
      if (!cancelled) setStates(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sec-card">
      <div className="sec-card__head">
        <div className="sec-card__title">
          <MonitorCog size={15} />
          <span>{t("security.system.title")}</span>
        </div>
        <div className="sec-card__hint">{t("security.system.hint")}</div>
      </div>
      <div className="sec-list">
        {ROWS.map((row) => {
          const state = states[row.name] ?? "prompt";
          return (
            <div className="sec-list__row" key={row.name}>
              <span className="sec-list__name">{t(row.labelKey)}</span>
              <span className="sec-list__meta">{t(row.hintKey)}</span>
              <span
                className={
                  "sec-badge sec-badge--" +
                  (state === "granted" ? "low" : state === "denied" ? "high" : "medium")
                }
              >
                {t(`security.system.state.${state}`)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="sec-footnote">{t("security.system.note")}</p>
    </div>
  );
}
