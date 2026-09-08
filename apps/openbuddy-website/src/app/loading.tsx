/**
 * /loading.tsx —— Suspense fallback (server component)
 *
 * Next.js 在使用 <Suspense> 或 streaming SSR 时展示。
 * 这里用一个简短的 brand-aware 加载指示。
 */
export default function Loading() {
  return (
    <main
      style={ {
        minHeight: '60vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px'
      } }
    >
      <div style={ { display: 'flex', alignItems: 'center', gap: '12px' } }>
        <span
          style={ {
            display: 'inline-block',
            width: '20px',
            height: '20px',
            border: '2px solid var(--wb-border, #D0D7DE)',
            borderTopColor: 'var(--wb-brand, #00C29A)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          } }
        />
        <span
          style={ {
            fontFamily: 'monospace',
            fontSize: '13px',
            color: 'var(--wb-fg-muted, #656D76)',
            letterSpacing: '0.04em'
          } }
        >
          Loading…
        </span>
      </div>

      <style>{ `@keyframes spin { to { transform: rotate(360deg); } }` }</style>
    </main>
  );
}