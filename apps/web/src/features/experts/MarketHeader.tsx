import {
  ExpertTabIcon, SkillTabIcon, ConnectorTabIcon, PuzzlePieceIcon,
} from "@openbuddy/ui/icon/icons/index";

export type MarketTab = "experts" | "skills" | "connectors" | "extensions";

const TABS: { key: MarketTab; label: string; Icon: typeof ExpertTabIcon }[] = [
  { key: "experts", label: "专家", Icon: ExpertTabIcon },
  { key: "skills", label: "技能", Icon: SkillTabIcon },
  { key: "connectors", label: "连接器", Icon: ConnectorTabIcon },
  { key: "extensions", label: "扩展", Icon: PuzzlePieceIcon },
];

/** The dark pill tab group (专家 / 技能 / 连接器 / 扩展) shown at the top-left of every
 *  market tab's topbar (截图 1–4). `tabs` limits it to the tabs the host can serve. */
export function MarketPills({
  active, onChange, tabs,
}: {
  active: MarketTab;
  onChange: (t: MarketTab) => void;
  tabs?: readonly MarketTab[];
}) {
  return (
    <div className="um-pills" role="tablist" aria-label="专家·技能·连接器">
      {TABS.filter(({ key }) => !tabs || tabs.includes(key)).map(({ key, label, Icon }) => (
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
