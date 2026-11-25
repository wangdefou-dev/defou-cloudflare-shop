import { offlineResponse } from './lib/site-status';
import { bundledAsset } from './lib/static-assets';
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const started = performance.now();
    const offline = offlineResponse(env, request);
    if (offline) return offline;
    const url = new URL(request.url);
    let response: Response;
    // Pages render per request (site content is editable in the admin); only bundled files are assets.
    const asset = await bundledAsset(request, env.ASSETS);
    if (asset) response = asset;
    else if (url.pathname.startsWith('/api/')) {
      const { api } = await import('./lib/api');
      response = await api(request, env);
      if (
        ['/api/stripe/webhook', '/api/treat/apply', '/api/tree/book'].includes(url.pathname) &&
        request.method === 'POST' &&
        response.ok
      )
        ctx.waitUntil(
          import('./lib/notifications')
            .then(({ flushCommerceNotifications }) => flushCommerceNotifications(env))
            .catch((e) =>
              console.error(
                JSON.stringify({
                  event: 'notification_flush_failed',
                  kind: e instanceof Error ? e.name : 'unknown',
                }),
              ),
            ),
        );
    } else if (url.pathname.startsWith('/media/')) {
      const key = decodeURIComponent(url.pathname.slice(7));
      if (!/^apple-2026\/[a-f0-9-]+\.(jpg|png|webp|pdf)$/.test(key))
        return new Response('Not found', { status: 404 });
      if (key.endsWith('.pdf')) {
        try {
          const { admin } = await import('./lib/security');
          await admin(env, request);
        } catch {
          return new Response('Unauthorized', {
            status: 401,
            headers: {
              'cache-control': 'private, no-store',
              'x-robots-tag': 'noindex,nofollow,noarchive,nosnippet',
            },
          });
        }
      }
      const o = await env.MEDIA.get(key);
      response = o
        ? new Response(o.body, {
            headers: {
              'content-type': o.httpMetadata?.contentType || 'application/octet-stream',
              'cache-control': key.endsWith('.pdf') ? 'private, no-store' : 'public, max-age=86400',
              'x-content-type-options': 'nosniff',
            },
          })
        : new Response('Not found', { status: 404 });
    } else {
      // Old address of the site settings console.
      if (url.pathname === '/studio' || url.pathname.startsWith('/studio/'))
        return Response.redirect(new URL('/admin/studio', url).href, 302);
      // Site settings sit under /admin (already behind Cloudflare Access) with their own list.
      const studioPage =
        url.pathname === '/admin/studio' || url.pathname.startsWith('/admin/studio/');
      if (studioPage || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        const { admin, studio, HttpError } = await import('./lib/security');
        try {
          await (studioPage ? studio : admin)(env, request);
        } catch (e) {
          return new Response(e instanceof HttpError ? e.message : 'Unauthorized', {
            status: e instanceof HttpError ? e.status : 401,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'private, no-store',
              'x-robots-tag': 'noindex,nofollow,noarchive,nosnippet',
            },
          });
        }
      }
      const [{ astro, FetchState }, { cf, finalize }] = await Promise.all([
        import('astro/fetch'),
        import('@astrojs/cloudflare/fetch'),
      ]);
      const state = new FetchState(request);
      response = (await cf(state, env, ctx)) || finalize(state, await astro(state));
    }
    const h = new Headers(response.headers);
    if (
      url.pathname === '/admin' ||
      url.pathname.startsWith('/admin/') ||
      url.pathname.startsWith('/api/admin/') ||
      (url.pathname.startsWith('/media/') && url.pathname.endsWith('.pdf'))
    ) {
      h.set('Cache-Control', 'private, no-store');
      h.set('X-Robots-Tag', 'noindex,nofollow,noarchive,nosnippet');
    }
    h.set('X-Content-Type-Options', 'nosniff');
    // Also suppress private path/query referrers when navigating within this site.
    h.set('Referrer-Policy', 'strict-origin');
    h.set('X-Frame-Options', 'DENY');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    h.append('Server-Timing', `worker;dur=${(performance.now() - started).toFixed(1)}`);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: h,
    });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Scheduled jobs read the same site settings (brand name, report schedule) as pages.
    const { loadSiteContent } = await import('./lib/site-content');
    await loadSiteContent(env).catch(() => {});
    ctx.waitUntil(
      Promise.allSettled([
        import('./lib/database').then(({ maintenance }) => maintenance(env)),
        import('./lib/notifications').then(({ notificationJobs }) => notificationJobs(env)),
      ]).then((results) => {
        results.forEach((r, i) => {
          if (r.status === 'rejected')
            console.error(
              JSON.stringify({
                event: 'scheduled_job_failed',
                job: i === 0 ? 'maintenance' : 'notifications',
                kind: r.reason instanceof Error ? r.reason.name : 'unknown',
              }),
            );
        });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
