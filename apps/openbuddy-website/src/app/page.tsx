import Hero from '@/components/Hero';
import ShowcaseSection from '@/components/ShowcaseSection';
import FeaturesSection from '@/components/FeaturesSection';
import ArchitectureSection from '@/components/ArchitectureSection';
import StatsSection from '@/components/StatsSection';
import ComparisonSection from '@/components/ComparisonSection';
import CapabilitiesSection from '@/components/CapabilitiesSection';
import TechStackSection from '@/components/TechStackSection';
import CLISection from '@/components/CLISection';
import TestimonialsSection from '@/components/TestimonialsSection';
import FAQSection from '@/components/FAQSection';
import CommunitySection from '@/components/CommunitySection';
import CTASection from '@/components/CTASection';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { defaultLocale, getDictionary } from '@/lib/i18n';

/**
 * 首页 (默认英文) —— tutti 严格对标版
 *
 * 关键变化 (vs 旧版):
 * - 12+ section 精简到 11 个 (合并 capabilities + tech-stack + features 中重叠部分)
 * - 暗/亮 section 交替 (tutti 视觉节奏)
 * - 移除 AsciiDivider (tutti 没有这个装饰)
 * - 每个 section 都是独立的局部主题 ([data-section-theme])
 * - 整体节奏: dark → light → cream → light → dark → cream → dark → light → cream → light → dark
 */
export default function HomePage() {
  const locale = defaultLocale;
  const dict = getDictionary(locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content">
        {/* 1. Hero (dark) */}
        <Hero dict={ dict } locale={ locale } />

        {/* 2. Product showcase (light) — real screenshots */}
        <ShowcaseSection dict={ dict } />

        {/* 3. Capabilities (cream) — what makes OpenBuddy different */}
        <CapabilitiesSection dict={ dict } />

        {/* 4. Features grid (light) — 6 capabilities */}
        <FeaturesSection dict={ dict } />

        {/* 5. Comparison (cream) — vs WorkBuddy */}
        <ComparisonSection dict={ dict } />

        {/* 6. Architecture (dark) — 3 layers */}
        <ArchitectureSection dict={ dict } />

        {/* 7. Stats (light) — by the numbers */}
        <StatsSection dict={ dict } />

        {/* 8. Tech stack (cream) — compact list */}
        <TechStackSection dict={ dict } />

        {/* 9. CLI in action (dark) — terminal */}
        <CLISection dict={ dict } />

        {/* 10. Testimonials + FAQ (light) */}
        <TestimonialsSection dict={ dict } />
        <FAQSection dict={ dict } />

        {/* 11. Community + CTA (cream → dark) */}
        <CommunitySection dict={ dict } />
        <CTASection dict={ dict } />
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}
