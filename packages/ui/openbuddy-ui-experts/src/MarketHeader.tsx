import {
  ExpertTabIcon, SkillTabIcon, ConnectorTabIcon, RepoIcon,
} from "@openbuddy/ui-primitives/icons";

// "插件·市场" 现在挂在"专家·技能·连接器"视图下作为 MarketPills 的
// 一个 tab,所以 MarketTab 联合类型需要扩展。其它代码通过这个 union 显式
// switch 渲染,所以增加 key 时所有调用点会被 TypeScript 强制对齐。
export type MarketTab = "experts" | "skills" | "connectors" | "plugins";

const TABS: { key: MarketTab; label: string; Icon: typeof ExpertTabIcon }[] = [
  { key: "experts", label: "专家", Icon: ExpertTabIcon },
  { key: "skills", label: "技能", Icon: SkillTabIcon },
  { key: "connectors", label: "连接器", Icon: ConnectorTabIcon },
  { key: "plugins", label: "插件·市场", Icon: RepoIcon },
];

/** The dark pill tab group (专家 / 技能 / 连接器 / 插件·市场) shown at
 *  the top-left of every market tab's topbar. The "插件·市场" tab renders
 *  MarketplacePanel (Pi plugin marketplace with pi.dev as a built-in
 *  remote source). */
export function MarketPills({
  active, onChange,
}: {
  active: MarketTab;
  onChange: (t: MarketTab) => void;
}) {
  return (
    <div className="um-pills" role="tablist" aria-label="专家·技能·连接器·插件·市场">
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          className={`um-pill${active === key ? " um-pill--active" : ""}`}
          onClick={() => onChange(key)}
        >
          <Icon size="sm" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
