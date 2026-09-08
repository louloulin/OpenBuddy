'use client';

import Link from 'next/link';
import { AlertOctagon, RefreshCw, ArrowLeft } from 'lucide-react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * /error.tsx —— 路由级错误边界
 *
 * 自动包裹所有 page.tsx，捕获子组件错误并展示。
 */
export default function Error({ error, reset }: ErrorProps) {
  return (
    <main
      style={ {
        minHeight: '60vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px'
      } }
    >
      <div style={ { textAlign: 'center', maxWidth: '520px' } }>
        <div
          style={ {
            display: 'inline-flex',
            width: '64px',
            height: '64px',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '16px',
            background: 'var(--wb-brand-soft, rgba(0, 194, 154, 0.08))',
            border: '1px solid var(--wb-brand-border, rgba(0, 194, 154, 0.2))',
            margin: '0 auto 24px'
          } }
        >
          <AlertOctagon size={ 28 } color="var(--wb-error, #cf222e)" />
        </div>

        <p
          style={ {
            fontSize: '12px',
            color: 'var(--wb-fg-muted, #656D76)',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            margin: 0
          } }
        >
          500 · Route error
        </p>
        <h1
          style={ {
            fontSize: '32px',
            fontWeight: 600,
            margin: '12px 0 16px',
            color: 'var(--wb-fg, #1F2328)',
            lineHeight: 1.1
          } }
        >
          This page hit a snag.
        </h1>
        <p
          style={ {
            fontSize: '15px',
            color: 'var(--wb-fg-muted, #656D76)',
            lineHeight: 1.6,
            margin: '0 0 24px'
          } }
        >
          { error.message || 'An unexpected error occurred while rendering this page.' }
        </p>

        { error.digest ? (
          <code
            style={ {
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'var(--wb-bg-soft, #FAFAFA)',
              border: '1px solid var(--wb-border, #D0D7DE)',
              fontFamily: 'monospace',
              fontSize: '12px',
              color: 'var(--wb-fg-muted, #656D76)',
              marginBottom: '24px'
            } }
          >
            { error.digest }
          </code>
        ) : null }

        <div style={ { display: 'flex', gap: '8px', justifyContent: 'center' } }>
          <button
            type="button"
            onClick={ () => reset() }
            style={ {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 18px',
              background: 'var(--wb-fg, #1F2328)',
              color: 'var(--wb-bg, #FFFFFF)',
              border: 0,
              borderRadius: '8px',
              fontWeight: 500,
              fontSize: '14px',
              cursor: 'pointer'
            } }
          >
            <RefreshCw size={ 14} />
            <span>Try again</span>
          </button>
          <Link
            href="/"
            style={ {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 18px',
              background: 'transparent',
              color: 'var(--wb-fg, #1F2328)',
              border: '1px solid var(--wb-border, #D0D7DE)',
              borderRadius: '8px',
              fontWeight: 500,
              fontSize: '14px',
              textDecoration: 'none'
            } }
          >
            <ArrowLeft size={ 14 } />
            <span>Take me home</span>
          </Link>
        </div>
      </div>
    </main>
  );
}