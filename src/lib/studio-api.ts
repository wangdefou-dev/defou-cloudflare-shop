// Site settings console API (/api/admin/studio/*): page content, media library and a read-only view of
// payment, domain and service setup. Secrets are reported only as configured / missing.
import { z } from 'zod';
import { assert, jsonBody, rateLimit, studio } from './security';
import { restoreSiteContent, saveSiteContent, siteContentState } from './site-content-admin';
import { uploadMedia } from './media-upload';
import { PUBLIC_ORIGIN, publicSearchEnabled } from './public-site';
import { STORE } from './store-config';
import { settings } from './database';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
// [variable, group, purpose, kind]. kind: var (plain, shown), secret (never shown),
// fallback (now edited in the site settings; the variable only fills an empty setting),
// unused (no code reads it; safe to remove from wrangler.jsonc).
const INVENTORY: [string, string, string, 'var' | 'secret' | 'fallback' | 'unused'][] = [
  ['APP_ORIGIN', '站点', '当前环境网址', 'var'],
  ['SITE_OFFLINE', '站点', '停站开关（true 时全站显示停站页）', 'var'],
  ['SALES_OPEN', '站点', '销售总开关（日常暂停用「接单与运费」）', 'var'],
  ['DEMO_MODE', '站点', '本地演示模式（只在本机生效）', 'var'],
  ['SANDBOX_CHECKOUT', '站点', '测试站允许销售季外测试下单', 'var'],
  ['STRIPE_MODE', '支付', '正式收款 live / 测试 sandbox', 'var'],
  ['STRIPE_PAYMENT_METHOD_CONFIGURATION', '支付', 'Stripe 支付方式配置', 'var'],
  ['STRIPE_SECRET_KEY', '支付', '收款受限密钥', 'secret'],
  ['STRIPE_WEBHOOK_SECRET', '支付', '支付回调签名密钥', 'secret'],
  ['STRIPE_REFUND_SECRET_KEY', '支付', '后台快捷退款专用密钥', 'secret'],
  ['ACCESS_TEAM_DOMAIN', '登录', 'Cloudflare Access 团队域名', 'var'],
  ['ACCESS_AUD', '登录', 'Cloudflare Access 应用标识', 'var'],
  ['ADMIN_EMAIL', '登录', '经营后台管理员邮箱', 'secret'],
  ['STUDIO_EMAIL', '登录', '网站设置管理员邮箱', 'secret'],
  ['TURNSTILE_SITE_KEY', '登录', '人机验证站点密钥', 'var'],
  ['TURNSTILE_SECRET_KEY', '登录', '人机验证服务端密钥', 'secret'],
  ['NOTIFICATIONS_ENABLED', '通知', 'Telegram 订单通知总开关', 'var'],
  ['TELEGRAM_BOT_TOKEN', '通知', 'Telegram 机器人令牌', 'secret'],
  ['TELEGRAM_CHAT_ID', '通知', '接收通知的私聊', 'secret'],
  ['TRACKING_ENABLED', '物流', '快递100 实时查询总开关', 'var'],
  ['KUAIDI100_CUSTOMER', '物流', '快递100 客户编号', 'secret'],
  ['KUAIDI100_KEY', '物流', '快递100 授权 Key', 'secret'],
  ['NOTIFICATION_DAILY_HOUR', '已移到网站设置', '日报时间 → 网站内容 · 通知', 'fallback'],
  ['NOTIFICATION_DAILY_MINUTE', '已移到网站设置', '日报时间 → 网站内容 · 通知', 'fallback'],
  ['NOTIFICATION_START_DATE', '已移到网站设置', '上线日期 → 网站内容 · 通知', 'fallback'],
  ['HERO_VIDEO_URL', '已移到网站设置', '首屏视频 → 网站内容 · 首页', 'fallback'],
  ['CONTACT_WECHAT', '已移到网站设置', '客服微信 → 网站内容 · 品牌与联系', 'fallback'],
  ['OFFICIAL_QR_URL', '已移到网站设置', '公众号二维码 → 网站内容 · 品牌与联系', 'fallback'],
  ['GOOGLE_ANALYTICS_ID', '已移到网站设置', 'Google 统计 → 网站内容 · 搜索与统计', 'fallback'],
  [
    'CLOUDFLARE_ANALYTICS_TOKEN',
    '已移到网站设置',
    'Cloudflare 统计 → 网站内容 · 搜索与统计',
    'fallback',
  ],
  ['GOOGLE_SITE_VERIFICATION', '已移到网站设置', 'Google 验证 → 网站内容 · 搜索与统计', 'fallback'],
  ['BING_SITE_VERIFICATION', '已移到网站设置', 'Bing 验证 → 网站内容 · 搜索与统计', 'fallback'],
];
const IMAGE_KEY = /^apple-2026\/[a-f0-9-]+\.(?:jpg|png|webp)$/;

export async function studioApi(request: Request, env: Env, path: string) {
  const actor = await studio(env, request);
  const read = request.method === 'GET';
  await rateLimit(env, 'studio-' + actor + ':' + path, read ? 300 : 60);
  if (path === '/api/admin/studio/site-content' && read) return json(await siteContentState(env));
  if (path === '/api/admin/studio/status' && read) return json(await status(env, request));
  if (path === '/api/admin/studio/store' && read) return json(await settings(env));
  if (path === '/api/admin/studio/media' && read)
    return json(await mediaList(env, new URL(request.url).searchParams.get('cursor') || undefined));
  assert(request.method === 'POST', 405, '请求方法不支持');
  let result: Record<string, unknown>;
  let target = '';
  if (path === '/api/admin/studio/site-content') {
    result = await saveSiteContent(env, actor, request);
    target = 'v' + result.version;
  } else if (path === '/api/admin/studio/site-content/restore') {
    result = await restoreSiteContent(env, actor, await jsonBody(request));
    target = 'v' + result.version;
  } else if (path === '/api/admin/studio/store') {
    // Accepting orders, the store announcement and remote-area shipping: immediate, no deploy.
    const b = z
      .object({
        sales_paused: z.boolean(),
        announcement: z.string().trim().max(200),
        remote_fee: z.number().int().min(0).max(100000),
        remote_provinces: z.array(z.string().regex(/^\d{6}$/)).max(40),
      })
      .strict()
      .parse(await jsonBody(request));
    await env.DB.batch(
      Object.entries(b).map(([k, v]) =>
        env.DB.prepare(
          'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        ).bind(k, JSON.stringify(v)),
      ),
    );
    result = {};
    target = 'store';
  } else if (path === '/api/admin/studio/upload') {
    result = await uploadMedia(env, request, { allowPdf: false, source: 'studio' });
    target = String(result.url);
  } else if (path === '/api/admin/studio/media/delete') {
    const b = z
      .object({ key: z.string().regex(IMAGE_KEY) })
      .strict()
      .parse(await jsonBody(request));
    const uses = await mediaUses(env, '/media/' + b.key);
    assert(!uses.length, 409, '这张图片还在使用中：' + uses.join('、'));
    await env.MEDIA.delete(b.key);
    result = {};
    target = b.key;
  } else return json({ error: '接口不存在' }, 404);
  await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(crypto.randomUUID(), actor, path, target)
    .run();
  return json({ ok: true, ...result });
}

/**
 * Where uploaded images are referenced. One query per source (not per image), so a page of
 * images costs seven reads. Deleting is only allowed when nothing uses the image.
 */
async function referenceTexts(env: Env) {
  const sources: [string, string][] = [
    ['网站内容', 'SELECT data t FROM site_content'],
    ['商品图', 'SELECT image_url t FROM products WHERE image_url IS NOT NULL'],
    ['采摘日记', 'SELECT photo_urls t FROM diary_posts'],
    ['活动返图', "SELECT photos t FROM sponsor_apps WHERE photos!='[]'"],
    ['认领树照', "SELECT tree_photo_urls t FROM adoptions WHERE tree_photo_urls!='[]'"],
    ['坏果理赔', 'SELECT photos t FROM claims'],
    ['历史版本', 'SELECT data t FROM site_content_history'],
  ];
  const rows = await Promise.all(
    sources.map(([, sql]) => env.DB.prepare(sql).all<{ t: string }>()),
  );
  return sources.map(([name], i) => ({
    name,
    text: (rows[i].results || []).map((r) => r.t).join('\n'),
  }));
}
const usesOf = (refs: { name: string; text: string }[], url: string) =>
  refs.filter((r) => r.text.includes(url)).map((r) => r.name);
async function mediaUses(env: Env, url: string) {
  return usesOf(await referenceTexts(env), url);
}

async function mediaList(env: Env, cursor?: string) {
  const [page, refs] = await Promise.all([
    env.MEDIA.list({ prefix: 'apple-2026/', limit: 100, cursor }),
    referenceTexts(env),
  ]);
  const items = page.objects
    .filter((o) => IMAGE_KEY.test(o.key))
    .map((o) => ({
      key: o.key,
      url: '/media/' + o.key,
      size: o.size,
      uploaded: o.uploaded.toISOString(),
      uses: usesOf(refs, '/media/' + o.key),
    }));
  items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return { items, cursor: page.truncated ? page.cursor : null };
}

async function status(env: Env, request: Request) {
  const set = (v?: string) => !!v && v.trim().length > 0;
  const lastWebhook = await env.DB.prepare(
    'SELECT type,created_at FROM webhook_events ORDER BY created_at DESC LIMIT 1',
  ).first<{ type: string; created_at: string }>();
  const webhooks7d = await env.DB.prepare(
    "SELECT COUNT(*) n FROM webhook_events WHERE created_at>=datetime('now','-7 days')",
  ).first<{ n: number }>();
  let objects = 0,
    bytes = 0,
    cursor: string | undefined,
    pages = 0;
  do {
    const page = await env.MEDIA.list({ prefix: 'apple-2026/', limit: 1000, cursor });
    for (const o of page.objects) {
      objects++;
      bytes += o.size;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && ++pages < 10);
  const count = (v?: string) => (v || '').split(',').filter((e) => e.trim()).length;
  const e = env as unknown as Record<string, string | undefined>;
  // Every deploy-time variable the code reads. Secrets report only configured / missing.
  const inventory = INVENTORY.map(([name, group, purpose, kind]) => ({
    name,
    group,
    purpose,
    kind,
    configured: set(e[name]),
    value: kind === 'var' && name !== 'ACCESS_AUD' ? e[name] || '' : '',
  }));
  return {
    inventory,
    payment: {
      mode: env.STRIPE_MODE || 'sandbox',
      secretKey: set(env.STRIPE_SECRET_KEY),
      webhookSecret: set(env.STRIPE_WEBHOOK_SECRET),
      refundKey: set(env.STRIPE_REFUND_SECRET_KEY),
      paymentMethodConfiguration: set(env.STRIPE_PAYMENT_METHOD_CONFIGURATION),
      salesOpen: env.SALES_OPEN === 'true',
      season: { start: STORE.season.start, end: STORE.season.end },
      lastWebhook,
      webhooks7d: webhooks7d?.n || 0,
    },
    site: {
      publicOrigin: PUBLIC_ORIGIN,
      appOrigin: env.APP_ORIGIN || '',
      requestOrigin: new URL(request.url).origin,
      offline: env.SITE_OFFLINE === 'true',
      demo: env.DEMO_MODE === 'true',
      sandboxCheckout: env.SANDBOX_CHECKOUT === 'true',
      searchIndexing: publicSearchEnabled(env, new URL(PUBLIC_ORIGIN)),
      analytics:
        set(STORE.analytics.googleId || env.GOOGLE_ANALYTICS_ID) ||
        set(STORE.analytics.cloudflareToken || env.CLOUDFLARE_ANALYTICS_TOKEN),
    },
    access: {
      configured: set(env.ACCESS_TEAM_DOMAIN) && set(env.ACCESS_AUD),
      admins: count(env.ADMIN_EMAIL),
      studio: count(env.STUDIO_EMAIL),
      turnstile: set(env.TURNSTILE_SITE_KEY) && set(env.TURNSTILE_SECRET_KEY),
    },
    media: {
      bound: !!env.MEDIA,
      objects,
      bytes,
      partial: !!cursor,
    },
    services: {
      notifications: env.NOTIFICATIONS_ENABLED === 'true',
      telegram: set(env.TELEGRAM_BOT_TOKEN) && set(env.TELEGRAM_CHAT_ID),
      tracking: env.TRACKING_ENABLED === 'true',
      kuaidi100: set(env.KUAIDI100_CUSTOMER) && set(env.KUAIDI100_KEY),
    },
  };
}
