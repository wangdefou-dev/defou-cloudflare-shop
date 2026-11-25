import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { loadSiteContent } from './lib/site-content';
import { pageDisabled, publicPaths } from './lib/seo';

// Every page renders from the latest site content and product rows (cached a few seconds).
export const onRequest = defineMiddleware(async (context, next) => {
  await loadSiteContent(env);
  const path = context.url.pathname.replace(/\/+$/, '') || '/';
  // A module switched off in the site content behaves like a page that does not exist.
  if (pageDisabled(path)) return context.rewrite('/__not-found');
  const response = await next();
  if (publicPaths().includes(path) || path === '/privacy')
    response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  return response;
});
