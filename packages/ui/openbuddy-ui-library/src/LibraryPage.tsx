/**
 * LibraryPage —— 「资料库」页。
 *
 * 结构:左分区导航(来自 `library.section` 槽)+ 右内容(当前分区)。
 * 分区**全部**通过槽位注册 —— 包括内置的我的文件 / 知识库 / 云存储 / 灵感 ——
 * 所以第三方插件追加一个分区只需要一次 `ctx.slots.register`,不需要改本页。
 *
 * 为什么要这一页:
 *   之前「资料库」只是一个占位路由(`PlaceholderPage` 里的空壳),而三个真实面板
 *   (我的文件 / 知识库 / 云存储)只能各自从「更多」下拉里单独进。资料库把
 *   "用户的资料"收成一个入口,并且是 WorkBuddy 没有的那部分:分区是插件可扩展的。
 */
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import {
  CloudToolIcon,
  InspirationIcon,
  LibraryIcon,
  MoreMenuImaKnowledgeIcon,
  MyFilesIconV2,
} from "@openbuddy/ui-primitives/icons";
import type { IconComponentProps } from "@openbuddy/ui-primitives/icons";
import styles from "./LibraryPage.module.css";
import {
  readLibrarySectionMeta,
  type LibraryPageProps,
  type LibrarySectionComponent,
  type LibrarySectionIconId,
} from "./section-contract";

/** 图标组件的 props 去掉 `ref` —— createIcon 产物是 ForwardRef,直接写
 *  `ComponentType<IconComponentProps>` 会因为 ref 的 legacy 类型不兼容而报错。 */
type SectionIconComponent = ComponentType<Omit<IconComponentProps, "ref">>;

const SECTION_ICONS: Record<LibrarySectionIconId, SectionIconComponent> = {
  files: MyFilesIconV2,
  artifacts: MyFilesIconV2,
  knowledge: MoreMenuImaKnowledgeIcon,
  cloud: CloudToolIcon,
  inspiration: InspirationIcon,
  generic: LibraryIcon,
};

function SectionIcon({ id }: { id?: LibrarySectionIconId }) {
  const Icon = (id && SECTION_ICONS[id]) || SECTION_ICONS.generic;
  return <Icon size="sm" />;
}

export function LibraryPage({
  initialSection,
  cwd,
  sessionId,
  onToast,
  onLaunch,
  onOpenKnowledge,
}: LibraryPageProps) {
  const entries = useSlotComponents("library.section");

  // 只认「带元数据的分区组件」,并按 order 排序 —— 插件乱序注册也不影响导航列。
  const sections = useMemo(() => {
    const out: LibrarySectionComponent[] = [];
    for (const entry of entries) {
      if (typeof entry !== "function") continue;
      if (!readLibrarySectionMeta(entry)) continue;
      out.push(entry as unknown as LibrarySectionComponent);
    }
    return out.sort(
      (a, b) => (a.librarySection.order ?? 0) - (b.librarySection.order ?? 0),
    );
  }, [entries]);

  const [activeId, setActiveId] = useState<string | undefined>(initialSection);

  // 入口带的分区(例如「灵感」菜单项)→ 直接落到那个分区。
  useEffect(() => {
    if (initialSection) setActiveId(initialSection);
  }, [initialSection]);

  // 槽位是异步装配的:首次渲染可能还没有任何分区,装配完成后补上第一个。
  const ActiveSection =
    sections.find((s) => s.librarySection.id === activeId) ?? sections[0];

  return (
    <div className={styles.root} data-testid="library-page">
      <nav className={styles.rail} role="tablist" aria-label="资料库分区">
        <span className={styles.railTitle}>资料库</span>
        {sections.map((Section) => {
          const meta = Section.librarySection;
          const isActive = meta.id === ActiveSection?.librarySection.id;
          return (
            <button
              key={meta.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={styles.railItem + (isActive ? " " + styles.railItemActive : "")}
              data-testid={`library-rail-${meta.id}`}
              data-active={isActive ? "true" : "false"}
              title={meta.hint ?? meta.label}
              onClick={() => setActiveId(meta.id)}
            >
              <span className={styles.railIcon} aria-hidden="true">
                <SectionIcon id={meta.icon} />
              </span>
              <span className={styles.railLabel}>{meta.label}</span>
            </button>
          );
        })}
      </nav>
      <div
        className={styles.content}
        role="tabpanel"
        data-testid="library-content"
        data-section={ActiveSection?.librarySection.id ?? ""}
      >
        {ActiveSection ? (
          <div className="placeholder-page placeholder-page--panel">
            <ActiveSection
              active
              cwd={cwd}
              sessionId={sessionId}
              onToast={onToast}
              onLaunch={onLaunch}
              onOpenKnowledge={onOpenKnowledge}
            />
          </div>
        ) : (
          <p className={styles.empty}>资料库还没有可用分区。</p>
        )}
      </div>
    </div>
  );
}
