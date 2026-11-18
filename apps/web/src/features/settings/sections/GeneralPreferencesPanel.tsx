import { useEffect, useState } from "react";
import { AppWindow, Monitor, Moon, Sun, Type, Rows3 } from "lucide-react";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { trayGet, traySet, quickShortcutGet, quickShortcutSet } from "@openbuddy/client/agent-client";
import { SectionShell } from "./shared";
import { loadDensity, loadFontSize, setDensity, setFontSize, type Density, type FontSize } from "../preferences";
import { getSendKey, setSendKey, type SendKey } from "../../composer/send-key";

/**
 * 通用 (20261116-pii W6.3 / W4.4)：主题、字号、信息密度、发送键、托盘常驻与语言。
 * 主题写 ThemeProvider（data-theme）；字号 / 密度写 `<html data-font-size / data-density>`，
 * 由 polish.css 生效；托盘开关走主进程（tray.json）。都即时生效、下次启动仍保留。
 */
const FONT_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "small", label: "小" },
  { value: "normal", label: "标准" },
  { value: "large", label: "大" },
];
const DENSITY_OPTIONS: Array<{ value: Density; label: string; hint: string }> = [
  { value: "comfortable", label: "宽松", hint: "行高更舒展" },
  { value: "compact", label: "紧凑", hint: "一屏看到更多" },
];
const SEND_OPTIONS: Array<{ value: SendKey; label: string; hint: string }> = [
  { value: "enter", label: "Enter", hint: "Shift+Enter 换行" },
  { value: "mod+enter", label: "Ctrl/Cmd+Enter", hint: "Enter 换行" },
];

export function GeneralPreferencesPanel() {
  const { theme, setTheme } = useTheme();
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
    <SectionShell title="通用" desc="外观与输入习惯。改动即时生效，并保存在这台设备上。">
      <div className="pref-card">
        <div className="pref-row">
          <div className="pref-row__label">
            <Monitor size={16} />
            <div>
              <div className="pref-row__title">主题</div>
              <div className="pref-row__hint">暖中性浅色，或低眩光深色。</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label="主题">
            <button
              type="button"
              className={`pref-seg__btn${theme === "light" ? " is-on" : ""}`}
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Sun size={13} /> 浅色
            </button>
            <button
              type="button"
              className={`pref-seg__btn${theme === "dark" ? " is-on" : ""}`}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Moon size={13} /> 深色
            </button>
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <Type size={16} />
            <div>
              <div className="pref-row__title">字号</div>
              <div className="pref-row__hint">影响对话正文、侧栏与设置文字。</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label="字号">
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
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <Rows3 size={16} />
            <div>
              <div className="pref-row__title">信息密度</div>
              <div className="pref-row__hint">列表与设置行的间距。</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label="信息密度">
            {DENSITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`pref-seg__btn${density === option.value ? " is-on" : ""}`}
                aria-pressed={density === option.value}
                title={option.hint}
                onClick={() => {
                  setDensityState(option.value);
                  setDensity(option.value);
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
              <div className="pref-row__title">发送键</div>
              <div className="pref-row__hint">发送消息的快捷键；换行始终可用。</div>
            </div>
          </div>
          <div className="pref-seg" role="group" aria-label="发送键">
            {SEND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`pref-seg__btn${sendKey === option.value ? " is-on" : ""}`}
                aria-pressed={sendKey === option.value}
                title={option.hint}
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

        <div className="pref-row pref-row--muted">
          <div className="pref-row__label">
            <div>
              <div className="pref-row__title">语言</div>
              <div className="pref-row__hint">当前版本只提供简体中文。</div>
            </div>
          </div>
          <span className="pref-value">简体中文</span>
        </div>

        <div className="pref-row">
          <div className="pref-row__label">
            <AppWindow size={16} />
            <div>
              <div className="pref-row__title">托盘常驻</div>
              <div className="pref-row__hint">
                {trayOn === null && "当前环境没有系统托盘。"}
                {trayOn === true && "关闭窗口后驻留托盘，自动化继续在后台运行；从托盘菜单退出。"}
                {trayOn === false && "关闭窗口即退出。开启后可在后台继续跑自动化。"}
              </div>
            </div>
          </div>
          {trayOn === null ? (
            <span className="pref-badge">不可用</span>
          ) : (
            <div className="pref-seg" role="group" aria-label="托盘常驻">
              <button
                type="button"
                className={`pref-seg__btn${!trayOn ? " is-on" : ""}`}
                aria-pressed={!trayOn}
                onClick={() => void toggleTray(false)}
              >
                关闭
              </button>
              <button
                type="button"
                className={`pref-seg__btn${trayOn ? " is-on" : ""}`}
                aria-pressed={trayOn}
                onClick={() => void toggleTray(true)}
              >
                开启
              </button>
            </div>
          )}
        </div>

        {/* 全局快速输入 (W7.2): a system-wide shortcut opens a small composer. */}
        <div className="pref-row">
          <div className="pref-row__label">
            <Type size={16} />
            <div>
              <div className="pref-row__title">快速输入</div>
              <div className="pref-row__hint">
                {quickKey === null ? "当前环境不支持全局快捷键。" : "在任意应用里按下这个组合键，弹出小输入框并新建任务。"}
              </div>
              {quickError && <div className="pref-row__hint" role="alert">{quickError}</div>}
            </div>
          </div>
          {quickKey === null ? (
            <span className="pref-badge">不可用</span>
          ) : (
            <div className="pref-shortcut">
              <input
                className="pref-shortcut__input"
                aria-label="快速输入快捷键"
                value={quickDraft}
                onChange={(event) => setQuickDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void saveQuick(); }}
                spellCheck={false}
              />
              <button type="button" className="pref-seg__btn" onClick={() => void saveQuick()} disabled={!quickDraft.trim() || quickDraft === quickKey}>保存</button>
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
