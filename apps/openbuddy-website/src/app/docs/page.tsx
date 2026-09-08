import { DocsView } from '@/components/DocsView';
import { defaultLocale } from '@/lib/i18n';

export default function DocsPage() {
  return <DocsView locale={ defaultLocale } />;
}