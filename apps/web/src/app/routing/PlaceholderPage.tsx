import { AgentToolIcon } from "@openbuddy/ui/icon/icons/index";
import { useCapabilitySnapshot } from "../state/capabilities-store";
import { FEATURES, type FeatureRouteProps } from "./features";
import { isAvailable, routeEntry } from "./registry";

interface PlaceholderPageProps extends FeatureRouteProps {
  /** The view to show: a FeatureRegistry route label (or a legacy alias such as 技能与 MCP). */
  label: string;
}

/**
 * Feature pages (助理 / 专家·技能·连接器 / 项目 / 自动化 / 资料库 / 更多 …), generated from the
 * FeatureRegistry (pii W0.2): the label picks a route, the route renders its panel. The former
 * per-label branches live on as the routes in features.tsx. A view the host cannot serve is
 * not navigable (App refuses it); landing here anyway shows a plain "unavailable" notice.
 */
export function PlaceholderPage({ label, ...props }: PlaceholderPageProps) {
  const caps = useCapabilitySnapshot();
  const entry = routeEntry(FEATURES, label);
  if (entry?.route && isAvailable(entry, caps)) return <>{entry.route.render(props)}</>;
  return (
    <div className="placeholder-page">
      <AgentToolIcon size="xl" color="var(--wb-text-tertiary)" />
      <h2 className="placeholder-page__title">{label}</h2>
      <p className="placeholder-page__desc">{entry && caps.status === "loading" ? "正在读取宿主能力…" : "当前版本不提供这个功能"}</p>
    </div>
  );
}
