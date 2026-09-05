import { useMemo } from "react";
import { useRendererContributions } from "@/lib/runtime/renderer-plugin-runtime";
import { AssistantTopTabs, assistantPluginTabsFromContributions, ASSISTANT_TAB_SECTIONS } from "./AssistantTopTabs";

interface AssistantWorkbenchNavProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onGoHome?: () => void;
  badgeByRoute?: Record<string, string | number>;
}

export function AssistantWorkbenchNav({ activeRoute, onNavigate, onGoHome, badgeByRoute }: AssistantWorkbenchNavProps) {
  const contributions = useRendererContributions("assistant");
  const pluginTabs = useMemo(() => assistantPluginTabsFromContributions(contributions), [contributions]);

  return (
    <nav className="assistant-workbench-nav" aria-label="助理工作台导航">
      <AssistantTopTabs
        activeRoute={activeRoute}
        onNavigate={onNavigate}
        onGoHome={onGoHome}
        builtin={ASSISTANT_TAB_SECTIONS}
        pluginTabs={pluginTabs}
        badgeByRoute={badgeByRoute}
      />
    </nav>
  );
}
