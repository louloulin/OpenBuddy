import { CATEGORY_LABELS, type DocCategory, type DocMeta, getAllDocs, getDocsByCategory } from '@/lib/docs-meta';

interface DocsOverviewProps {
  locale: 'en' | 'zh-CN';
}

const CATEGORY_ORDER: DocCategory[] = ['core', 'plugin', 'operations', 'reference', 'meta', 'spec'];

/**
 * DocsOverview —— 文档总览页。
 * 按组列出所有文档,每组显示 1-2 篇精选(可选)+ 完整列表。
 */
export default function DocsOverview({ locale }: DocsOverviewProps) {
  const grouped = getDocsByCategory();
  const total = getAllDocs().length;

  const copy = locale === 'zh-CN'
    ? {
        eyebrow: '文档',
        title: 'OpenBuddy 文档',
        subtitle: `共 ${ total } 篇。仓库即文档 —— 读、批注、PR。`,
        browseOnGithub: '在 GitHub 浏览',
        editThisPage: '编辑此页'
      }
    : {
        eyebrow: 'Documentation',
        title: 'OpenBuddy Docs',
        subtitle: `${ total } guides. The repo is the docs — read, annotate, PR.`,
        browseOnGithub: 'Browse on GitHub',
        editThisPage: 'Edit this page'
      };

  return (
    <div className="grid gap-12 lg:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="hidden lg:block">
        {/* We import the client sidebar lazily via a server wrapper if needed; for now use this static fallback */}
        <SidebarList locale={ locale } activeSlug={ undefined } />
      </aside>

      {/* Main */}
      <div>
        <div className="mb-12">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
            { copy.eyebrow }
          </p>
          <h1 className="mt-3 font-display-serif text-[44px] leading-[1.05] tracking-[-0.02em] text-[var(--wb-fg)] md:text-[56px]">
            { copy.title }
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
            { copy.subtitle }
          </p>
        </div>

        <div className="space-y-12">
          { CATEGORY_ORDER.map((cat) => {
            const docs = grouped[cat];
            if (docs.length === 0) return null;
            return (
              <section key={ cat }>
                <h2 className="mb-4 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-muted)]">
                  { CATEGORY_LABELS[cat][locale === 'zh-CN' ? 'zh' : 'en'] }
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  { docs.map((doc) => (
                    <DocCard key={ doc.slug } doc={ doc } locale={ locale } />
                  )) }
                </ul>
              </section>
            );
          }) }
        </div>

        <div className="mt-16 flex items-center gap-4 text-[13px]">
          <a
            href="https://github.com/louloulin/OpenBuddy/tree/main/docs"
            target="_blank"
            rel="noreferrer"
            className="cta-link text-[var(--wb-fg)]"
          >
            <span>{ copy.browseOnGithub }</span>
            <span className="cta-link-arrow">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function SidebarList({ locale, activeSlug }: { locale: 'en' | 'zh-CN'; activeSlug?: string }) {
  const grouped = getDocsByCategory();
  return (
    <nav aria-label="Documentation" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-4">
      <ul className="space-y-7">
        { CATEGORY_ORDER.map((cat) => {
          const docs = grouped[cat];
          if (docs.length === 0) return null;
          return (
            <li key={ cat }>
              <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                { CATEGORY_LABELS[cat][locale === 'zh-CN' ? 'zh' : 'en'] }
              </h3>
              <ul className="space-y-0.5">
                { docs.map((doc) => (
                  <li key={ doc.slug }>
                    <a
                      href={ `/${ locale === 'zh-CN' ? 'zh-CN' : 'en' }/docs/${ doc.slug }` }
                      className={ `block rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors ${
                        activeSlug === doc.slug
                          ? 'bg-[var(--wb-bg-soft)] font-medium text-[var(--wb-fg)]'
                          : 'text-[var(--wb-fg-muted)] hover:bg-[var(--wb-bg-soft)]/60 hover:text-[var(--wb-fg)]'
                      }` }
                    >
                      { doc.title }
                    </a>
                  </li>
                )) }
              </ul>
            </li>
          );
        }) }
      </ul>
    </nav>
  );
}

function DocCard({ doc, locale }: { doc: DocMeta; locale: 'en' | 'zh-CN' }) {
  return (
    <li>
      <a
        href={ `/${ locale === 'zh-CN' ? 'zh-CN' : 'en' }/docs/${ doc.slug }` }
        className="wb-card group block"
      >
        <h3 className="font-display-serif text-[18px] leading-snug text-[var(--wb-fg)]">
          { doc.title }
        </h3>
        <p className="mt-2 text-[13px] leading-snug text-[var(--wb-fg-muted)]">
          { doc.description }
        </p>
      </a>
    </li>
  );
}