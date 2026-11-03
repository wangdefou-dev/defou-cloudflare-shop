import { PUBLIC_PATHS, publicSearchEnabled } from './public-site';
import { analyticsPage } from './analytics';

type StaticEnv = Pick<
  Env,
  'APP_ORIGIN' | 'SITE_OFFLINE' | 'DEMO_MODE' | 'SANDBOX_CHECKOUT' | 'ASSETS'
>;
const pages = new Set([...PUBLIC_PATHS, '/privacy']);
const documents = new Set(['/robots.txt', '/sitemap.xml', '/llms.txt']);

// Only build-generated public content. Private routes always use the authenticated
// application handler. Asset binding retains Cloudflare's ETags and atomic deploys.
export async function staticPage(request: Request, env: StaticEnv) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!['GET', 'HEAD'].includes(request.method) || (!pages.has(path) && !documents.has(path)))
    return;
  // Read a canonical public asset, without forwarding credentials or query data.
  const assetUrl = new URL(path, url.origin);
  const headers = new Headers();
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await env.ASSETS.fetch(
    new Request(assetUrl, { method: request.method, headers }),
  );
  const h = new Headers(response.headers);
  const valid =
    [200, 304].includes(response.status) &&
    !h.has('set-cookie') &&
    !/(?:private|no-store)/i.test(h.get('cache-control') || '') &&
    (response.status === 304 ||
      (h.get('content-type') || '').startsWith(
        pages.has(path) ? 'text/html' : path === '/sitemap.xml' ? 'application/xml' : 'text/plain',
      ));
  if (!valid)
    return new Response('Page unavailable', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  h.set('Cache-Control', 'public, max-age=0, must-revalidate');
  h.set('X-Page-Render', 'static');
  h.set(
    'X-Robots-Tag',
    publicSearchEnabled(env, url) &&
      pages.has(path) &&
      path !== '/privacy' &&
      analyticsPage(url.href)
      ? 'index,follow,max-image-preview:large'
      : 'noindex,nofollow,noarchive',
  );
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: h,
  });
}
