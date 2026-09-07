import Hero from '@/components/Hero';
import ShowcaseSection from '@/components/ShowcaseSection';
import FeaturesSection from '@/components/FeaturesSection';
import ArchitectureSection from '@/components/ArchitectureSection';
import ComparisonSection from '@/components/ComparisonSection';
import CapabilitiesSection from '@/components/CapabilitiesSection';
import CLISection from '@/components/CLISection';
import CommunitySection from '@/components/CommunitySection';
import CTASection from '@/components/CTASection';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { defaultLocale, getDictionary } from '@/lib/i18n';

/**
 * 首页 (默认英文)
 *
 * Next.js App Router 的根路由 `/`。中文版位于 `/zh-CN/`。
 * 通过 `src/app/zh-CN/page.tsx` 复用本组件，传不同 locale。
 */
export default function HomePage() {
  const locale = defaultLocale;
  const dict = getDictionary(locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content">
        <Hero dict={ dict } locale={ locale } />
        <ShowcaseSection dict={ dict } />
        <FeaturesSection dict={ dict } />
        <ArchitectureSection dict={ dict } />
        <ComparisonSection dict={ dict } />
        <CapabilitiesSection dict={ dict } />
        <CLISection dict={ dict } />
        <CommunitySection dict={ dict } />
        <CTASection dict={ dict } />
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}