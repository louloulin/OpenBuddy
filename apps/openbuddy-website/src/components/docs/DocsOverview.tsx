import Reveal from '@/components/motion/Reveal';
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
    <div>
      <div className="mb-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
          { copy.eyebrow }
        </p>
        <h1 className="mt-3 font-display-serif text-[clamp(32px,4.5vw,52px)] font-normal leading-[1.05] tracking-[-0.025em] text-[var(--wb-fg)]">
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
                  { docs.map((doc, docIndex) => (
                    <DocCard key={ doc.slug } doc={ doc } locale={ locale } index={ docIndex } />
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
  );
}

function DocCard({ doc, locale, index }: { doc: DocMeta; locale: 'en' | 'zh-CN'; index: number }) {
  return (
    <Reveal as="li" delay={ Math.min(index, 5) * 60 }>
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
    </Reveal>
  );
}