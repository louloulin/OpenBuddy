'use client';

import Link from 'next/link';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * global-error.tsx —— 全局错误页 (500 等)
 *
 * Next.js 约定: 顶级 error.tsx 无法捕获 root layout 错误。
 * global-error.tsx 包装 root layout，是真正的兜底页面。
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en" className="antialiased">
      <body
        style={ {
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          background: '#0E1117',
          color: '#E6EDF3',
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center'
        } }
      >
        <div style={ { textAlign: 'center', maxWidth: '480px', padding: '0 24px' } }>
          <div
            style={ {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              margin: '0 auto 24px'
            } }
          >
            <AlertTriangle size={ 28 } color="#F87171" />
          </div>

          <p style={ { fontSize: '12px', color: '#8B949E', margin: 0, letterSpacing: '0.16em', textTransform: 'uppercase' } }>
            500 · Application error
          </p>
          <h1 style={ { fontSize: '32px', fontWeight: 600, margin: '12px 0 16px', lineHeight: 1.1 } }>
            Something went wrong.
          </h1>
          <p style={ { fontSize: '15px', color: '#8B949E', lineHeight: 1.6, margin: '0 0 32px' } }>
            We've been notified. If the issue persists, please open a bug report with the error ID below.
          </p>

          { error.digest ? (
            <code
              style={ {
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: '6px',
                background: '#161B22',
                border: '1px solid #30363D',
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#8B949E',
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
                background: '#E6EDF3',
                color: '#0E1117',
                border: 0,
                borderRadius: '8px',
                fontWeight: 500,
                fontSize: '14px',
                cursor: 'pointer'
              } }
            >
              <RefreshCw size={ 14 } />
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
                color: '#E6EDF3',
                border: '1px solid #30363D',
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
      </body>
    </html>
  );
}