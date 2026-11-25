// One set of rules for site content, used by the admin save API and `npm run config:check`.
// Every key in the defaults must exist with the same type; lists may change length.
type Doc = Record<string, any>;
export type ImageCheck = (src: string, path: string) => string | null;

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
// Optional image-like slots may be null or an object.
const nullable = new Set([
  'brand.logo',
  'brand.contact.wechatQr',
  'brand.contact.officialQr',
  'seo.place',
]);
/** Images may be built-in files under /images/ or uploads under /media/. */
export const IMAGE_SRC =
  /^\/(?:images\/[\w./-]+\.(?:jpe?g|png|webp|svg|avif)|media\/apple-2026\/[a-f0-9-]+\.(?:jpg|png|webp))$/;

export function validateStore(base: Doc, config: Doc, imageCheck?: ImageCheck) {
  const errors: string[] = [];
  function compare(a: any, b: any, path: string) {
    if (path.startsWith('images.') || nullable.has(path)) return;
    if (kind(a) !== kind(b)) return void errors.push(`${path}：应为 ${kind(a)}，实际是 ${kind(b)}`);
    if (kind(a) === 'object')
      for (const key of Object.keys(a)) {
        // Pages of switched-off modules need no SEO entry.
        if (!(key in b)) {
          if (path !== 'seo.pages') errors.push(`${path ? path + '.' : ''}${key}：缺少这一项`);
        } else compare(a[key], b[key], path ? path + '.' + key : key);
      }
    if (kind(a) === 'array' && a.length && b.length)
      b.forEach((item: unknown, i: number) => compare(a[0], item, `${path}[${i}]`));
  }
  compare(base, config, '');
  const image = (v: any, path: string) => {
    if (v === null) return;
    if (kind(v) !== 'object' || typeof v.src !== 'string' || !(v.width > 0) || !(v.height > 0))
      return void errors.push(
        `${path}：写 null，或 {"src": "/images/...", "width": 宽, "height": 高}`,
      );
    if (!IMAGE_SRC.test(v.src))
      return void errors.push(`${path}.src：只能是 /images/ 下的图片或后台上传的图片`);
    const missing = imageCheck?.(v.src, path);
    if (missing) errors.push(missing);
  };
  for (const [key, v] of Object.entries(config.images || {})) image(v, 'images.' + key);
  image(config.brand?.logo ?? null, 'brand.logo');
  image(config.brand?.contact?.officialQr ?? null, 'brand.contact.officialQr');
  const int = (v: unknown, min: number, max: number, path: string, hint: string) => {
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
      errors.push(`${path}：${hint}`);
  };
  const r = config.rules || {};
  int(r.maxQtyPerOrder, 1, 200, 'rules.maxQtyPerOrder', '每单数量上限写 1–200 的整数');
  for (const [sku, v] of Object.entries(r.claimPerFruit || {}))
    int(v, 0, 1000, `rules.claimPerFruit.${sku}`, '坏果赔付写 0–1000 元的整数');
  int(r.sponsorMinHeadcount, 1, 10000, 'rules.sponsorMinHeadcount', '赞助最少人数写正整数');
  int(r.sponsorDaysAfterSeason, 0, 365, 'rules.sponsorDaysAfterSeason', '写 0–365 天');
  const n = config.notifications || {};
  int(n.dailyHour, 0, 23, 'notifications.dailyHour', '写 0–23');
  int(n.dailyMinute, 0, 59, 'notifications.dailyMinute', '写 0–59');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.startDate || ''))
    errors.push('notifications.startDate：写成 YYYY-MM-DD');
  if (!/^\d{6}$/.test(config.map?.originCode || ''))
    errors.push('map.originCode：写六位城市代码，例如 130500');
  const a = config.analytics || {};
  if (a.googleId && !/^G-[A-Z0-9]{4,20}$/.test(a.googleId))
    errors.push('analytics.googleId：Google 统计 ID 形如 G-XXXXXXX');
  for (const k of ['cloudflareToken', 'googleVerification', 'bingVerification'])
    if (a[k] && !/^[\w-]{6,100}$/.test(a[k]))
      errors.push(`analytics.${k}：只能包含字母、数字、- 和 _`);
  const video = config.home?.hero?.videoUrl;
  if (video && !/^https:\/\/[^\s"<>]+\.mp4(?:\?[^\s"<>]*)?$/.test(video))
    errors.push('home.hero.videoUrl：填 https 开头的 .mp4 视频地址，或留空');
  if (!/^https:\/\/[^/]+$/.test(config.brand?.siteUrl || ''))
    errors.push('brand.siteUrl：写正式网址，以 https:// 开头、末尾不带 /');
  if (!/^#[0-9a-fA-F]{6}$/.test(config.brand?.themeColor || ''))
    errors.push('brand.themeColor：写成 #RRGGBB');
  for (const k of ['start', 'end', 'contentUpdated'])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(config.season?.[k] || ''))
      errors.push(`season.${k}：写成 YYYY-MM-DD`);
  if (config.season?.start > config.season?.end) errors.push('season：开始日期晚于结束日期');
  for (const i of config.home?.faq?.pick || [])
    if (!config.faqs?.[i]) errors.push(`home.faq.pick：第 ${i + 1} 条常见问题不存在`);
  const f = config.features || {};
  for (const page of [
    '/',
    '/buy',
    '/guide',
    ...(f.adoption ? ['/tree'] : []),
    ...(f.sponsorship ? ['/treat'] : []),
    ...(f.footprintMap ? ['/map'] : []),
  ])
    if (!config.seo?.pages?.[page]) errors.push(`seo.pages：缺少已开启页面 ${page} 的标题和描述`);
  const icons = ['mountain', 'sprout', 'truck', 'heart'];
  for (const p of config.home?.promises || [])
    if (!icons.includes(p.icon)) errors.push(`home.promises：icon 只能是 ${icons.join(' / ')}`);
  return errors;
}
