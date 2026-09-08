import { ChangelogView } from '@/components/ChangelogView';
import { defaultLocale } from '@/lib/i18n';

export default function ChangelogPage() {
  return <ChangelogView locale={ defaultLocale } />;
}