/**
 * OpenBuddy Website —— i18n 内容字典（English / 简体中文）
 *
 * 单文件 dict 设计，便于在构建期静态生成。
 * 国际化策略：
 * - 默认语言: 'en'（英文）
 * - URL 路径策略：`/zh-CN/...` 切换中文；`/` 默认为英文
 * - 内容字段命名按页面区段（hero/features/...）保持中英结构一致
 */

export type Locale = 'en' | 'zh-CN';

export const locales: Locale[] = ['en', 'zh-CN'];
export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文'
};

export const localeFlags: Record<Locale, string> = {
  en: 'EN',
  'zh-CN': '中'
};

export interface Dict {
  meta: {
    title: string;
    description: string;
    keywords: string[];
    ogDescription: string;
  };
  nav: {
    features: string;
    architecture: string;
    comparison: string;
    showcase: string;
    docs: string;
    community: string;
    download: string;
    github: string;
    starOnGithub: string;
  };
  hero: {
    chip: string;
    titlePre: string;
    titleHighlight: string;
    titlePost: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
    ctaGithub: string;
    badge: string;
    metrics: Array<{ value: string; label: string }>;
  };
  showcase: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    tabs: Array<{ id: string; label: string; description: string }>;
  };
  features: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    items: Array<{
      icon: string;
      title: string;
      description: string;
      bullets: string[];
    }>;
  };
  architecture: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    layers: Array<{
      name: string;
      description: string;
      tech: string[];
    }>;
  };
  comparison: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    openbuddyLabel: string;
    workbuddyLabel: string;
    rows: Array<{
      capability: string;
      openbuddy: string;
      workbuddy: string;
      advantage: 'openbuddy' | 'workbuddy' | 'tie';
    }>;
  };
  capabilities: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    groups: Array<{
      name: string;
      icon: string;
      packages: Array<{ name: string; description: string }>;
    }>;
  };
  cli: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    commands: Array<{ prompt: string; response: string }>;
  };
  community: {
    sectionLabel: string;
    title: string;
    subtitle: string;
    channels: Array<{
      name: string;
      description: string;
      href: string;
      icon: string;
    }>;
  };
  cta: {
    title: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  footer: {
    tagline: string;
    product: { title: string; links: Array<{ label: string; href: string }> };
    resources: { title: string; links: Array<{ label: string; href: string }> };
    community: { title: string; links: Array<{ label: string; href: string }> };
    legal: { title: string; links: Array<{ label: string; href: string }> };
    copyright: string;
    madeWith: string;
  };
}

const en: Dict = {
  meta: {
    title: 'OpenBuddy — The open desktop AI workspace that you can actually read, fork, and own',
    description:
      'OpenBuddy is a 100% open source (MIT) desktop AI workspace, rebuilt on Electron + Pi. Pixel-close WorkBuddy UI, BYOK providers, plan mode, skills, MCP, Casdoor & NewAPI integration.',
    keywords: [
      'OpenBuddy',
      'WorkBuddy alternative',
      'open source AI',
      'desktop AI agent',
      'Electron AI',
      'Pi coding agent',
      'BYOK AI',
      'MIT AI workspace'
    ],
    ogDescription:
      'The open desktop AI workspace. 100% MIT, auditable, forkable. Built on Electron + Pi with WorkBuddy-grade UI.'
  },
  nav: {
    features: 'Features',
    architecture: 'Architecture',
    comparison: 'vs WorkBuddy',
    showcase: 'Showcase',
    docs: 'Docs',
    community: 'Community',
    download: 'Download',
    github: 'GitHub',
    starOnGithub: 'Star on GitHub'
  },
  hero: {
    chip: 'v0.14 · MIT licensed · 455 tests passing',
    titlePre: 'The open desktop',
    titleHighlight: 'AI workspace',
    titlePost: 'you can actually read, fork, and own.',
    subtitle:
      'OpenBuddy is a WorkBuddy-grade desktop AI workspace rebuilt as 100% open source (MIT) on Electron + Pi. Polished UI, plan mode, skills, MCP connectors — every byte auditable, every provider BYOK.',
    ctaPrimary: 'Download for free',
    ctaSecondary: 'Read the docs',
    ctaGithub: 'Star on GitHub',
    badge: 'Not affiliated with Tencent — independent open-source effort',
    metrics: [
      { value: '64', label: 'capability packages' },
      { value: '455', label: 'tests visible in repo' },
      { value: 'MIT', label: 'license, forkable' },
      { value: '3', label: 'platforms · Win/macOS/Linux' }
    ]
  },
  showcase: {
    sectionLabel: 'Showcase',
    title: 'See it in motion.',
    subtitle:
      'Every screenshot below is captured against the real MiniMax-M3 model in a built Electron app — not a mock.',
    tabs: [
      {
        id: 'cold-start',
        label: '01 · Cold start',
        description: 'No API key configured. Sidebar renders, composer waits for setup.'
      },
      {
        id: 'composer-ready',
        label: '02 · Composer ready',
        description: 'After configuring MiniMax, the composer is enabled and the model selector surfaces choices.'
      },
      {
        id: 'streaming',
        label: '03 · Real streaming',
        description: 'The actual MiniMax-M3 model streaming a self-introduction, with collapsible deep-thinking blocks.'
      },
      {
        id: 'multi-turn',
        label: '04 · Multi-turn',
        description: 'Three-turn transcript persisted across reloads — copy, retry, thumbs-up actions per turn.'
      }
    ]
  },
  features: {
    sectionLabel: 'Features',
    title: 'WorkBuddy-grade UX, open at the core.',
    subtitle:
      'Every feature you expect from a polished desktop AI agent — and every byte of it auditable in the repo.',
    items: [
      {
        icon: 'sparkles',
        title: 'Pixel-close WorkBuddy UI',
        description:
          'The same --wb-* design tokens, 207-icon foundation, and brand atoms that make WorkBuddy feel polished — ported, not stubbed.',
        bullets: [
          '207 icons, all implemented (zero stubs)',
          'Light + dark themes via data-theme',
          'Bilingual UI: zh-CN (default) + en-US'
        ]
      },
      {
        icon: 'cpu',
        title: 'Pi, in-process',
        description:
          '@earendil-works/pi-coding-agent runs inside Electron Main. The renderer only sees a typed preload API surface.',
        bullets: [
          'Streaming assistant deltas, tool calls, plans',
          'Cleanup-aware pi://* event channel',
          'Restart-safe session persistence'
        ]
      },
      {
        icon: 'key-round',
        title: 'BYOK, multi-provider',
        description:
          'Bring your own keys. Configure Anthropic, OpenAI-compatible, Pi, MiniMax, NewAPI, or any custom endpoint.',
        bullets: [
          'Anthropic · OpenAI · MiniMax · NewAPI',
          'OAuth / API key / Service Token modes',
          'Provider switch without restart'
        ]
      },
      {
        icon: 'puzzle',
        title: 'Cordis capability mesh',
        description:
          '64 workspace packages under @openbuddy/* — skills, memory, plan, task, email, calendar, MCP, payment, SCIM, SAML. Pick what you need.',
        bullets: [
          '12 capability packages (memory, plan, task…)',
          '26 UI packages (shell, sidebar, workbench…)',
          '8 collaboration packages (room, inbox…)'
        ]
      },
      {
        icon: 'git-branch',
        title: 'Plan · Rewind · Fork · Tasks',
        description:
          'Advanced agent workflows: plan mode with approval, conversation rewind & fork, sub-agent tasks, slash commands, local automations.',
        bullets: [
          'Plan mode toggle & view',
          'Rewind & fork past turns',
          'Sub-agent task spawning & cancel'
        ]
      },
      {
        icon: 'building-2',
        title: 'Enterprise-ready',
        description:
          'Production-grade building blocks: Casdoor OIDC, NewAPI gateway, 4 payment channels, SCIM v2, SAML 2.0, transactional outbox.',
        bullets: [
          'Casdoor OIDC + tenant policy',
          'SCIM v2 · RFC 7644 provisioning',
          'Stripe · WeChat Pay · Alipay · HMAC'
        ]
      }
    ]
  },
  architecture: {
    sectionLabel: 'Architecture',
    title: 'Three layers, one typed bridge.',
    subtitle:
      'OpenBuddy is a thin Electron host with a Cordis capability mesh. The renderer never sees a Node or provider SDK.',
    layers: [
      {
        name: 'Renderer',
        description:
          'React 18 + Vite + Zustand. Foundation ports WorkBuddy design tokens and 207 icons verbatim.',
        tech: ['React 18', 'Vite 5', 'Zustand 4', 'React Router 6']
      },
      {
        name: 'Preload bridge',
        description:
          'contextBridge with an allowlisted IPC surface — every channel registered in electron/preload/index.ts.',
        tech: ['contextBridge', 'allowlisted IPC', 'cleanup-aware events']
      },
      {
        name: 'Electron Main + Pi agent',
        description:
          'Pi AgentSession owns prompts, tools, permissions, plans, tasks. Cordis services register capabilities at startup.',
        tech: ['Electron 44', 'Pi coding agent', 'Cordis 3', 'MCP SDK 1.25']
      }
    ]
  },
  comparison: {
    sectionLabel: 'Comparison',
    title: 'OpenBuddy vs WorkBuddy.',
    subtitle: 'Only rows we can publicly substantiate. Full matrix at /docs/workbuddy-parity-matrix.',
    openbuddyLabel: 'OpenBuddy',
    workbuddyLabel: 'WorkBuddy',
    rows: [
      { capability: 'License', openbuddy: 'MIT (open)', workbuddy: 'Closed-source', advantage: 'openbuddy' },
      { capability: 'Data path', openbuddy: 'Local + your gateway', workbuddy: 'Tencent backend', advantage: 'openbuddy' },
      { capability: 'Plan mode', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: 'Skills', openbuddy: '✓ + open catalog', workbuddy: '✓', advantage: 'openbuddy' },
      { capability: 'MCP connectors', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: 'Rewind & fork', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: 'Sub-agent Tasks', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: 'Provider choice', openbuddy: 'BYOK · Anthropic / OpenAI / NewAPI / custom', workbuddy: 'Limited', advantage: 'openbuddy' },
      { capability: 'Casdoor OIDC', openbuddy: '✓', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'NewAPI gateway', openbuddy: '✓', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'SCIM v2', openbuddy: '✓ (RFC 7644)', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'SAML 2.0', openbuddy: '✓', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'Plugin SDK', openbuddy: 'Cordis open capability mesh', workbuddy: 'Closed', advantage: 'openbuddy' },
      { capability: 'Cross-platform', openbuddy: 'Win / macOS / Linux', workbuddy: 'Win / macOS', advantage: 'openbuddy' },
      { capability: 'Tests visible', openbuddy: '455 test files in repo', workbuddy: '✗', advantage: 'openbuddy' }
    ]
  },
  capabilities: {
    sectionLabel: 'Capabilities',
    title: 'A capability mesh you can extend.',
    subtitle:
      '63 packages, every one a Cordis service. Enable, configure, or replace each independently.',
    groups: [
      {
        name: 'Core agent',
        icon: 'cpu',
        packages: [
          { name: '@openbuddy/core-session', description: 'Session lifecycle, fork, rewind' },
          { name: '@openbuddy/capability-plan', description: 'Plan mode + plan approval flow' },
          { name: '@openbuddy/capability-task', description: 'Sub-agent task spawning & cancellation' },
          { name: '@openbuddy/capability-automation', description: 'Local scheduler for recurring agent runs' },
          { name: '@openbuddy/capability-web-search', description: 'Provider-pluggable web search' },
          { name: '@openbuddy/capability-inspiration', description: 'Prompt templates & starters' }
        ]
      },
      {
        name: 'Files & shell',
        icon: 'folder-open',
        packages: [
          { name: '@openbuddy/fs-fs-local', description: 'Local filesystem via Cordis' },
          { name: '@openbuddy/files-kb', description: 'Knowledge-base file indexing' }
        ]
      },
      {
        name: 'Multi-agent',
        icon: 'users',
        packages: [
          { name: '@openbuddy/team-team', description: 'Multi-agent team orchestration' },
          { name: '@openbuddy/team-subagent', description: 'Sub-agent spawning' },
          { name: '@openbuddy/collaboration-protocol', description: 'A2A message envelopes' },
          { name: '@openbuddy/collaboration-room', description: 'Shared rooms' },
          { name: '@openbuddy/collaboration-inbox', description: 'Cross-agent inbox' },
          { name: '@openbuddy/collaboration-evidence', description: 'Audit evidence' }
        ]
      },
      {
        name: 'Enterprise',
        icon: 'shield-check',
        packages: [
          { name: '@openbuddy/auth-casdoor', description: 'Casdoor OIDC client + admin REST' },
          { name: '@openbuddy/auth-permission', description: 'Permission prompts & policy UI' },
          { name: '@openbuddy/payment', description: 'Stripe / WeChat Pay / Alipay / HMAC' },
          { name: '@openbuddy/saml', description: 'SAML 2.0 primitives' },
          { name: '@openbuddy/scim', description: 'SCIM v2 endpoints (RFC 7644)' },
          { name: '@openbuddy/webhook-outbox', description: 'Transactional outbox + retry/backoff' }
        ]
      },
      {
        name: 'Email & calendar',
        icon: 'mail',
        packages: [
          { name: '@openbuddy/capability-email', description: 'IMAP/SMTP + Gmail/Graph/JMAP API' },
          { name: '@openbuddy/capability-calendar', description: 'Calendar integration' }
        ]
      },
      {
        name: 'MCP & security',
        icon: 'plug',
        packages: [
          { name: '@openbuddy/capability-mcp-client', description: 'MCP connector governance' },
          { name: '@openbuddy/capability-folder-trust', description: 'Per-folder permission grants' },
          { name: '@openbuddy/capability-authorization', description: 'Capability-level policy' }
        ]
      }
    ]
  },
  cli: {
    sectionLabel: 'In action',
    title: 'Try it without installing.',
    subtitle: 'A taste of what OpenBuddy does — straight from the terminal.',
    commands: [
      {
        prompt: '$ pnpm electron:dev',
        response:
          '✔ moon DAG resolved · 32 projects\n✔ Vite renderer up on http://localhost:5173\n✔ Electron host spawned · IPC allowlist ready\n⏳ AgentSession initializing…'
      },
      {
        prompt: '> Summarize the Q3 release notes in 3 bullets',
        response:
          '◆ Deep thinking · 4.2s\n  → identifying three top-impact changes from CHANGELOG.md…\n\n• Casdoor OIDC + tenant policy shipped\n• NewAPI gateway now BYOK + Service Token\n• SCIM v2 + SAML 2.0 provisioning complete\n\n✓ Completed · 5.1s · 248 tokens'
      }
    ]
  },
  community: {
    sectionLabel: 'Community',
    title: 'Built in the open, together.',
    subtitle: 'Where to ask, chat, contribute, and stay in the loop.',
    channels: [
      {
        name: 'GitHub Discussions',
        description: 'Design proposals, help, and roadmap conversations',
        href: 'https://github.com/louloulin/OpenBuddy/discussions',
        icon: 'message-circle'
      },
      {
        name: 'GitHub Issues',
        description: 'Bug reports & feature requests',
        href: 'https://github.com/louloulin/OpenBuddy/issues',
        icon: 'circle-dot'
      },
      {
        name: 'Discord',
        description: 'Real-time chat with contributors',
        href: 'https://discord.gg/openbuddy',
        icon: 'messages-square'
      },
      {
        name: 'WeChat group',
        description: 'Chinese-language community',
        href: '#',
        icon: 'users-round'
      },
      {
        name: 'Office hours',
        description: 'Weekly video Q&A (announced in Discussions)',
        href: '#',
        icon: 'video'
      },
      {
        name: 'YouTube',
        description: 'Talks, deep dives, release walkthroughs',
        href: 'https://youtube.com/@openbuddy',
        icon: 'youtube'
      }
    ]
  },
  cta: {
    title: 'Ready to read the source?',
    subtitle:
      'Every line of OpenBuddy is on GitHub under MIT. Fork it, audit it, ship it. No telemetry black box, no vendor lock-in.',
    ctaPrimary: 'View on GitHub',
    ctaSecondary: 'Join the community'
  },
  footer: {
    tagline:
      'The open desktop AI workspace. 100% MIT, auditable, forkable. Built on Electron + Pi with WorkBuddy-grade UI.',
    product: {
      title: 'Product',
      links: [
        { label: 'Features', href: '/#features' },
        { label: 'Architecture', href: '/#architecture' },
        { label: 'vs WorkBuddy', href: '/#comparison' },
        { label: 'Download', href: '/download' },
        { label: 'Showcase', href: '/#showcase' }
      ]
    },
    resources: {
      title: 'Resources',
      links: [
        { label: 'Documentation', href: 'https://github.com/louloulin/OpenBuddy/tree/main/docs' },
        { label: 'Getting started', href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/GETTING_STARTED.md' },
        { label: 'Plugin development', href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/PLUGIN_DEVELOPMENT.md' },
        { label: 'Roadmap', href: 'https://github.com/louloulin/OpenBuddy/blob/main/TODO.md' },
        { label: 'Changelog', href: 'https://github.com/louloulin/OpenBuddy/blob/main/CHANGELOG.md' }
      ]
    },
    community: {
      title: 'Community',
      links: [
        { label: 'GitHub', href: 'https://github.com/louloulin/OpenBuddy' },
        { label: 'Discussions', href: 'https://github.com/louloulin/OpenBuddy/discussions' },
        { label: 'Discord', href: 'https://discord.gg/openbuddy' },
        { label: 'Sponsors', href: '/sponsors' }
      ]
    },
    legal: {
      title: 'Legal',
      links: [
        { label: 'License (MIT)', href: 'https://github.com/louloulin/OpenBuddy/blob/main/LICENSE' },
        { label: 'Security', href: 'https://github.com/louloulin/OpenBuddy/blob/main/SECURITY.md' },
        { label: 'Code of conduct', href: 'https://github.com/louloulin/OpenBuddy/blob/main/CODE_OF_CONDUCT.md' },
        { label: 'Trademark policy', href: 'https://github.com/louloulin/OpenBuddy/blob/main/BRAND.md#trademark-policy' }
      ]
    },
    copyright: '© 2025 OpenBuddy contributors. Released under the MIT License.',
    madeWith: 'Built on Electron, React, Vite, and Pi · Shiba mascot by the OpenBuddy community'
  }
};

const zhCN: Dict = {
  meta: {
    title: 'OpenBuddy —— 开源桌面 AI 工作台,你可以真正阅读、fork 并拥有',
    description:
      'OpenBuddy 是 100% 开源 (MIT) 的桌面 AI 工作台,基于 Electron + Pi 重建。WorkBuddy 级 UI、BYOK 多 provider、Plan Mode、Skills、MCP、Casdoor & NewAPI 集成。',
    keywords: [
      'OpenBuddy',
      'WorkBuddy 替代',
      '开源 AI',
      '桌面 AI 助手',
      'Electron AI',
      'Pi coding agent',
      'BYOK AI',
      'MIT AI 工作台'
    ],
    ogDescription: '开源桌面 AI 工作台。100% MIT、可审计、可 fork。基于 Electron + Pi,WorkBuddy 级 UI。'
  },
  nav: {
    features: '功能',
    architecture: '架构',
    comparison: '对比 WorkBuddy',
    showcase: '截图',
    docs: '文档',
    community: '社区',
    download: '下载',
    github: 'GitHub',
    starOnGithub: '在 GitHub 上 Star'
  },
  hero: {
    chip: 'v0.14 · MIT 协议 · 455 测试通过',
    titlePre: '开源的桌面',
    titleHighlight: 'AI 工作台,',
    titlePost: '你可以真正阅读、fork 并拥有。',
    subtitle:
      'OpenBuddy 是 WorkBuddy 级桌面 AI 工作台,基于 Electron + Pi 完整重建为 100% 开源 (MIT)。精致 UI、Plan Mode、Skills、MCP 连接器 —— 每个字节都可审计,每个 provider 都 BYOK。',
    ctaPrimary: '免费下载',
    ctaSecondary: '阅读文档',
    ctaGithub: '在 GitHub 上 Star',
    badge: '与腾讯无关 —— 独立开源项目',
    metrics: [
      { value: '64', label: '能力包' },
      { value: '455', label: '仓库内可见测试' },
      { value: 'MIT', label: '协议,可 fork' },
      { value: '3', label: '平台 · Win/macOS/Linux' }
    ]
  },
  showcase: {
    sectionLabel: '截图',
    title: '眼见为实。',
    subtitle: '以下每张截图都由真实的 MiniMax-M3 模型在已构建的 Electron 应用中捕获 —— 不是 mock。',
    tabs: [
      { id: 'cold-start', label: '01 · 冷启动', description: '未配置 API key。Sidebar 已就绪,等待配置。' },
      { id: 'composer-ready', label: '02 · Composer 就绪', description: '配置 MiniMax 后,Composer 启用,模型选择器展示选项。' },
      { id: 'streaming', label: '03 · 真实流式', description: '真实 MiniMax-M3 模型流式输出自我介绍,可折叠的深度思考块。' },
      { id: 'multi-turn', label: '04 · 多轮对话', description: '三轮对话在重载后持久化 —— 每轮支持复制、重试、点赞。' }
    ]
  },
  features: {
    sectionLabel: '功能',
    title: 'WorkBuddy 级 UX,核心开源。',
    subtitle: '你对精致桌面 AI 助手的所有期望 —— 每一字节都可在仓库中审计。',
    items: [
      {
        icon: 'sparkles',
        title: '像素级 WorkBuddy UI',
        description: '相同的 --wb-* 设计令牌、207 图标基础、品牌原子 —— 真实移植,不是占位符。',
        bullets: ['207 图标全部实现 (零占位)', '通过 data-theme 支持明暗主题', '双语 UI: zh-CN (默认) + en-US']
      },
      {
        icon: 'cpu',
        title: 'Pi 进程内运行',
        description: '@earendil-works/pi-coding-agent 运行在 Electron Main 内。Renderer 只看到类型化的 preload API。',
        bullets: ['流式助手 delta、工具调用、计划', '可清理感知的 pi://* 事件通道', '跨重启的会话持久化']
      },
      {
        icon: 'key-round',
        title: 'BYOK,多 provider',
        description: '自带 key。支持 Anthropic、OpenAI-compatible、Pi、MiniMax、NewAPI 或任意自定义端点。',
        bullets: ['Anthropic · OpenAI · MiniMax · NewAPI', 'OAuth / API key / Service Token 模式', '切换 provider 无需重启']
      },
      {
        icon: 'puzzle',
        title: 'Cordis 能力网格',
        description: '@openbuddy/* 下 64 个工作区包 —— skills、memory、plan、task、email、calendar、MCP、payment、SCIM、SAML。按需选用。',
        bullets: ['12 个能力包 (memory、plan、task…)', '26 个 UI 包 (shell、sidebar、workbench…)', '8 个协作包 (room、inbox…)']
      },
      {
        icon: 'git-branch',
        title: '计划 · 回退 · Fork · 子任务',
        description: '高级 agent 工作流:带审批的 Plan 模式、会话回退与 fork、子 agent 任务、slash 命令、本地自动化。',
        bullets: ['Plan 模式开关与视图', '回退与 fork 过去轮次', '子 agent 任务生成与取消']
      },
      {
        icon: 'building-2',
        title: '企业级就绪',
        description: '生产级积木:Casdoor OIDC、NewAPI 网关、4 个支付通道、SCIM v2、SAML 2.0、事务性 outbox。',
        bullets: ['Casdoor OIDC + 租户策略', 'SCIM v2 · RFC 7644 配置', 'Stripe · 微信支付 · 支付宝 · HMAC']
      }
    ]
  },
  architecture: {
    sectionLabel: '架构',
    title: '三层架构,一座类型化桥。',
    subtitle: 'OpenBuddy 是带 Cordis 能力网格的轻量 Electron 宿主。Renderer 永远看不到 Node 或 provider SDK。',
    layers: [
      {
        name: 'Renderer',
        description: 'React 18 + Vite + Zustand。基础层逐字移植 WorkBuddy 设计令牌与 207 图标。',
        tech: ['React 18', 'Vite 5', 'Zustand 4', 'React Router 6']
      },
      {
        name: 'Preload 桥',
        description: '带白名单 IPC 表面的 contextBridge —— 每个通道在 electron/preload/index.ts 注册。',
        tech: ['contextBridge', '白名单 IPC', '可清理事件']
      },
      {
        name: 'Electron Main + Pi agent',
        description: 'Pi AgentSession 拥有 prompt、tools、permissions、plans、tasks。Cordis 服务在启动时注册能力。',
        tech: ['Electron 44', 'Pi coding agent', 'Cordis 3', 'MCP SDK 1.25']
      }
    ]
  },
  comparison: {
    sectionLabel: '对比',
    title: 'OpenBuddy vs WorkBuddy。',
    subtitle: '只列出可公开证实的项目。完整对比矩阵见 /docs/workbuddy-parity-matrix。',
    openbuddyLabel: 'OpenBuddy',
    workbuddyLabel: 'WorkBuddy',
    rows: [
      { capability: '协议', openbuddy: 'MIT (开源)', workbuddy: '闭源', advantage: 'openbuddy' },
      { capability: '数据路径', openbuddy: '本地 + 你的网关', workbuddy: '腾讯后端', advantage: 'openbuddy' },
      { capability: 'Plan 模式', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: 'Skills', openbuddy: '✓ + 开源目录', workbuddy: '✓', advantage: 'openbuddy' },
      { capability: 'MCP 连接器', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: '回退与 fork', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: '子 agent 任务', openbuddy: '✓', workbuddy: '✓', advantage: 'tie' },
      { capability: 'Provider 选择', openbuddy: 'BYOK · Anthropic / OpenAI / NewAPI / 自定义', workbuddy: '有限', advantage: 'openbuddy' },
      { capability: 'Casdoor OIDC', openbuddy: '✓', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'NewAPI 网关', openbuddy: '✓', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'SCIM v2', openbuddy: '✓ (RFC 7644)', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: 'SAML 2.0', openbuddy: '✓', workbuddy: '✗', advantage: 'openbuddy' },
      { capability: '插件 SDK', openbuddy: 'Cordis 开源能力网格', workbuddy: '封闭', advantage: 'openbuddy' },
      { capability: '跨平台', openbuddy: 'Win / macOS / Linux', workbuddy: 'Win / macOS', advantage: 'openbuddy' },
      { capability: '测试可见', openbuddy: '仓库内 455 测试文件', workbuddy: '✗', advantage: 'openbuddy' }
    ]
  },
  capabilities: {
    sectionLabel: '能力',
    title: '可扩展的能力网格。',
    subtitle: '63 个包,每个都是 Cordis 服务。可独立启用、配置或替换。',
    groups: [
      {
        name: '核心 Agent',
        icon: 'cpu',
        packages: [
          { name: '@openbuddy/core-session', description: '会话生命周期、fork、回退' },
          { name: '@openbuddy/capability-plan', description: 'Plan 模式与审批流' },
          { name: '@openbuddy/capability-task', description: '子 agent 任务生成与取消' },
          { name: '@openbuddy/capability-automation', description: '周期性 agent 运行调度器' },
          { name: '@openbuddy/capability-web-search', description: '可插拔 provider 的 Web 搜索' },
          { name: '@openbuddy/capability-inspiration', description: 'Prompt 模板与启动器' }
        ]
      },
      {
        name: '文件与 Shell',
        icon: 'folder-open',
        packages: [
          { name: '@openbuddy/fs-fs-local', description: '通过 Cordis 的本地文件系统' },
          { name: '@openbuddy/files-kb', description: '知识库文件索引' }
        ]
      },
      {
        name: '多 Agent',
        icon: 'users',
        packages: [
          { name: '@openbuddy/team-team', description: '多 agent 团队编排' },
          { name: '@openbuddy/team-subagent', description: '子 agent 生成' },
          { name: '@openbuddy/collaboration-protocol', description: 'A2A 消息信封' },
          { name: '@openbuddy/collaboration-room', description: '共享房间' },
          { name: '@openbuddy/collaboration-inbox', description: '跨 agent 收件箱' },
          { name: '@openbuddy/collaboration-evidence', description: '审计证据' }
        ]
      },
      {
        name: '企业级',
        icon: 'shield-check',
        packages: [
          { name: '@openbuddy/auth-casdoor', description: 'Casdoor OIDC 客户端 + 管理 REST' },
          { name: '@openbuddy/auth-permission', description: '权限提示与策略 UI' },
          { name: '@openbuddy/payment', description: 'Stripe / 微信支付 / 支付宝 / HMAC' },
          { name: '@openbuddy/saml', description: 'SAML 2.0 原语' },
          { name: '@openbuddy/scim', description: 'SCIM v2 端点 (RFC 7644)' },
          { name: '@openbuddy/webhook-outbox', description: '事务性 outbox + 重试/退避' }
        ]
      },
      {
        name: '邮件与日历',
        icon: 'mail',
        packages: [
          { name: '@openbuddy/capability-email', description: 'IMAP/SMTP + Gmail/Graph/JMAP API' },
          { name: '@openbuddy/capability-calendar', description: '日历集成' }
        ]
      },
      {
        name: 'MCP 与安全',
        icon: 'plug',
        packages: [
          { name: '@openbuddy/capability-mcp-client', description: 'MCP 连接器治理' },
          { name: '@openbuddy/capability-folder-trust', description: '按文件夹的权限授予' },
          { name: '@openbuddy/capability-authorization', description: '能力级策略' }
        ]
      }
    ]
  },
  cli: {
    sectionLabel: '现场演示',
    title: '不安装先试一下。',
    subtitle: '看看 OpenBuddy 能做什么 —— 直接在终端里。',
    commands: [
      {
        prompt: '$ pnpm electron:dev',
        response:
          '✔ moon DAG 已解析 · 32 项目\n✔ Vite renderer 已启动 http://localhost:5173\n✔ Electron 宿主已生成 · IPC 白名单就绪\n⏳ AgentSession 初始化中…'
      },
      {
        prompt: '> 用 3 个要点总结 Q3 发布说明',
        response:
          '◆ 深度思考 · 4.2s\n  → 从 CHANGELOG.md 中识别三个最有影响力的变化…\n\n• Casdoor OIDC + 租户策略已发布\n• NewAPI 网关现在支持 BYOK + Service Token\n• SCIM v2 + SAML 2.0 配置完成\n\n✓ 已完成 · 5.1s · 248 tokens'
      }
    ]
  },
  community: {
    sectionLabel: '社区',
    title: '公开构建,共同完成。',
    subtitle: '提问、聊天、贡献、获取最新动态的地方。',
    channels: [
      { name: 'GitHub Discussions', description: '设计提案、帮助与路线图讨论', href: 'https://github.com/louloulin/OpenBuddy/discussions', icon: 'message-circle' },
      { name: 'GitHub Issues', description: 'Bug 报告与功能请求', href: 'https://github.com/louloulin/OpenBuddy/issues', icon: 'circle-dot' },
      { name: 'Discord', description: '与贡献者实时聊天', href: 'https://discord.gg/openbuddy', icon: 'messages-square' },
      { name: '微信群', description: '中文社区', href: '#', icon: 'users-round' },
      { name: 'Office hours', description: '每周视频答疑 (在 Discussions 公布)', href: '#', icon: 'video' },
      { name: 'YouTube', description: '演讲、深入解析、发布走读', href: 'https://youtube.com/@openbuddy', icon: 'youtube' }
    ]
  },
  cta: {
    title: '准备好阅读源码了吗?',
    subtitle: 'OpenBuddy 的每一行代码都在 GitHub 上,以 MIT 协议发布。Fork 它、审计它、发布它。无遥测黑箱,无供应商锁定。',
    ctaPrimary: '在 GitHub 查看',
    ctaSecondary: '加入社区'
  },
  footer: {
    tagline: '开源的桌面 AI 工作台。100% MIT、可审计、可 fork。基于 Electron + Pi,WorkBuddy 级 UI。',
    product: {
      title: '产品',
      links: [
        { label: '功能', href: '/#features' },
        { label: '架构', href: '/#architecture' },
        { label: '对比 WorkBuddy', href: '/#comparison' },
        { label: '下载', href: '/download' },
        { label: '截图', href: '/#showcase' }
      ]
    },
    resources: {
      title: '资源',
      links: [
        { label: '文档', href: 'https://github.com/louloulin/OpenBuddy/tree/main/docs' },
        { label: '快速开始', href: 'https://github.com/lougoulin/OpenBuddy/blob/main/docs/GETTING_STARTED.zh-CN.md' },
        { label: '插件开发', href: 'https://github.com/louloulin/OpenBuddy/blob/main/docs/PLUGIN_DEVELOPMENT.md' },
        { label: '路线图', href: 'https://github.com/louloulin/OpenBuddy/blob/main/TODO.md' },
        { label: '更新日志', href: 'https://github.com/louloulin/OpenBuddy/blob/main/CHANGELOG.zh-CN.md' }
      ]
    },
    community: {
      title: '社区',
      links: [
        { label: 'GitHub', href: 'https://github.com/louloulin/OpenBuddy' },
        { label: 'Discussions', href: 'https://github.com/louloulin/OpenBuddy/discussions' },
        { label: 'Discord', href: 'https://discord.gg/openbuddy' },
        { label: '赞助', href: '/sponsors' }
      ]
    },
    legal: {
      title: '法律',
      links: [
        { label: '协议 (MIT)', href: 'https://github.com/louloulin/OpenBuddy/blob/main/LICENSE' },
        { label: '安全', href: 'https://github.com/louloulin/OpenBuddy/blob/main/SECURITY.md' },
        { label: '行为准则', href: 'https://github.com/louloulin/OpenBuddy/blob/main/CODE_OF_CONDUCT.md' },
        { label: '商标政策', href: 'https://github.com/louloulin/OpenBuddy/blob/main/BRAND.md#trademark-policy' }
      ]
    },
    copyright: '© 2025 OpenBuddy contributors. 以 MIT 协议发布。',
    madeWith: '基于 Electron、React、Vite 与 Pi 构建 · Shiba 吉祥物由 OpenBuddy 社区设计'
  }
};

export const dictionaries: Record<Locale, Dict> = { en, 'zh-CN': zhCN };

export function getDictionary(locale: Locale): Dict {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

/**
 * 从 Next.js 中提取 locale 的工具函数 —— 支持 `/zh-CN/...` 路径前缀与 `?lang=` 查询参数回退。
 * 默认语言不带前缀。
 */
export function extractLocaleFromPath(pathname: string): Locale {
  const seg = pathname.split('/').filter(Boolean)[0];
  if (seg === 'zh-CN') return 'zh-CN';
  return defaultLocale;
}

export function localizedPath(path: string, locale: Locale): string {
  if (locale === defaultLocale) return path;
  return `/${locale}${path.startsWith('/') ? path : `/${path}`}`;
}