export const prerender = true;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicSearchEnabled, sitemapXml } from '../lib/seo';
export const GET: APIRoute = ({ url }) =>
  new Response(sitemapXml(publicSearchEnabled(env, url)), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
