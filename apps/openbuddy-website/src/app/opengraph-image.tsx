import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'OpenBuddy — The open desktop AI workspace';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * /opengraph-image —— 动态生成社交卡图片
 *
 * Next.js 14 约定: 路由下放 opengraph-image.tsx 即可被自动用作
 * 该路由的 og:image，且会自动写入 <meta property="og:image"> 标签。
 *
 * 视觉: Shiba 吉祥物 + 双语标题 + 副标 + URL
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={ {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0E1117 0%, #0C4A48 60%, #00614D 100%)',
          color: '#fff',
          padding: '80px',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden'
        } }
      >
        {/* Decorative grid */}
        <div
          style={ {
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
            display: 'flex'
          } }
        />

        {/* Glow blobs */}
        <div
          style={ {
            position: 'absolute',
            top: '-100px',
            right: '-100px',
            width: '500px',
            height: '500px',
            background: 'radial-gradient(circle, rgba(0,194,154,0.4), transparent 70%)',
            display: 'flex'
          } }
        />
        <div
          style={ {
            position: 'absolute',
            bottom: '-150px',
            left: '-150px',
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, rgba(91,108,255,0.3), transparent 70%)',
            display: 'flex'
          } }
        />

        {/* Top brand row */}
        <div
          style={ {
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            zIndex: 10
          } }
        >
          <div
            style={ {
              width: '72px',
              height: '72px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #13665C 0%, #0C4A48 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '40px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
            } }
          >
            🐕
          </div>
          <div style={ { display: 'flex', flexDirection: 'column' } }>
            <div style={ { fontSize: '40px', fontWeight: 700, letterSpacing: '-0.02em' } }>OpenBuddy</div>
            <div style={ { fontSize: '18px', color: '#9FE8D9', fontWeight: 500 } }>MIT · 64 packages · 309 tests</div>
          </div>
        </div>

        {/* Main title */}
        <div
          style={ {
            display: 'flex',
            flexDirection: 'column',
            marginTop: 'auto',
            zIndex: 10
          } }
        >
          <div
            style={ {
              fontSize: '76px',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              display: 'flex'
            } }
          >
            The open desktop
          </div>
          <div
            style={ {
              fontSize: '76px',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(120deg, #00C29A 0%, #5B6CFF 100%)',
              backgroundClip: 'text',
              color: 'transparent',
              display: 'flex'
            } }
          >
            AI workspace
          </div>
          <div
            style={ {
              marginTop: '32px',
              fontSize: '24px',
              color: 'rgba(255,255,255,0.75)',
              display: 'flex'
            } }
          >
            Read it. Fork it. Own it.
          </div>
        </div>

        {/* Footer URL */}
        <div
          style={ {
            position: 'absolute',
            bottom: '60px',
            right: '80px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '20px',
            color: 'rgba(255,255,255,0.55)',
            zIndex: 10
          } }
        >
          <div style={ { width: '12px', height: '12px', borderRadius: '50%', background: '#00C29A', display: 'flex' } } />
          <span style={ { fontFamily: 'monospace' } }>openbuddy.dev</span>
        </div>
      </div>
    ),
    { ...size }
  );
}