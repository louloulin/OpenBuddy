import type { MetadataRoute } from 'next';

const SITE_URL = 'https://openbuddy.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/_next/'] }
    ],
    sitemap: `${ SITE_URL }/sitemap.xml`
  };
}