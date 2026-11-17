import { useState } from "react";
import { Monitor, Moon, Sun, Type, Rows3 } from "lucide-react";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { SectionShell } from "./shared";
import { loadDensity, loadFontSize, setDensity, setFontSize, type Density, type FontSize } from "../preferences";
import { getSendKey, setSendKey, type SendKey } from "../../composer/send-key";

/**
 * 通用 (20261116-pii W6.3)：主题、字号、信息密度、发送键与语言。
 * 主题写 ThemeProvider（data-theme）；字号 / 密度写 `<html data-font-size / data-density>`，
 * 由 polish.css 生效；都即时预览、下次启动仍保留。
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

        <div className="pref-row pref-row--muted">
          <div className="pref-row__label">
            <div>
              <div className="pref-row__title">托盘常驻</div>
              <div className="pref-row__hint">关闭窗口后驻留托盘、后台继续跑自动化（W4.4，接入后开放）。</div>
            </div>
          </div>
          <span className="pref-badge">即将上线</span>
        </div>
      </div>
    </SectionShell>
  );
}
