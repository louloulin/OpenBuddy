/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 允许 deep links 到 docs/* 等静态资源（GitHub README 截图直接访问）
  async rewrites() {
    return [
      { source: '/docs/:path*', destination: '/docs/:path*' }
    ];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'github.com' },
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'api.star-history.com' },
      { protocol: 'https', hostname: 'img.shields.io' }
    ]
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'react-syntax-highlighter']
  }
};

export default nextConfig;