/**
 * 对话流设置 —— 对齐 WorkBuddy `settings.conversation.toolDisplay`。
 *
 * 只影响渲染层：简洁模式把已完成回合的步骤折到「已完成 · 用时」后面，
 * 详细模式默认展开工具与思考过程。偏好保存在 `ui-prefs-store`（本机）。
 */
import { SectionShell } from "./shared";
import { useUiPrefs } from "@/app/state/ui-prefs-store";
import { useLocale } from "@/shared/i18n";

export function ConversationFlowPanel() {
  const { t } = useLocale();
  const concise = useUiPrefs((s) => s.conciseMode);
  const setPrefs = useUiPrefs((s) => s.setPrefs);

  return (
    <SectionShell title={t("settings.conversation.title")} desc={t("settings.conversation.desc")}>
      <div className="pref-card">
        <div className="pref-row">
          <div className="pref-row__label">
            <div>
              <div className="pref-row__title">{t("settings.conversation.display.title")}</div>
              <div className="pref-row__hint">{t("settings.conversation.display.hint")}</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label={t("settings.conversation.display.title")}>
            <button
              type="button"
              className={"pref-seg__btn" + (concise ? " is-on" : "")}
              aria-pressed={concise}
              onClick={() => setPrefs({ conciseMode: true })}
            >
              {t("settings.conversation.display.compact")}
            </button>
            <button
              type="button"
              className={"pref-seg__btn" + (!concise ? " is-on" : "")}
              aria-pressed={!concise}
              onClick={() => setPrefs({ conciseMode: false })}
            >
              {t("settings.conversation.display.detailed")}
            </button>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
