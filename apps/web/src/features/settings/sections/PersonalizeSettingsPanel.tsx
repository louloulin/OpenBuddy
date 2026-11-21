import { useEffect, useState } from "react";
import { Sun, Moon, Type, Rows3 } from "lucide-react";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { useUiPrefs } from "@/app/state/ui-prefs-store";
import { useLocale } from "@/shared/i18n";
import { SectionShell } from "./shared";

const FONT_KEY = "openbuddy.fontSize";

// ---------- 个性化 ----------

export function PersonalizeSettingsPanel() {
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const conciseMode = useUiPrefs((s) => s.conciseMode);
  const setPrefs = useUiPrefs((s) => s.setPrefs);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(FONT_KEY);
    return saved ? Number(saved) : 13;
  });

  useEffect(() => {
    localStorage.setItem(FONT_KEY, String(fontSize));
    document.documentElement.style.setProperty("--openbuddy-font-size", `${fontSize}px`);
    document.body.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  return (
    <SectionShell
      title={t("personalize.title")}
      desc={t("personalize.desc")}
    >
      <div className="settings-row">
        <div className="settings-row__label">
          {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
          <span>{t("personalize.theme")}</span>
        </div>
        <div className="settings-row__control theme-toggle">
          <button
            className={`theme-toggle__btn ${theme === "light" ? "theme-toggle__btn--active" : ""}`}
            onClick={() => setTheme("light")}
          >
            <Sun size={14} /> {t("personalize.light")}
          </button>
          <button
            className={`theme-toggle__btn ${theme === "dark" ? "theme-toggle__btn--active" : ""}`}
            onClick={() => setTheme("dark")}
          >
            <Moon size={14} /> {t("personalize.dark")}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Type size={16} />
          <span>{t("personalize.fontSize")}</span>
          <span className="settings-row__hint">{t("personalize.fontSizeValue", { n: fontSize })}</span>
        </div>
        <div className="settings-row__control">
          <input
            type="range"
            min={11}
            max={18}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <button className="settings-reset" onClick={() => setFontSize(13)}>
            {t("personalize.reset")}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Rows3 size={16} />
          <span>{t("personalize.concise")}</span>
          <span className="settings-row__hint">{t("personalize.conciseHint")}</span>
        </div>
        <div className="settings-row__control">
          <label className="ob-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={t("personalize.concise")}
              checked={conciseMode}
              onChange={(e) => setPrefs({ conciseMode: e.target.checked })}
            />
            <span className="ob-switch__track" aria-hidden="true"><span className="ob-switch__thumb" /></span>
          </label>
        </div>
      </div>
    </SectionShell>
  );
}
