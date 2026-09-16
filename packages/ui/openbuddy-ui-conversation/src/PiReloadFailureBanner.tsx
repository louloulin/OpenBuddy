import { useEffect, useState } from "react";
import { reloadPiExtensions } from "@/lib/agent/pi-client";
import { getRendererPluginRuntime } from "@/lib/runtime/renderer-plugin-runtime";

export interface PiReloadFailureState {
  reason: string;
  error: string;
  generation?: number;
}

export function PiReloadFailureBanner() {
  const [failure, setFailure] = useState<PiReloadFailureState | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    const events = getRendererPluginRuntime()?.events;
    if (!events || typeof events.on !== "function") {
      // 测试环境(jsdom 没有真实 renderer plugin runtime)或 main 阶段
      // events 还没注入 —— 退化为不挂监听,行为等价于组件未挂载。
      return undefined;
    }
    const offFailure = events.on("renderer/pi-reload-failed", (payload) => {
      const next = payload as PiReloadFailureState;
      setFailure({ reason: next.reason, error: next.error, generation: next.generation });
      setRetryError(null);
      setRetrying(false);
    });
    const clear = () => {
      setFailure(null);
      setRetryError(null);
      setRetrying(false);
    };
    const offReloaded = events.on("profile/reloaded", clear);
    const offExtensions = events.on("pi/extensions-reloaded", clear);
    return () => { offFailure(); offReloaded(); offExtensions(); };
  }, []);

  if (!failure) return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await reloadPiExtensions();
      setFailure(null);
    } catch (error) {
      setRetryError(String(error));
      setRetrying(false);
    }
  };

  return (
    <div
      className="pi-reload-failure"
      role="alert"
      aria-live="assertive"
      data-testid="pi-reload-failure"
    >
      <div className="pi-reload-failure__body">
        <strong>Pi runtime reload failed</strong>
        <span id="pi-reload-failure-message">{retryError ?? failure.error}</span>
      </div>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        aria-busy={retrying}
        aria-describedby="pi-reload-failure-message"
        data-testid="pi-reload-retry"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
