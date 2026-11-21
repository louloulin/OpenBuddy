import { useEffect, useState } from "react";
import { AppWindow, Monitor, Moon, Sun, Type, Rows3 } from "lucide-react";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { trayGet, traySet, quickShortcutGet, quickShortcutSet } from "@openbuddy/client/agent-client";
import { SectionShell } from "./shared";
import { loadDensity, loadFontSize, setDensity, setFontSize, type Density, type FontSize } from "../preferences";
import { getSendKey, setSendKey, type SendKey } from "../../composer/send-key";
import { useLocale } from "../../../shared/i18n";

/**
 * 通用 (20261116-pii W6.3 / W4.4)：主题、字号、信息密度、发送键、托盘常驻与语言。
 * 主题写 ThemeProvider（data-theme）；字号 / 密度写 `<html data-font-size / data-density>`，
 * 由 polish.css 生效；托盘开关走主进程（tray.json）。都即时生效、下次启动仍保留。
 */
const FONT_OPTIONS: Array<{ value: FontSize; labelKey: string }> = [
  { value: "small", labelKey: "general.font.small" },
  { value: "normal", labelKey: "general.font.normal" },
  { value: "large", labelKey: "general.font.large" },
];
const DENSITY_OPTIONS: Array<{ value: Density; labelKey: string; hintKey: string }> = [
  { value: "comfortable", labelKey: "general.density.comfortable", hintKey: "general.density.comfortableHint" },
  { value: "compact", labelKey: "general.density.compact", hintKey: "general.density.compactHint" },
];
const SEND_OPTIONS: Array<{ value: SendKey; label: string; hintKey: string }> = [
  { value: "enter", label: "Enter", hintKey: "general.sendKey.enter" },
  { value: "mod+enter", label: "Ctrl/Cmd+Enter", hintKey: "general.sendKey.modEnter" },
];

export function GeneralPreferencesPanel() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [font, setFont] = useState<FontSize>(() => loadFontSize());
  const [density, setDensityState] = useState<Density>(() => loadDensity());
  const [sendKey, setSendKeyState] = useState<SendKey>(() => getSendKey());
  // 托盘常驻 (W4.4): read from the main process; null = 本环境没有托盘（浏览器预览）。
  const [trayOn, setTrayOn] = useState<boolean | null>(null);
  // 全局快速输入 (W7.2): read the accelerator from the main process; null = 不支持（浏览器）。
  const [quickKey, setQuickKey] = useState<string | null>(null);
  const [quickDraft, setQuickDraft] = useState("");
  const [quickError, setQuickError] = useState("");
  useEffect(() => {
    let cancelled = false;
    quickShortcutGet()
      .then((key) => { if (!cancelled) { setQuickKey(key); setQuickDraft(key); } })
      .catch(() => { if (!cancelled) setQuickKey(null); });
    return () => { cancelled = true; };
  }, []);
  const saveQuick = async () => {
    setQuickError("");
    try {
      const key = await quickShortcutSet(quickDraft.trim());
      setQuickKey(key);
      setQuickDraft(key);
    } catch (error) {
      setQuickError(String(error).replace(/^Error:\s*/, ""));
    }
  };
  useEffect(() => {
    let cancelled = false;
    trayGet()
      .then((result) => { if (!cancelled) setTrayOn(result.enabled); })
      .catch(() => { if (!cancelled) setTrayOn(null); });
    return () => { cancelled = true; };
  }, []);
  const toggleTray = async (next: boolean) => {
    setTrayOn(next);
    try {
      const result = await traySet(next);
      setTrayOn(result.enabled);
    } catch {
      setTrayOn(!next);
    }
  };

  return (
    <SectionShell title={t("general.title")} desc={t("general.desc")}>
      <div className="pref-card">
        <div className="pref-row">
          <div className="pref-row__label">
            <Monitor size={16} />
            <div>
              <div className="pref-row__title">{t("general.theme.title")}</div>
              <div className="pref-row__hint">{t("general.theme.hint")}</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label={t("general.theme.title")}>
            <button
              type="button"
              className={`pref-seg__btn${theme === "light" ? " is-on" : ""}`}
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Sun size={13} /> {t("general.theme.light")}
            </button>
            <button
              type="button"
              className={`pref-seg__btn${theme === "dark" ? " is-on" : ""}`}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Moon size={13} /> {t("general.theme.dark")}
            </button>
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <Type size={16} />
            <div>
              <div className="pref-row__title">{t("general.font.title")}</div>
              <div className="pref-row__hint">{t("general.font.hint")}</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label={t("general.font.title")}>
            {FONT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`pref-seg__btn${font === option.value ? " is-on" : ""}`}
                aria-pressed={font === option.value}
                onClick={() => {
                  setFont(option.value);
                  setFontSize(option.value);
                }}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <Rows3 size={16} />
            <div>
              <div className="pref-row__title">{t("general.density.title")}</div>
              <div className="pref-row__hint">{t("general.density.hint")}</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label={t("general.density.title")}>
            {DENSITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`pref-seg__btn${density === option.value ? " is-on" : ""}`}
                aria-pressed={density === option.value}
                title={t(option.hintKey)}
                onClick={() => {
                  setDensityState(option.value);
                  setDensity(option.value);
                }}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <div>
              <div className="pref-row__title">{t("general.sendKey.title")}</div>
              <div className="pref-row__hint">{t("general.sendKey.hint")}</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label={t("general.sendKey.title")}>
            {SEND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`pref-seg__btn${sendKey === option.value ? " is-on" : ""}`}
                aria-pressed={sendKey === option.value}
                title={t(option.hintKey)}
                onClick={() => {
                  setSendKeyState(option.value);
                  setSendKey(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <div>
              <div className="pref-row__title">{t("general.language.title")}</div>
              <div className="pref-row__hint">{t("general.language.hint")}</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label={t("general.language.title")}>
            <button
              type="button"
              className={`pref-seg__btn${locale === "zh-CN" ? " is-on" : ""}`}
              aria-pressed={locale === "zh-CN"}
              onClick={() => setLocale("zh-CN")}
            >
              简体中文
            </button>
            <button
              type="button"
              className={`pref-seg__btn${locale === "en-US" ? " is-on" : ""}`}
              aria-pressed={locale === "en-US"}
              onClick={() => setLocale("en-US")}
            >
              English
            </button>
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <AppWindow size={16} />
            <div>
              <div className="pref-row__title">{t("general.tray.title")}</div>
              <div className="pref-row__hint">
                {trayOn === null && t("general.tray.none")}
                {trayOn === true && t("general.tray.on")}
                {trayOn === false && t("general.tray.off")}
              </div>
            </div>
          </div>
          {trayOn === null ? (
            <span className="pref-badge">{t("general.tray.unavailable")}</span>
          ) : (
            <div className="pref-seg" role="group" aria-label={t("general.tray.title")}>
              <button
                type="button"
                className={`pref-seg__btn${!trayOn ? " is-on" : ""}`}
                aria-pressed={!trayOn}
                onClick={() => void toggleTray(false)}
              >
                {t("general.tray.offButton")}
              </button>
              <button
                type="button"
                className={`pref-seg__btn${trayOn ? " is-on" : ""}`}
                aria-pressed={trayOn}
                onClick={() => void toggleTray(true)}
              >
                {t("general.tray.onButton")}
              </button>
            </div>
          )}
        </div>

        {/* 全局快速输入 (W7.2): a system-wide shortcut opens a small composer. */}
        <div className="pref-row">
          <div className="pref-row__label">
            <Type size={16} />
            <div>
              <div className="pref-row__title">{t("general.quick.title")}</div>
              <div className="pref-row__hint">
                {quickKey === null ? t("general.quick.unsupported") : t("general.quick.hint")}
              </div>
              {quickError && <div className="pref-row__hint" role="alert">{quickError}</div>}
            </div>
          </div>
          {quickKey === null ? (
            <span className="pref-badge">{t("general.tray.unavailable")}</span>
          ) : (
            <div className="pref-shortcut">
              <input
                className="pref-shortcut__input"
                aria-label={t("general.quick.inputLabel")}
                value={quickDraft}
                onChange={(event) => setQuickDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void saveQuick(); }}
                spellCheck={false}
              />
              <button type="button" className="pref-seg__btn" onClick={() => void saveQuick()} disabled={!quickDraft.trim() || quickDraft === quickKey}>{t("general.quick.save")}</button>
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
