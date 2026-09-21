/**
 * PrivacySettingsPanel — 邮件 AI 隐私 / 埋点 / 错误上报 设置面板。
 *
 * 三块内容:
 *   1. 埋点开关 — 控制 recordTelemetry 是否写入本地缓冲。
 *   2. 错误上报开关 — 控制 errorReporter 是否记录(默认 console.error)。
 *   3. 最近 20 条事件 + 最近 20 条错误 — 只读列表,带"清空"按钮。
 *
 * 不变量:
 *   - 默认 telemetry 关闭(显式 opt-in)— 符合"不主动收集"原则。
 *   - 默认 error reporter 开启(开发者定位 bug 需要)。
 *   - 持久化用 localStorage,key 前缀 `openbuddy.privacy.`。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  errorReporter,
  resetErrorReporter,
  setErrorReportingEnabled,
  useErrorRecent,
  type ReportedError,
} from "../error-reporter";
import {
  telemetryStore,
  useTelemetryAggregate,
  useTelemetryEnabled,
  useTelemetryEvents,
  type TelemetryEvent,
} from "../telemetry-store";

const STORAGE_KEY = "openbuddy.privacy";
interface PrivacyPrefs {
  telemetryEnabled: boolean;
  errorReportingEnabled: boolean;
}

const DEFAULT_PREFS: PrivacyPrefs = {
  telemetryEnabled: false,
  errorReportingEnabled: true,
};

function loadPrefs(): PrivacyPrefs {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PREFS;
    const parsed = JSON.parse(saved) as Partial<PrivacyPrefs>;
    return {
      telemetryEnabled: Boolean(parsed.telemetryEnabled),
      errorReportingEnabled: parsed.errorReportingEnabled !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: PrivacyPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* 隐私模式 / 配额满 — 静默 */
  }
}

export interface PrivacySettingsPanelProps {
  /** 测试 / host 注入:替换 section shell。默认用与 SettingsPanel 兼容的 div 结构。 */
  SectionShell?: React.ComponentType<{ title: string; desc?: string; children: React.ReactNode }>;
}

export function PrivacySettingsPanel({ SectionShell }: PrivacySettingsPanelProps = {}): JSX.Element {
  const [prefs, setPrefs] = useState<PrivacyPrefs>(() => loadPrefs());
  const [eventsTick, setEventsTick] = useState(0);
  const [errorsTick, setErrorsTick] = useState(0);

  // 初始化 stores
  useEffect(() => {
    telemetryStore.setEnabled(prefs.telemetryEnabled);
  }, [prefs.telemetryEnabled]);

  useEffect(() => {
    setErrorReportingEnabled(prefs.errorReportingEnabled);
  }, [prefs.errorReportingEnabled]);

  // 持久化
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const handleToggleTelemetry = useCallback(() => {
    setPrefs((p) => ({ ...p, telemetryEnabled: !p.telemetryEnabled }));
  }, []);

  const handleToggleErrorReporting = useCallback(() => {
    setPrefs((p) => ({ ...p, errorReportingEnabled: !p.errorReportingEnabled }));
  }, []);

  const handleClearEvents = useCallback(() => {
    telemetryStore.reset();
    setEventsTick((n) => n + 1);
  }, []);

  const handleClearErrors = useCallback(() => {
    errorReporter.clear();
    setErrorsTick((n) => n + 1);
  }, []);

  // 订阅 stores 的最新值
  useTelemetryEnabled();
  useTelemetryAggregate();
  useTelemetryEvents();

  // 订阅 stores — 任何 capture / record 都会触发 re-render
  const eventsRaw = useTelemetryEvents();
  const events: ReadonlyArray<TelemetryEvent> = useMemo(
    () => eventsRaw.slice(-20).reverse(),
    [eventsRaw],
  );
  const errorsRaw = useErrorRecent(20);
  const errors: ReadonlyArray<ReportedError> = useMemo(
    () => errorsRaw.slice().reverse(),
    [errorsRaw],
  );

  const Shell: React.ComponentType<{ title: string; desc?: string; children: React.ReactNode }> =
    SectionShell ?? DefaultSectionShell;

  return (
    <Shell title="隐私 · 埋点 · 错误上报" desc="控制邮件 AI 闭环的本地数据收集与错误上报行为。">
      <div className="settings-row">
        <div className="settings-row__label">
          <span>本地埋点(telemetry)</span>
        </div>
        <div className="settings-row__control">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={prefs.telemetryEnabled}
              onChange={handleToggleTelemetry}
              data-testid="privacy-toggle-telemetry"
            />
            <span>{prefs.telemetryEnabled ? "已开启" : "默认关闭(opt-in)"}</span>
          </label>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span>错误上报(error reporter)</span>
        </div>
        <div className="settings-row__control">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={prefs.errorReportingEnabled}
              onChange={handleToggleErrorReporting}
              data-testid="privacy-toggle-error-reporter"
            />
            <span>{prefs.errorReportingEnabled ? "本地缓冲 + 控制台" : "已暂停"}</span>
          </label>
        </div>
      </div>

      <div className="settings-row settings-row--vertical">
        <div className="settings-row__label">
          <span>最近埋点事件(最多 20 条)</span>
        </div>
        <div className="settings-row__control">
          <ol className="privacy-event-list" data-testid="privacy-event-list">
            {events.length === 0 ? (
              <li className="privacy-event-list__empty">暂无事件。开启埋点开关后才会记录。</li>
            ) : (
              events.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="privacy-event-list__item">
                  <code>{new Date(e.ts).toLocaleString()}</code>
                  <span className="privacy-event-list__name">{e.name}</span>
                  {e.props && (
                    <span className="privacy-event-list__props">{JSON.stringify(e.props)}</span>
                  )}
                </li>
              ))
            )}
          </ol>
          <button
            type="button"
            className="settings-btn"
            onClick={handleClearEvents}
            data-testid="privacy-clear-events"
          >
            清空埋点缓冲
          </button>
        </div>
      </div>

      <div className="settings-row settings-row--vertical">
        <div className="settings-row__label">
          <span>最近错误(最多 20 条)</span>
        </div>
        <div className="settings-row__control">
          <ol className="privacy-event-list" data-testid="privacy-error-list">
            {errors.length === 0 ? (
              <li className="privacy-event-list__empty">暂无错误。</li>
            ) : (
              errors.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="privacy-event-list__item">
                  <code>{new Date(e.ts).toLocaleString()}</code>
                  <span className="privacy-event-list__name">{e.name}</span>
                  <span className="privacy-event-list__props">{e.message}</span>
                </li>
              ))
            )}
          </ol>
          <button
            type="button"
            className="settings-btn"
            onClick={handleClearErrors}
            data-testid="privacy-clear-errors"
          >
            清空错误缓冲
          </button>
        </div>
      </div>
    </Shell>
  );
}

function DefaultSectionShell({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="settings-section" data-section="privacy">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

/** 测试用:重置 localStorage 持久化的 prefs。 */
export function resetPrivacyPrefsForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  telemetryStore.reset();
  resetErrorReporter();
}
