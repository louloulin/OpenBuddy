/**
 * docs-meta.ts —— 文档元数据 + 分类(纯数据,可在客户端组件 import)
 *
 * 不依赖 node:fs,所以可以安全被 client component 引用。
 * 真正的 .md 读取在 docs-server.ts(仅服务端)。
 */

export type DocCategory = 'core' | 'plugin' | 'operations' | 'reference' | 'spec' | 'meta';

export interface DocMeta {
  /** URL slug (e.g. 'getting-started') */
  slug: string;
  /** Title shown in sidebar and <h1>; pulled from first H1 of the markdown */
  title: string;
  /** One-line summary; can be overridden by DOC_INDEX entry */
  description: string;
  category: DocCategory;
  /** Filenames relative to docs/ for each locale */
  files: { en: string; zh: string | null };
}

/**
 * Curated index. Order = sidebar order. Category = grouping in sidebar.
 * Slug → filename mapping. zh-CN variants auto-resolved at lookup time.
 */
export const DOC_INDEX: DocMeta[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description: '30-minute developer setup — Node 22, pnpm 10, clone, first run.',
    category: 'core',
    files: { en: 'GETTING_STARTED.md', zh: 'GETTING_STARTED.zh-CN.md' }
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    description: 'Three-layer Electron host — React Renderer, Pi Agent, IPC bridge.',
    category: 'core',
    files: { en: 'ARCHITECTURE.md', zh: 'ARCHITECTURE.zh-CN.md' }
  },
  {
    slug: 'plugin-development',
    title: 'Plugin Development',
    description: 'Build your first Cordis capability — scaffold → provider → registry.',
    category: 'plugin',
    files: { en: 'PLUGIN_DEVELOPMENT.md', zh: null }
  },
  {
    slug: 'plugin-system',
    title: 'Plugin System',
    description: 'Six-surface architecture — bundle / pi / renderer / cordis.',
    category: 'plugin',
    files: { en: 'PLUGIN_SYSTEM.md', zh: 'PLUGIN_SYSTEM.md' }
  },
  {
    slug: 'operations',
    title: 'Operations & Deployment',
    description: 'Casdoor OIDC, NewAPI gateway, payment adapters, SCIM, SAML.',
    category: 'operations',
    files: { en: 'OPERATIONS.md', zh: null }
  },
  {
    slug: 'environment',
    title: 'Environment Variables',
    description: 'Every env var OpenBuddy reads — auth, providers, telemetry.',
    category: 'reference',
    files: { en: 'ENVIRONMENT.md', zh: null }
  },
  {
    slug: 'glossary',
    title: 'Glossary',
    description: 'Cordis, Pi, capability mesh, IPC bridge — the vocabulary.',
    category: 'reference',
    files: { en: 'GLOSSARY.md', zh: null }
  },
  {
    slug: 'i18n',
    title: 'Internationalization',
    description: 'How OpenBuddy localizes — single-file dict, locale switcher, SSR.',
    category: 'reference',
    files: { en: 'I18N.md', zh: null }
  },
  {
    slug: 'accessibility',
    title: 'Accessibility',
    description: 'Keyboard, focus, screen reader — what we ship and what is open.',
    category: 'reference',
    files: { en: 'ACCESSIBILITY.md', zh: null }
  },
  {
    slug: 'performance',
    title: 'Performance',
    description: 'Bundle size, cold start, render budget — measurements and targets.',
    category: 'reference',
    files: { en: 'PERFORMANCE.md', zh: 'PERFORMANCE.zh-CN.md' }
  },
  {
    slug: 'testing',
    title: 'Testing',
    description: 'Unit, integration, closed-loop, real-model Playwright — what runs when.',
    category: 'reference',
    files: { en: 'TESTING.md', zh: null }
  },
  {
    slug: 'security-pgp',
    title: 'Security & PGP',
    description: 'Threat model, signed releases, vulnerability reporting.',
    category: 'reference',
    files: { en: 'SECURITY-PGP.md', zh: null }
  },
  {
    slug: 'releasing',
    title: 'Releasing',
    description: 'Cut a release — version bump, changelog, signed tag, GitHub.',
    category: 'reference',
    files: { en: 'RELEASING.md', zh: null }
  },
  {
    slug: 'roadmap',
    title: 'Roadmap',
    description: 'Current quarter focus, public milestones, completed work.',
    category: 'meta',
    files: { en: 'ROADMAP.md', zh: null }
  },
  {
    slug: 'community',
    title: 'Community',
    description: 'How to get help — GitHub Discussions, Discord, Office Hours.',
    category: 'meta',
    files: { en: 'COMMUNITY.md', zh: null }
  },
  {
    slug: 'comparison',
    title: 'Comparison with WorkBuddy',
    description: 'Where OpenBuddy diverges from WorkBuddy, and why.',
    category: 'meta',
    files: { en: 'COMPARISON.md', zh: null }
  },
  {
    slug: 'workbuddy-migration',
    title: 'WorkBuddy Migration',
    description: 'Move from WorkBuddy to OpenBuddy — package mapping, breaking changes.',
    category: 'meta',
    files: { en: 'WORKBUDDY_MIGRATION.md', zh: null }
  },
  {
    slug: 'examples',
    title: 'Examples',
    description: 'End-to-end examples — first capability, first skill, first MCP.',
    category: 'meta',
    files: { en: 'EXAMPLES.md', zh: null }
  },
  {
    slug: 'faq',
    title: 'FAQ',
    description: 'Common questions — installation, providers, plans, enterprise.',
    category: 'meta',
    files: { en: 'FAQ.md', zh: 'FAQ.zh-CN.md' }
  },
  {
    slug: 'codebase-analysis',
    title: 'Codebase Analysis',
    description: 'Full audit of the monorepo — packages, dependencies, ownership.',
    category: 'spec',
    files: { en: 'CODEBASE_ANALYSIS.md', zh: 'CODEBASE_ANALYSIS.zh-CN.md' }
  },
  {
    slug: 'agent-host-microkernel',
    title: 'Agent Host Microkernel',
    description: 'Pi ecosystem → microkernel → host-modules layering.',
    category: 'spec',
    files: { en: 'AGENT_HOST_MICROKERNEL.md', zh: 'AGENT_HOST_MICROKERNEL.md' }
  },
  {
    slug: 'openbuddy-pi-vision',
    title: 'OpenBuddy × Pi Vision',
    description: 'Why we built on Pi — agent loop, tools, extensions.',
    category: 'spec',
    files: { en: 'OPENBUDDY-PI-VISION.md', zh: null }
  }
];

/**
 * One searchable document. Built server-side by docs-search.ts and handed to
 * the client Cmd-K dialog. Titles/descriptions come from DOC_INDEX; headings
 * and excerpt are extracted from every available locale file, so a query in
 * either language matches.
 */
export interface SearchEntry {
  slug: string;
  title: string;
  description: string;
  category: DocCategory;
  /** Section headings (h1–h3) across all available locale files */
  headings: string[];
  /** Plain-text excerpt of the opening paragraph */
  excerpt: string;
}

export function getAllDocs(): DocMeta[] {
  return DOC_INDEX;
}

export function getDocsByCategory(): Record<DocCategory, DocMeta[]> {
  const result: Record<DocCategory, DocMeta[]> = {
    core: [],
    plugin: [],
    operations: [],
    reference: [],
    spec: [],
    meta: []
  };
  for (const doc of DOC_INDEX) result[doc.category].push(doc);
  return result;
}

export function getAdjacentDocs(slug: string): { prev: DocMeta | null; next: DocMeta | null } {
  const idx = DOC_INDEX.findIndex((d) => d.slug === slug);
  return {
    prev: idx > 0 ? DOC_INDEX[idx - 1] : null,
    next: idx >= 0 && idx < DOC_INDEX.length - 1 ? DOC_INDEX[idx + 1] : null
  };
}

export const CATEGORY_LABELS: Record<DocCategory, { en: string; zh: string }> = {
  core: { en: 'Core', zh: '核心' },
  plugin: { en: 'Plugin Development', zh: '插件开发' },
  operations: { en: 'Operations', zh: '运维部署' },
  reference: { en: 'Reference', zh: '参考' },
  spec: { en: 'Design Specs', zh: '设计文档' },
  meta: { en: 'Meta', zh: '关于' }
};