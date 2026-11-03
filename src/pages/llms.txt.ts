export const prerender = true;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicSearchEnabled, llmsText } from '../lib/seo';
export const GET: APIRoute = ({ url }) =>
  new Response(llmsText(publicSearchEnabled(env, url)), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
