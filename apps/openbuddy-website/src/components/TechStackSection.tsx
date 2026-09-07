import { Code2 } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface TechStackSectionProps {
  dict: Dict;
}

const STACK_EN: Array<{ name: string; desc: string }> = [
  { name: 'Electron 44', desc: 'Desktop runtime · contextBridge IPC' },
  { name: 'Pi coding agent', desc: 'In-process LLM agent · @earendil-works/pi-coding-agent' },
  { name: 'React 18', desc: 'Renderer · Vite 5 · Zustand stores' },
  { name: 'Cordis 3', desc: 'Capability mesh · DI framework' },
  { name: 'MCP SDK 1.25', desc: 'Model Context Protocol connectors' },
  { name: 'Casdoor', desc: 'OIDC SSO + tenant policy' },
  { name: 'NewAPI', desc: 'Model gateway (BYOK + Service Token)' },
  { name: 'Vitest 2', desc: '309 test files · pnpm workspace:test' },
  { name: 'Playwright 1.58', desc: 'Real-model UI tests · closed-loop evals' },
  { name: 'moon 2.5', desc: '32-project DAG · incremental builds' },
  { name: 'TypeScript 5.6', desc: 'Strict mode · zero `any` in shared code' },
  { name: 'pnpm 11', desc: 'Workspace package manager' }
];

const STACK_ZH: Array<{ name: string; desc: string }> = [
  { name: 'Electron 44', desc: '桌面运行时 · contextBridge IPC' },
  { name: 'Pi coding agent', desc: '进程内 LLM agent · @earendil-works/pi-coding-agent' },
  { name: 'React 18', desc: 'Renderer · Vite 5 · Zustand stores' },
  { name: 'Cordis 3', desc: '能力网格 · DI 框架' },
  { name: 'MCP SDK 1.25', desc: 'Model Context Protocol 连接器' },
  { name: 'Casdoor', desc: 'OIDC SSO + 租户策略' },
  { name: 'NewAPI', desc: '模型网关 (BYOK + Service Token)' },
  { name: 'Vitest 2', desc: '309 测试文件 · pnpm workspace:test' },
  { name: 'Playwright 1.58', desc: '真实模型 UI 测试 · 闭环 evals' },
  { name: 'moon 2.5', desc: '32 项目 DAG · 增量构建' },
  { name: 'TypeScript 5.6', desc: '严格模式 · 共享代码零 any' },
  { name: 'pnpm 11', desc: '工作区包管理器' }
];

const COPY_EN = {
  title: 'Built on a familiar stack.',
  subtitle:
    'Every choice below is boring on purpose. We want OpenBuddy to be the AI workspace you can actually own — not a research project that drifts when the maintainers do.',
  badge: 'Open source foundations'
};

const COPY_ZH = {
  title: '基于熟悉的栈构建。',
  subtitle: '以下每一个选择都是刻意的稳健。我们希望 OpenBuddy 成为你可以真正拥有的 AI 工作台 —— 不是维护者离开就漂移的研究项目。',
  badge: '开源基础'
};

/**
 * TechStackSection —— 技术栈展示
 *
 * 设计要点：
 * - 12 个技术卡片，4×3 网格
 * - 每个卡片：技术名 + 一行描述
 * - hover 轻微上浮 + border 变深
 * - 简洁 grid 风格
 */
export default function TechStackSection({ dict }: TechStackSectionProps) {
  const isZh = dict.meta.title.includes('开源');
  const stack = isZh ? STACK_ZH : STACK_EN;
  const copy = isZh ? COPY_ZH : COPY_EN;

  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ copy.badge }
          title={ copy.title }
          subtitle={ copy.subtitle }
        />

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          { stack.map((tech) => (
            <article
              key={ tech.name }
              className="group relative flex flex-col gap-1 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg)] p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
            >
              <div className="flex items-center gap-2">
                <Code2 className="h-3.5 w-3.5 text-[var(--wb-fg-muted)]" />
                <h3 className="font-mono text-[13.5px] font-semibold text-[var(--wb-fg)]">
                  { tech.name }
                </h3>
              </div>
              <p className="text-[12px] leading-snug text-[var(--wb-fg-muted)]">
                { tech.desc }
              </p>
            </article>
          )) }
        </div>
      </div>
    </section>
  );
}