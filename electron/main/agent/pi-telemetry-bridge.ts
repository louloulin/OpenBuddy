/**
 * pi SDK telemetry → OpenBuddy telemetry bridge.
 *
 * pi's agent runtime exposes typed span helpers (`startAiSpan`,
 * `startHarnessSpan`) from `@earendil-works/pi-agent-core`. Both expect a
 * `TelemetryContext` argument and only DO something if one is passed — the
 * SDK does not provide a global setter, so each extension (or caller) must
 * own its own.
 *
 * This module:
 *   1. Adapts OpenBuddy's provider funnel (`reportEvent` / `reportMetric`)
 *      to the pi SDK `TelemetryContext` / `TelemetrySpan` shape, so any span
 *      opened with `startAiSpan` / `startHarnessSpan` against this context
 *      shows up in OpenBuddy's existing console + OTLP providers under a
 *      stable `pi.telemetry.*` event namespace.
 *   2. Provides `createTelemetryBridgeExtension()` — a pi extension factory
 *      that opens a `HarnessSpan` per `turn_start` and closes it on
 *      `turn_end` (or `session_complete`), giving OpenBuddy a full
 *      per-turn span tree even though pi's TUI never renders one.
 */
import {
  NOOP_TELEMETRY_CONTEXT,
  type TelemetryContext,
  type TelemetrySpan,
  type TelemetrySpanDefinition,
  type TelemetrySchemaDefinition,
  type SpanOptions,
} from "@earendil-works/pi-agent-core";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** Sink that forwards an OpenBuddy-style event to its existing funnel. */
export interface OpenBuddyTelemetrySinkEvent {
  name: string;
  level: "debug" | "info" | "warn" | "error";
  props?: Record<string, unknown>;
  ts?: number;
}

/** Sink that forwards an OpenBuddy-style event to its existing funnel. */
export interface OpenBuddyTelemetrySink {
  (event: OpenBuddyTelemetrySinkEvent): void;
}

const SPAN_NAMESPACE = "pi.telemetry";

function levelForStatus(status: "ok" | "error" | "unset"): "debug" | "info" | "warn" | "error" {
  if (status === "error") return "error";
  if (status === "unset") return "debug";
  return "info";
}

/** Mutable per-span state, captured by closure so callers can probe it. */
interface MutableSpanState {
  status: "ok" | "error" | "unset";
  statusError: { name: string; message: string } | undefined;
  collectedAttrs: Record<string, unknown>;
}

function buildSpan(name: string, attrs: Record<string, unknown> | undefined, sink: OpenBuddyTelemetrySink, state?: MutableSpanState): TelemetrySpan {
  // Nested spans share the parent span's state object so the outer close
  // sees the merged status + attributes from every descendant.
  const local: MutableSpanState = state ?? {
    status: "unset",
    statusError: undefined,
    collectedAttrs: { ...(attrs ?? {}) },
  };

  sink({
    name: `${SPAN_NAMESPACE}.span.start`,
    level: "debug",
    props: { span: name, ...(attrs ?? {}) },
    ts: Date.now(),
  });

  return {
    async startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
      // Recursive nesting: every nested span shares `local` so the outer
      // close emits a single end event with the merged state from all
      // descendants. Inner callbacks never emit end events on their own.
      const inner = buildSpan(options.name ?? "child", options.attributes as Record<string, unknown> | undefined, sink, local);
      return callback(inner);
    },
    addEvent(eventName: string, eventAttrs?: Record<string, unknown>) {
      sink({
        name: `${SPAN_NAMESPACE}.event`,
        level: "debug",
        props: { span: name, event: eventName, ...(eventAttrs ?? {}) },
      });
    },
    setAttributes(next: Record<string, unknown>) {
      Object.assign(local.collectedAttrs, next);
    },
    setStatus(next) {
      local.status = next.status;
      if (next.status === "error") local.statusError = next.error;
    },
  };
}

/** Build a `TelemetryContext` whose spans/events flow into `sink`. */
export function createOpenBuddyTelemetryContext(sink: OpenBuddyTelemetrySink): TelemetryContext {
  return {
    async startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
      const state: MutableSpanState = {
        status: "unset",
        statusError: undefined,
        collectedAttrs: { ...(options.attributes as Record<string, unknown> | undefined) },
      };
      const span = buildSpan(options.name, state.collectedAttrs, sink, state);
      try {
        const result = await callback(span);
        if (state.status === "unset") state.status = "ok";
        sink({
          name: `${SPAN_NAMESPACE}.span.end`,
          level: levelForStatus(state.status),
          props: state.statusError
            ? { span: options.name, status: state.status, error: state.statusError, ...state.collectedAttrs }
            : { span: options.name, status: state.status, ...state.collectedAttrs },
          ts: Date.now(),
        });
        return result;
      } catch (err) {
        const error = err instanceof Error
          ? { name: err.name, message: err.message }
          : { name: "Error", message: String(err) };
        sink({
          name: `${SPAN_NAMESPACE}.span.end`,
          level: "error",
          props: { span: options.name, status: "error" as const, error, ...state.collectedAttrs },
          ts: Date.now(),
        });
        throw err;
      }
    },
  };
}

/**
 * Factory for `openbuddy-pi-telemetry-bridge` — a hidden pi extension that
 * opens a `HarnessSpan` per session turn so OpenBuddy gets the full AI
 * span tree without depending on a specific telemetry backend (works with
 * console, OTLP, and any future Braintrust adapter alike).
 *
 * Wire it in `agent-host.ts` alongside the other built-in extensions.
 */
export function createTelemetryBridgeExtension(sink: OpenBuddyTelemetrySink): ExtensionFactory {
  const context = createOpenBuddyTelemetryContext(sink);
  let startHarnessSpan:
    | (<Result>(
        ctx: TelemetryContext,
        name: string,
        attrs: Record<string, unknown>,
        cb: (span: TelemetrySpan) => Result | Promise<Result>,
      ) => Promise<Result>)
    | undefined;
  return (pi) => {
    const api = pi as unknown as Record<string, unknown> & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
    if (typeof api.on !== "function") return;
    api.on("turn_start", (event: unknown) => {
      const payload = (event ?? {}) as { sessionId?: string };
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "unknown";
      const start = () => {
        if (!startHarnessSpan) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          startHarnessSpan = require("@earendil-works/pi-agent-core").startHarnessSpan as typeof startHarnessSpan;
        }
        return startHarnessSpan?.(
          context,
          "turn",
          { sessionId, kind: "openbuddy-bridge" },
          async (span) => {
            void span;
            return undefined;
          },
        );
      };
      void start();
    });
    api.on("turn_end", (event: unknown) => {
      const payload = (event ?? {}) as { sessionId?: string; messageCount?: number };
      sink({
        name: `${SPAN_NAMESPACE}.turn.end`,
        level: "info",
        props: { sessionId: payload.sessionId, messageCount: payload.messageCount },
      });
    });
    api.on("session_shutdown", (event: unknown) => {
      const payload = (event ?? {}) as { sessionId?: string };
      sink({
        name: `${SPAN_NAMESPACE}.session.shutdown`,
        level: "info",
        props: { sessionId: payload.sessionId },
      });
    });
  };
}

/** Re-export the SDK's noop so callers can use it as a safe default. */
export const PI_TELEMETRY_NOOP: TelemetryContext = NOOP_TELEMETRY_CONTEXT;

/** Stable schema names so consumers can audit what's being recorded. */
export const PI_TELEMETRY_BRIDGE_KIND = "openbuddy.pi-telemetry-bridge";

/** IPC channel the main sink writes to; preload mirrors this on the allowlist. */
export const PI_TELEMETRY_IPC_CHANNEL = "pi://telemetry";

/**
 * When WorkBuddy Aegis mode is enabled, the bridge rewrites the
 * `pi.telemetry.*` namespace to `wb.telemetry.*` so external Aegis
 * collectors (WorkBuddy's schema) receive the same span tree without any
 * additional wiring. The default OpenBuddy funnel still receives every
 * event through the regular sink path.
 */
export interface CreateMainTelemetrySinkOptions {
  /** When true, prefix events with `wb.telemetry` instead of `pi.telemetry`. */
  aegisMode?: boolean;
}

/** Shape the preload forwards into the renderer for `reportEvent(...)`. */
export interface PiTelemetryIpcEvent {
  name: string;
  level: "debug" | "info" | "warn" | "error";
  props?: Record<string, unknown>;
  ts?: number;
}

/**
 * Wire the sink to the renderer through an injected emitter (typically
 * `emitRendererEvent("pi://telemetry", payload)` in agent-host). The
 * emitter should be best-effort — telemetry failures must never break
 * agent startup or per-turn processing.
 */
export function createMainTelemetrySink(
  emit: (channel: string, payload: PiTelemetryIpcEvent) => void,
  options: CreateMainTelemetrySinkOptions = {},
): OpenBuddyTelemetrySink {
  const namespacePrefix = options.aegisMode ? "wb.telemetry" : SPAN_NAMESPACE;
  return (event) => {
    try {
      emit(PI_TELEMETRY_IPC_CHANNEL, {
        ...event,
        name: event.name.startsWith("pi.telemetry.") ? `${namespacePrefix}.${event.name.slice("pi.telemetry.".length)}` : event.name,
      });
    } catch {
      /* telemetry is observability, not correctness — swallow errors */
    }
  };
}
export type _PiTelemetrySchemaHook = TelemetrySchemaDefinition;
export type _PiTelemetrySpanHook = TelemetrySpanDefinition;