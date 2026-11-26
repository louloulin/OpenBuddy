import { useCallback, useEffect, useState } from "react";
import { upupPluginsGet, upupPluginsSet, type UpupPluginsState } from "@openbuddy/client/api/files";

/**
 * UpUp 子包开关 (20261126-upup UP-1.3)。
 *
 * 写的是 `<agentDir>/settings.json#upupPlugins`——UpUp 的 dispatcher 挂在整仓时，
 * 就按这里关掉不需要的子包（组合/通知/手机宿主/技能桥）。单独装子包时这一页只影响
 * 整仓安装的那份，提示里写清楚。
 */
export function UpupPluginsCard({ hasUpup }: { hasUpup: boolean }) {
  const [state, setState] = useState<UpupPluginsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState("");

  const load = useCallback(async () => {
    try {
      setState(await upupPluginsGet());
      setError("");
    } catch {
      /* 非桌面宿主：不显示这一块 */
      setState(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return null;
  if (!hasUpup && !state.settingsExists && state.disabled.length === 0) return null;

  const commit = async (disabled: string[]) => {
    setBusy(true);
    setError("");
    try {
      setState(await upupPluginsSet({ disabled }));
    } catch (failure) {
      setError(String(failure).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const isOff = (dir: string) => state.disabled.includes(`@upup/${dir}`);
  const custom = state.disabled.filter((key) => !state.defaults.some((dir) => key === `@upup/${dir}`));

  const toggle = (dir: string, off: boolean) => {
    const key = `@upup/${dir}`;
    const next = off ? [...state.disabled, key] : state.disabled.filter((item) => item !== key);
    void commit([...new Set(next)]);
  };

  const addCustom = () => {
    const name = extra.trim().replace(/^@upup\//i, "");
    if (!name) return;
    void commit([...new Set([...state.disabled, `@upup/${name}`])]);
    setExtra("");
  };

  return (
    <div className="res-panel__card" aria-label="UpUp 子包">
      <h3 className="res-panel__card-title">UpUp 子包开关</h3>
      <p className="res-panel__muted">
        安装整仓 UpUp 时，这里关掉的子包不会挂载（写入 <code>settings.json#upupPlugins</code>）。单独装子包时不受这里影响。
      </p>
      {error && <p className="res-panel__error" role="alert">{error}</p>}
      <ul className="upup-plugins" role="group" aria-label="UpUp 子包禁用列表">
        {state.defaults.map((dir) => (
          <li key={dir} className="upup-plugins__row">
            <label className="res-panel__switch">
              <input
                type="checkbox"
                checked={isOff(dir)}
                disabled={busy}
                aria-label={`禁用 ${dir}`}
                onChange={(event) => toggle(dir, event.target.checked)}
              />
              <code>{dir}</code>
            </label>
            <span className="upup-plugins__hint">
              {dir === "pi-portfolio" ? "组合/持仓" : dir === "pi-notify" ? "通知" : dir === "pi-mobile-host-extension" ? "手机宿主" : "技能桥"}
            </span>
          </li>
        ))}
        {custom.map((key) => (
          <li key={key} className="upup-plugins__row">
            <label className="res-panel__switch">
              <input
                type="checkbox"
                checked
                disabled={busy}
                aria-label={`启用 ${key}`}
                onChange={() => toggle(key.replace(/^@upup\//, ""), false)}
              />
              <code>{key.replace(/^@upup\//, "")}</code>
            </label>
            <span className="upup-plugins__hint">自定义</span>
          </li>
        ))}
      </ul>
      <div className="ext-install">
        <input
          className="ext-install__input"
          aria-label="额外禁用的子包目录名"
          placeholder="再禁用一个子包，例如 pi-quant"
          value={extra}
          spellCheck={false}
          onChange={(event) => setExtra(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") addCustom(); }}
        />
        <button type="button" className="res-panel__btn" disabled={busy || !extra.trim()} onClick={addCustom}>禁用</button>
        <button
          type="button"
          className="res-panel__btn"
          disabled={busy}
          onClick={() => void commit([...state.defaults.map((dir) => `@upup/${dir}`)])}
        >
          恢复默认
        </button>
      </div>
      <p className="res-panel__muted">开关文件：<code>{state.settingsPath}</code></p>
    </div>
  );
}
