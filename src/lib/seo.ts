import { SCENE_IMAGES, SHOP_IMAGES } from './media';
import { MODULE_PAGES, PUBLIC_PATHS } from './public-site';
import {
  APPLE_FAQS,
  APPLE_PRODUCTS,
  BRAND_NAME,
  CONTENT_UPDATED,
  ORIGIN_LABEL,
  PUBLISHER_TAGLINE,
  PUBLIC_ORIGIN,
} from './content';
import { chinaDate, isSaleDay, SEASON_END, SPONSOR_MIN_HEADCOUNT } from './shared';
import { STORE, feature, fill, onStoreChange } from './store-config';
// The uploaded logo when there is one, otherwise the default apple mark.
const logoUrl = () =>
  PUBLIC_ORIGIN + ((STORE.brand.logo as { src: string } | null)?.src || '/apple-touch-icon-v2.png');
const place = () => STORE.seo.place as { name: string; region: string; locality: string } | null;

/** Public pages that are switched on in the site content right now. */
export const publicPaths = () =>
  PUBLIC_PATHS.filter((p) => !MODULE_PAGES[p] || feature(MODULE_PAGES[p]));
/** True for a page whose module is switched off: it answers 404. */
export const pageDisabled = (path: string) => !!MODULE_PAGES[path] && !feature(MODULE_PAGES[path]);

export const publisherTitle = (title: string) =>
  !PUBLISHER_TAGLINE || title.includes(PUBLISHER_TAGLINE)
    ? title
    : `${title}｜${PUBLISHER_TAGLINE}`;
export const publisherDescription = (description: string) =>
  !PUBLISHER_TAGLINE || description.includes(PUBLISHER_TAGLINE)
    ? description
    : `${description}${PUBLISHER_TAGLINE}。`;
type Meta = { title: string; description: string; keywords: string[]; label: string };
type PageMeta = {
  title: string;
  description: string;
  keywords: string[];
  label: string;
  image?: string;
};
const seoVars = { minHeadcount: SPONSOR_MIN_HEADCOUNT };
// Titles and descriptions live in the site content → seo; {brand}/{origin}/... are filled in.
function pageMeta(): Record<string, PageMeta> {
  const pageImages: Record<string, string> = {
    '/': SCENE_IMAGES.ORCHARD.src,
    '/buy': SHOP_IMAGES.FAMILY.src,
    '/tree': SHOP_IMAGES.PA.src,
    '/treat': SCENE_IMAGES.COMMUNITY.src,
    '/guide': SHOP_IMAGES.GIFT.src,
  };
  const enabled = publicPaths();
  const meta: Record<string, PageMeta> = Object.fromEntries(
    Object.entries(STORE.seo.pages as Record<string, Meta>)
      .filter(([path]) => enabled.includes(path))
      .map(([path, m]) => [
        path,
        {
          title: fill(m.title, seoVars),
          description: fill(m.description, seoVars),
          label: m.label,
          keywords: m.keywords.map((k) => fill(k, seoVars)),
          ...(pageImages[path] ? { image: pageImages[path] } : {}),
        },
      ]),
  );
  for (const p of APPLE_PRODUCTS) {
    const vars = { name: p.name, count: p.count, weight: p.weight, description: p.description };
    meta['/apples/' + p.slug] = {
      title: fill(STORE.seo.product.title, vars),
      description: fill(STORE.seo.product.description, vars),
      label: p.name,
      keywords: STORE.seo.product.keywords.map((k) => fill(k, vars)),
      image: p.image,
    };
  }
  for (const m of Object.values(meta)) {
    m.title = publisherTitle(m.title);
    m.description = publisherDescription(m.description);
    if (PUBLISHER_TAGLINE) m.keywords.push(PUBLISHER_TAGLINE);
  }
  return meta;
}
// Live binding, rebuilt whenever the site content or catalog changes.
export let PAGE_META = pageMeta();
onStoreChange(() => {
  PAGE_META = pageMeta();
});
export const refreshPageMeta = () => {
  PAGE_META = pageMeta();
};
const PRIVATE_PATHS = [
  '/api/',
  '/admin',
  '/tree/my',
  '/order',
  '/pay/',
  '/media/',
  '/images/optimized/wechat-qr-',
];
export { publicSearchEnabled } from './public-site';
export function canonicalUrl(path: string) {
  // Use only a pathname, never user-controlled query parameters or a preview hostname.
  const pathname = new URL(path, PUBLIC_ORIGIN).pathname;
  return PUBLIC_ORIGIN + (pathname === '/' ? '/' : pathname.replace(/\/+$/, ''));
}
export const serializeJsonLd = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export function websiteGraph(path: string, title: string, description: string) {
  const url = canonicalUrl(path);
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': PUBLIC_ORIGIN + '/#organization',
      name: STORE.brand.publisher,
      brand: { '@id': PUBLIC_ORIGIN + '/#brand' },
      url: PUBLIC_ORIGIN,
      logo: logoUrl(),
    },
    {
      '@type': 'Brand',
      '@id': PUBLIC_ORIGIN + '/#brand',
      name: BRAND_NAME,
      url: PUBLIC_ORIGIN,
      logo: logoUrl(),
      description: fill(STORE.seo.brandDescription),
    },
    ...(place()
      ? [
          {
            '@type': 'Place',
            '@id': PUBLIC_ORIGIN + '/#orchard',
            name: fill(place()!.name),
            description: ORIGIN_LABEL,
            address: {
              '@type': 'PostalAddress',
              addressCountry: 'CN',
              addressRegion: place()!.region,
              addressLocality: place()!.locality,
            },
          },
        ]
      : []),
    {
      '@type': 'WebSite',
      '@id': PUBLIC_ORIGIN + '/#website',
      url: PUBLIC_ORIGIN,
      name: BRAND_NAME,
      alternateName: fill(STORE.seo.alternateName),
      inLanguage: 'zh-CN',
      publisher: { '@id': PUBLIC_ORIGIN + '/#organization' },
    },
    {
      '@type': 'WebPage',
      '@id': url + '#webpage',
      url,
      name: title,
      description,
      inLanguage: 'zh-CN',
      dateModified: CONTENT_UPDATED,
      isPartOf: { '@id': PUBLIC_ORIGIN + '/#website' },
      about: [
        { '@id': PUBLIC_ORIGIN + '/#brand' },
        ...(place() ? [{ '@id': PUBLIC_ORIGIN + '/#orchard' }] : []),
      ],
    },
  ];
  if (path !== '/')
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': url + '#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: PUBLIC_ORIGIN + '/' },
        ...(path.startsWith('/apples/')
          ? [
              {
                '@type': 'ListItem',
                position: 2,
                name: STORE.words.buy,
                item: canonicalUrl('/buy'),
              },
            ]
          : []),
        {
          '@type': 'ListItem',
          position: path.startsWith('/apples/') ? 3 : 2,
          name: PAGE_META[path]?.label || title.split('｜')[0],
          item: url,
        },
      ],
    });
  return graph;
}
export const faqSchema = (
  faqs: readonly (readonly [string, string])[] = APPLE_FAQS,
  path = '/guide',
) => ({
  '@type': 'FAQPage',
  '@id': canonicalUrl(path) + '#faq',
  mainEntity: faqs.map(([name, text]) => ({
    '@type': 'Question',
    name,
    acceptedAnswer: { '@type': 'Answer', text },
  })),
});
export function productSchema(
  product: (typeof APPLE_PRODUCTS)[number],
  stock: { price: number; stock?: number; active?: number } | null,
  env: Pick<Env, 'SALES_OPEN'>,
  now = new Date(),
) {
  const url = canonicalUrl('/apples/' + product.slug);
  const current = chinaDate(0, now);
  return {
    '@type': 'Product',
    '@id': url + '#product',
    name: BRAND_NAME + ' · ' + product.name,
    description: product.description,
    mainEntityOfPage: { '@id': url + '#webpage' },
    sku: product.sku,
    image: PUBLIC_ORIGIN + product.image,
    brand: { '@type': 'Brand', '@id': PUBLIC_ORIGIN + '/#brand', name: BRAND_NAME },
    countryOfOrigin: { '@type': 'Country', name: '中国' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: '公开产地', value: ORIGIN_LABEL },
      {
        '@type': 'PropertyValue',
        name: STORE.words.countLabel,
        value: product.count,
        unitText: STORE.words.countUnit,
      },
      { '@type': 'PropertyValue', name: '单果约重', value: product.weight, unitText: 'g' },
      { '@type': 'PropertyValue', name: '每箱约重', value: product.totalKg, unitText: 'kg' },
    ],
    ...(stock && stock.price > 0 && current <= SEASON_END
      ? {
          offers: {
            '@type': 'Offer',
            url,
            priceCurrency: 'CNY',
            price: (stock.price / 100).toFixed(2),
            priceValidUntil: SEASON_END,
            ...(stock.stock !== undefined && stock.active !== undefined
              ? {
                  availability:
                    env.SALES_OPEN === 'true' &&
                    stock.active === 1 &&
                    stock.stock > 0 &&
                    isSaleDay(current)
                      ? 'https://schema.org/InStock'
                      : 'https://schema.org/OutOfStock',
                }
              : {}),
            seller: { '@id': PUBLIC_ORIGIN + '/#organization' },
          },
        }
      : {}),
  };
}
export function robotsText(enabled: boolean) {
  if (!enabled) return 'User-agent: *\nDisallow: /\n';
  const rules = ['Allow: /', ...PRIVATE_PATHS.map((p) => 'Disallow: ' + p)].join('\n');
  return `User-agent: *\n${rules}\n\nUser-agent: OAI-SearchBot\n${rules}\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`;
}
export function sitemapXml(enabled: boolean) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    enabled
      ? publicPaths()
          .map(
            (p) => `<url><loc>${canonicalUrl(p)}</loc><lastmod>${CONTENT_UPDATED}</lastmod></url>`,
          )
          .join('')
      : ''
  }</urlset>`;
}
export function llmsText(enabled: boolean) {
  if (!enabled) return `# ${BRAND_NAME}\n\n本站暂未开放搜索索引。\n`;
  return (
    [
      `# ${BRAND_NAME}`,
      `> ${PUBLISHER_TAGLINE}。${fill(STORE.seo.llmsIntro)}`,
      '## 品牌与商品事实',
      `- 品牌：${BRAND_NAME}；经营者：${STORE.brand.publisher}；正式网站：${PUBLIC_ORIGIN}/。`,
      ...APPLE_PRODUCTS.map(
        (p) =>
          `- ${p.name}：每箱${p.count}个，单果约${p.weight}g，整箱约${p.totalKg}kg。详情：${canonicalUrl('/apples/' + p.slug)}。`,
      ),
      ...STORE.seo.llmsFacts.map((f) => '- ' + fill(f, seoVars)),
      '## 官方页面',
      publicPaths()
        .map((p) => `- [${PAGE_META[p].title}](${canonicalUrl(p)}): ${PAGE_META[p].description}`)
        .join('\n'),
      '## 常见问题',
      APPLE_FAQS.map(([q, a]) => `### ${q}\n${a}`).join('\n\n'),
      '## 引用与更新',
      '价格、库存、可售状态和运费以对应页面实时显示为准。事实与规格以文字为准，果品和包装以实物为准。订单、后台、登录及媒体中的私人信息不属于公开资料。',
      `内容更新：${CONTENT_UPDATED}。`,
    ].join('\n\n') + '\n'
  );
}
