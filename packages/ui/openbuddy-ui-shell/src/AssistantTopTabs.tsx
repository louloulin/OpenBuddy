import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileCheck, GitBranch, Home, Inbox, ListTodo, MessageCircle, MoreHorizontal, ShieldCheck, Users } from "lucide-react";
import {
  ASSISTANT_TAB_LABEL_BY_SECTION,
  ASSISTANT_TAB_ROUTE_BY_SECTION,
  assistantWorkspaceSectionFromRoute,
  type AssistantWorkspaceSection,
} from "@openbuddy/ui-shared";
import type { AssistantRendererContributionPayload, RendererContribution } from "@openbuddy/renderer-host";

export interface AssistantTopTabItem {
  id: string;
  label: string;
  route: string;
  icon?: typeof Inbox;
  badge?: string | number;
  hint?: string;
  plugin?: boolean;
  order?: number;
  modes?: Array<"personal" | "organization" | "network">;
  capabilityIds?: string[];
  requiredTrust?: "local" | "org" | "known_peer" | "public";
  group?: "overview" | "workspace" | "governance" | "plugin";
}

interface AssistantTopTabsProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onGoHome?: () => void;
  builtin: readonly AssistantWorkspaceSection[];
  pluginTabs: AssistantTopTabItem[];
  badgeByRoute?: Record<string, string | number>;
}

const PRIMARY_ROUTES = new Set(["助理", "助理·本地助理", "助理·收件箱", "助理·跨项目任务", "助理·工作流", "助理·开放网络"]);

const MENU_GROUPS = [
  { id: "collaboration", label: "协作", icon: Users, routes: ["助理·日程", "助理·Rooms", "助理·助理与 Buddy"] },
  { id: "governance", label: "治理", icon: ShieldCheck, routes: ["助理·能力与策略", "助理·证据与审计", "助理·副作用恢复"] },
] as const;

export function assistantPluginTabsFromContributions(contributions: readonly RendererContribution[]): AssistantTopTabItem[] {
  return contributions.flatMap((contribution) => {
    const payload = contribution.payload as AssistantRendererContributionPayload;
    if (typeof payload.route !== "string" || !/^助理·\S(?:.*\S)?$/u.test(payload.route)) return [];
    const modes = Array.isArray(payload.modes)
      ? payload.modes.filter((mode): mode is "personal" | "organization" | "network" => mode === "personal" || mode === "organization" || mode === "network")
      : undefined;
    const capabilityIds = Array.isArray(payload.capabilityIds)
      ? payload.capabilityIds.filter((capability): capability is string => typeof capability === "string")
      : undefined;
    const requiredTrust: AssistantTopTabItem["requiredTrust"] = payload.requiredTrust === "local" || payload.requiredTrust === "org" || payload.requiredTrust === "known_peer" || payload.requiredTrust === "public"
      ? payload.requiredTrust
      : undefined;
    return [{
      id: contribution.id,
      label: payload.label ?? payload.title ?? contribution.id,
      route: payload.route,
      hint: payload.description,
      plugin: true,
      order: typeof payload.order === "number" ? payload.order : 1000,
      ...(modes ? { modes } : {}),
      ...(capabilityIds ? { capabilityIds } : {}),
      ...(requiredTrust ? { requiredTrust } : {}),
    }];
  }).sort((left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.label.localeCompare(right.label));
}

const ICONS: Record<AssistantWorkspaceSection, typeof Inbox> = {
  inbox: Inbox,
  calendar: CalendarDays,
  tasks: ListTodo,
  workflows: GitBranch,
  rooms: Users,
  buddies: Users,
  network: Users,
  capabilities: ShieldCheck,
  evidence: FileCheck,
  recovery: ShieldCheck,
};

export function AssistantTopTabs({ activeRoute, onNavigate, onGoHome, builtin, pluginTabs, badgeByRoute }: AssistantTopTabsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const activeSection = assistantWorkspaceSectionFromRoute(activeRoute);
  const activeCanonicalRoute = activeSection ? ASSISTANT_TAB_ROUTE_BY_SECTION[activeSection] : activeRoute;

  const items = useMemo<AssistantTopTabItem[]>(() => {
    const overviewItem: AssistantTopTabItem = { id: "overview", label: "总览", route: "助理", icon: Home, group: "overview" };
    const localAssistantItem: AssistantTopTabItem = { id: "local-assistant", label: "本地助理", route: "助理·本地助理", icon: MessageCircle, group: "workspace" };
    const builtinItems: AssistantTopTabItem[] = builtin.map((section) => ({
      id: section,
      label: ASSISTANT_TAB_LABEL_BY_SECTION[section],
      route: ASSISTANT_TAB_ROUTE_BY_SECTION[section],
      icon: ICONS[section],
      group: "workspace",
    }));
    const seenRoutes = new Set<string>();
    return [overviewItem, localAssistantItem, ...builtinItems, ...pluginTabs.map((item) => ({ ...item, group: "plugin" as const }))]
      .filter((item) => {
        if (seenRoutes.has(item.route)) return false;
        seenRoutes.add(item.route);
        return true;
      });
  }, [builtin, pluginTabs]);

  const primaryItems = useMemo(() => items.filter((item) => PRIMARY_ROUTES.has(item.route)), [items]);
  const menuGroups = useMemo(() => MENU_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => (group.routes as readonly string[]).includes(item.route)),
  })).filter((group) => group.items.length > 0), [items]);
  const pluginMenuItems = useMemo(() => items.filter((item) => item.plugin), [items]);

  const isActiveRoute = (route: string) => {
    const section = assistantWorkspaceSectionFromRoute(route);
    return (section ? ASSISTANT_TAB_ROUTE_BY_SECTION[section] : route) === activeCanonicalRoute;
  };

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const active = [...node.querySelectorAll<HTMLElement>("[data-route]")].find((item) => item.dataset.route === activeCanonicalRoute);
    if (!active) return;
    const padding = 24;
    const target = active.offsetLeft - node.clientWidth / 2 + active.clientWidth / 2;
    if (typeof node.scrollTo === "function") node.scrollTo({ left: Math.max(0, target - padding), behavior: "smooth" });
  }, [activeCanonicalRoute]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = items.findIndex((item) => item.route === activeCanonicalRoute);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    onNavigate(items[nextIndex].route);
  };

  const scrollBy = (delta: number) => {
    const node = scrollerRef.current;
    if (node && typeof node.scrollBy === "function") node.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className={"assistant-top-tabs" + (!onGoHome ? " assistant-top-tabs--standalone" : "")} role="tablist" aria-label="助理工作台菜单" onKeyDown={onKeyDown}>
      {onGoHome && (
        <button
          type="button"
          className="assistant-top-tabs__home"
          onClick={onGoHome}
          aria-label="返回助理总览"
        >
          助理
        </button>
      )}
      <button
        type="button"
        className="assistant-top-tabs__nav"
        onClick={() => scrollBy(-160)}
        aria-label="向左滚动视图"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="assistant-top-tabs__scroller" ref={scrollerRef} aria-label="助理工作区主要标签">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isActiveRoute(item.route);
          const badge = badgeByRoute?.[item.route] ?? item.badge;
          return (
            <span key={item.id} data-group={item.group}>
              <button
                data-route={item.route}
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
                title={item.hint ?? item.label}
                className={"assistant-top-tabs__tab" + (active ? " assistant-top-tabs__tab--active" : "") + (item.plugin ? " assistant-top-tabs__tab--plugin" : "")}
                onClick={() => item.route === "助理" && onGoHome ? onGoHome() : onNavigate(item.route)}
              >
                {Icon && <Icon size={14} aria-hidden />}
                <span>{item.label}</span>
                {badge !== undefined && badge !== "" && <span className="assistant-top-tabs__badge">{badge}</span>}
              </button>
            </span>
          );
        })}
      </div>
      {menuGroups.map((group) => (
        <AssistantTabMenu
          key={group.id}
          label={group.label}
          icon={group.icon}
          items={group.items}
          active={group.items.some((item) => isActiveRoute(item.route))}
          activeRoute={activeCanonicalRoute}
          badgeByRoute={badgeByRoute}
          {...(group.id === "governance" && badgeByRoute ? {
            triggerBadge: Number(badgeByRoute["治理·审批"] ?? 0) + Number(badgeByRoute["治理·副作用"] ?? 0) + Number(badgeByRoute["治理·委托"] ?? 0) || undefined,
          } : group.id === "collaboration" && badgeByRoute ? {
            triggerBadge: Number(badgeByRoute["协作·未读"] ?? 0) + Number(badgeByRoute["协作·活跃"] ?? 0) || undefined,
          } : {})}
          onNavigate={onNavigate}
        />
      ))}
      {pluginMenuItems.length > 0 && (
        <AssistantTabMenu
          label="更多"
          icon={MoreHorizontal}
          items={pluginMenuItems}
          active={pluginMenuItems.some((item) => isActiveRoute(item.route))}
          activeRoute={activeCanonicalRoute}
          badgeByRoute={badgeByRoute}
          onNavigate={onNavigate}
        />
      )}
      <button
        type="button"
        className="assistant-top-tabs__nav"
        onClick={() => scrollBy(160)}
        aria-label="向右滚动视图"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function AssistantTabMenu({
  label,
  icon: Icon,
  items,
  active,
  activeRoute,
  badgeByRoute,
  triggerBadge,
  onNavigate,
}: {
  label: string;
  icon: typeof Users;
  items: readonly AssistantTopTabItem[];
  active: boolean;
  activeRoute: string;
  badgeByRoute?: Record<string, string | number>;
  /** 触发器上显示的合并 badge（用于「治理⌄」未处理审批等）。 */
  triggerBadge?: string | number;
  onNavigate: (route: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="assistant-top-tabs__menu" ref={menuRef}>
      <button
        type="button"
        className={"assistant-top-tabs__menu-trigger" + (active ? " assistant-top-tabs__menu-trigger--active" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={14} aria-hidden />
        <span>{label}</span>
        {triggerBadge !== undefined && triggerBadge !== "" && triggerBadge !== 0 && <span className="assistant-top-tabs__badge" aria-label={`${label}待处理 ${triggerBadge}`}>{triggerBadge}</span>}
        {active && <span className="assistant-top-tabs__menu-dot" aria-label="当前分组有已打开页面" />}
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div className="assistant-top-tabs__menu-popover" role="menu" aria-label={`${label}菜单`}>
          {items.map((item) => {
            const itemActive = activeRoute === item.route;
            const badge = badgeByRoute?.[item.route] ?? item.badge;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-route={item.route}
                className={"assistant-top-tabs__menu-item" + (itemActive ? " assistant-top-tabs__menu-item--active" : "")}
                title={item.hint ?? item.label}
                onClick={() => {
                  setOpen(false);
                  onNavigate(item.route);
                }}
              >
                {item.icon && <item.icon size={14} aria-hidden />}
                <span>{item.label}</span>
                {badge !== undefined && badge !== "" && <span className="assistant-top-tabs__badge">{badge}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { ASSISTANT_TAB_SECTIONS, ASSISTANT_TAB_ROUTE_BY_SECTION } from "@openbuddy/ui-shared";
