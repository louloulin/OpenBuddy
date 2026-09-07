'use client';

import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';

interface CopyButtonProps {
  text: string;
  className?: string;
}

/**
 * CopyButton —— 客户端组件，复制文本到剪贴板
 *
 * 提取为独立 client component 以让上层 page.tsx 保持 server component。
 */
export default function CopyButton({ text, className = '' }: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <button
      type="button"
      aria-label={ copied ? 'Copied' : 'Copy to clipboard' }
      onClick={ () => copy(text) }
      className={ `inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg)] text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)] ${className}` }
    >
      { copied ? <Check className="h-3.5 w-3.5 text-brand-8" /> : <Copy className="h-3.5 w-3.5" /> }
    </button>
  );
}