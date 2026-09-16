import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@openbuddy/ui-sidebar";

const base = {
  onNewSession: () => undefined,
  onSelect: () => undefined,
  onNavigate: () => undefined,
  onOpenSettings: () => undefined,
  onToggleCollapse: () => undefined,
  onToggleWorkspace: () => undefined,
  onOpenSearch: () => undefined,
  onPlaceholder: () => undefined,
  onToast: () => undefined,
};

const { container } = render(<Sidebar {...base} />);
const all = container.querySelectorAll("*");
const matches = [];
for (const el of all) {
  const text = el.textContent;
  if (text === "灵感") {
    matches.push({
      tag: el.tagName,
      cls: (el.className?.toString() || "").slice(0, 60),
      aria: el.getAttribute("aria-hidden"),
      parent: el.parentElement?.tagName,
    });
  }
}
console.log("Elements with exact text '灵感':", JSON.stringify(matches, null, 2));
