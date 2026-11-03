export function offlineResponse(env: Pick<Env, 'SITE_OFFLINE'>, request: Request) {
  if (env.SITE_OFFLINE !== 'true') return;
  const api = new URL(request.url).pathname.startsWith('/api/');
  const message = '网站暂未开放，请稍后再来。';
  return new Response(
    request.method === 'HEAD'
      ? null
      : api
        ? JSON.stringify({ error: message })
        : `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>网站暂未开放 · 果园商店</title><style>body{margin:0;padding:12vh 24px;background:#f8f6ef;color:#243c2d;font-family:system-ui,sans-serif}main{max-width:560px;margin:auto}h1{font-size:32px;font-weight:500}p{line-height:1.8;color:#687263}</style></head><body><main><p>果园商店</p><h1>网站暂未开放</h1><p>我们正在准备，晚点再来。</p></main></body></html>`,
    {
      status: 503,
      headers: {
        'content-type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '600',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      },
    },
  );
}
