import * as React from "react";
import type { RendererContribution } from "@openbuddy/renderer-host";
import type { RendererSlotEntry } from "@/lib/runtime/renderer-plugin-runtime";

type RendererContributionViewProps = {
  contribution: RendererContribution;
  className?: string;
  onPlaceholder?: (label: string) => void;
  context?: Record<string, unknown>;
};

function activate(contribution: RendererContribution, onPlaceholder?: (label: string) => void): void {
  const payload = contribution.payload;
  if (typeof payload.onActivate === "function") payload.onActivate();
  else if (payload.placeholder && onPlaceholder) onPlaceholder(payload.placeholder);
}

/** Renders a client contribution without allowing arbitrary DOM strings through. */
export function RendererContributionView({ contribution, className, onPlaceholder, context }: RendererContributionViewProps) {
  const payload = contribution.payload;
  const label = payload.label ?? payload.title ?? contribution.id;
  const component = payload.component;

  if (React.isValidElement(component)) return component;
  if (typeof component === "function") {
    return React.createElement(component as React.ComponentType<Record<string, unknown>>, {
      ...payload.options,
      contribution,
      ...(context ? { context } : {}),
    });
  }

  return (
    <button
      type="button"
      className={className ?? "renderer-contribution"}
      title={payload.description ?? label}
      onClick={() => activate(contribution, onPlaceholder)}
    >
      {label}
    </button>
  );
}

export function RendererContributionCard({ contribution, onPlaceholder }: Omit<RendererContributionViewProps, "className">) {
  const payload = contribution.payload;
  const label = payload.label ?? payload.title ?? contribution.id;
  const component = payload.component;
  if (React.isValidElement(component) || typeof component === "function") {
    return <RendererContributionView contribution={contribution} onPlaceholder={onPlaceholder} />;
  }
  return (
    <div className="renderer-contribution-card">
      <div className="renderer-contribution-card__title">{label}</div>
      {payload.description && <div className="renderer-contribution-card__description">{payload.description}</div>}
      <RendererContributionView contribution={contribution} className="renderer-contribution-card__action" onPlaceholder={onPlaceholder} />
    </div>
  );
}

export function RendererSlotView({ entry, className }: { entry: RendererSlotEntry; className?: string }) {
  const component = entry.component;
  if (React.isValidElement(component)) return component;
  if (typeof component === "function") {
    return React.createElement(component as React.ComponentType<Record<string, unknown>>, {
      ...(entry.options.options as Record<string, unknown> | undefined),
      slot: entry.options.name,
    });
  }
  if (entry.options.renderFallback !== true) return null;
  const label = typeof entry.options.label === "string" ? entry.options.label : "插件";
  return <span className={className ?? "renderer-slot"}>{label}</span>;
}
