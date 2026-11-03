import { activeCatalog, productPath } from './catalog';
import type { CatalogProduct } from './catalog';
import site from '../../config/site.json';
import { SCENE_IMAGES, SHOP_IMAGES } from './media';
import { PUBLIC_PATHS } from './public-site';
export { PUBLIC_PATHS } from './public-site';
import {
  APPLE_FAQS,
  APPLE_PRODUCTS,
  BRAND_NAME,
  CONTENT_UPDATED,
  ORIGIN_LABEL,
  PUBLISHER_TAGLINE,
  PUBLIC_ORIGIN,
} from './content';
import { chinaDate, isSaleDay, SEASON_END, SEASON_START, SPONSOR_MIN_HEADCOUNT } from './shared';

export const publisherTitle = (title: string) =>
  title.includes(PUBLISHER_TAGLINE) ? title : `${title}｜${PUBLISHER_TAGLINE}`;
export const publisherDescription = (description: string) =>
  description.includes(PUBLISHER_TAGLINE) ? description : `${description}${PUBLISHER_TAGLINE}。`;
export const PAGE_META: Record<
  string,
  {
    title: string;
    description: string;
    keywords: string[];
    label: string;
    image?: string;
  }
> = {
  '/': {
    title: `${BRAND_NAME}苹果｜${ORIGIN_LABEL}苹果·家庭装与礼盒装`,
    description: `${BRAND_NAME}的果园位于${ORIGIN_LABEL}。了解家庭装与礼盒装规格、苹安树认领、社区活动苹果赞助，以及快递配送与坏果赔付规则。`,
    label: '首页',
    image: SCENE_IMAGES.ORCHARD.src,
    keywords: [
      BRAND_NAME,
      `${BRAND_NAME}苹果`,
      `${ORIGIN_LABEL}苹果`,
      '山间苹果',
      '苹果家庭装',
      '苹果礼盒',
      '果树认领',
    ],
  },
  '/buy': {
    title: `${BRAND_NAME}买苹果｜家庭装、礼盒装与快递配送`,
    label: '买苹果',
    keywords: [BRAND_NAME, '买苹果', '苹果家庭装', '苹果礼盒', '苹果产地直发', '快递配送'],
    description:
      '挑选山间果园的苹果：家庭装单果约 250g，22 个、约 5.5kg；礼盒装单果约 350g，8 个、约 2.8kg。查看当前价格、库存和快递配送规则。',
    image: SHOP_IMAGES.FAMILY.src,
  },
  '/tree': {
    title: `${BRAND_NAME}苹安树认领｜平安树8箱、富贵树15箱`,
    label: '认领苹安树',
    keywords: [BRAND_NAME, '苹安树认领', '苹果树认养', '平安树', '富贵树', '分次寄送'],
    description:
      '在山间果园认领一季清甜。平安树 8 箱，单果约 250g；富贵树 15 箱，单果约 350g。专属铭牌、分次预约、可寄不同地址。本季有效，不自动续费。',
    image: SHOP_IMAGES.PA.src,
  },
  '/treat': {
    title: `${BRAND_NAME}苹果赞助｜${SPONSOR_MIN_HEADCOUNT}人起社区活动申请`,
    label: '社区活动苹果赞助',
    keywords: [BRAND_NAME, '苹果赞助', '社区活动赞助', '读书会赞助', '技术聚会赞助'],
    description: `${BRAND_NAME}由${site.publisher}运营，为至少${SPONSOR_MIN_HEADCOUNT}人的读书会、技术聚会及社区活动提供苹果赞助。查看申请条件、日期要求和返图授权规则。`,
    image: SCENE_IMAGES.COMMUNITY.src,
  },
  '/map': {
    title: `${BRAND_NAME}苹果足迹｜城市寄送与社区赞助`,
    label: '苹果足迹',
    keywords: [BRAND_NAME, '苹果足迹', '苹果寄送城市', '社区苹果赞助'],
    description:
      '记录苹果从山间果园出发的旅程，查看购买、认领与社区赞助的城市级汇总；不展示收件人姓名、电话或详细地址。',
  },
  '/guide': {
    title: `${BRAND_NAME}选购指南｜规格、产地、配送与售后`,
    label: '选购与配送指南',
    keywords: [BRAND_NAME, '苹果选购指南', '苹果规格', '苹果产地', '坏果赔付', '苹果树认领规则'],
    description: `一页看清${BRAND_NAME}家庭装与礼盒装区别、${ORIGIN_LABEL}产地、2026 秋收季时间、快递配送、偏远运费、坏果赔付及苹安树预约规则。`,
    image: SHOP_IMAGES.GIFT.src,
  },
};
for (const p of APPLE_PRODUCTS)
  PAGE_META['/apples/' + p.slug] = {
    title: `${BRAND_NAME}${p.name}苹果｜${p.count}个·单果约${p.weight}g`,
    description: `${p.description}来自${ORIGIN_LABEL}，查看当前价格、库存和配送规则。`,
    label: p.name,
    keywords: [
      BRAND_NAME,
      `${p.name}苹果`,
      `${p.count}个苹果`,
      `单果约${p.weight}g`,
      `${ORIGIN_LABEL}苹果`,
    ],
    image: p.image,
  };
if (!site.features.orchard) {
  for (const [path, label] of [
    ['/', '首页'],
    ['/buy', '选购商品'],
    ['/guide', '配送与售后'],
    ['/map', '配送足迹'],
  ])
    PAGE_META[path] = {
      title: BRAND_NAME + '｜' + label,
      description: site.storefront.description,
      keywords: [BRAND_NAME, '独立商城', '商品', '实物配送'],
      label,
      image: activeCatalog()[0]?.image,
    };
}
for (const p of activeCatalog())
  PAGE_META[productPath(p)] = {
    title: p.name + '｜' + BRAND_NAME,
    description: p.description,
    label: p.name,
    keywords: [BRAND_NAME, p.name, p.category],
    image: p.image,
  };
if (!site.features.orchard)
  for (const path of Object.keys(PAGE_META))
    if (!PUBLIC_PATHS.includes(path)) delete PAGE_META[path];
for (const meta of Object.values(PAGE_META)) {
  meta.title = publisherTitle(meta.title);
  meta.description = publisherDescription(meta.description);
  meta.keywords.push(PUBLISHER_TAGLINE);
}
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
      name: site.publisher,
      brand: { '@id': PUBLIC_ORIGIN + '/#brand' },
      url: PUBLIC_ORIGIN,
      logo: PUBLIC_ORIGIN + '/brand/icon.svg',
    },
    {
      '@type': 'Brand',
      '@id': PUBLIC_ORIGIN + '/#brand',
      name: BRAND_NAME,
      url: PUBLIC_ORIGIN,
      logo: PUBLIC_ORIGIN + '/brand/icon.svg',
      description: `${PUBLISHER_TAGLINE}，由 ${site.publisher} 经营的独立商店。`,
    },
    {
      '@type': 'Place',
      '@id': PUBLIC_ORIGIN + '/#orchard',
      name: BRAND_NAME + '发货地',
      description: ORIGIN_LABEL,
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'CN',
      },
    },
    {
      '@type': 'WebSite',
      '@id': PUBLIC_ORIGIN + '/#website',
      url: PUBLIC_ORIGIN,
      name: BRAND_NAME,
      alternateName: BRAND_NAME,
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
      about: [{ '@id': PUBLIC_ORIGIN + '/#brand' }, { '@id': PUBLIC_ORIGIN + '/#orchard' }],
    },
  ];
  if (path !== '/')
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': url + '#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: PUBLIC_ORIGIN + '/' },
        ...(path.startsWith('/apples/') || path.startsWith('/products/')
          ? [
              {
                '@type': 'ListItem',
                position: 2,
                name: site.features.orchard ? '买苹果' : '选购商品',
                item: canonicalUrl('/buy'),
              },
            ]
          : []),
        {
          '@type': 'ListItem',
          position: path.startsWith('/apples/') || path.startsWith('/products/') ? 3 : 2,
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
      { '@type': 'PropertyValue', name: '每箱数量', value: product.count, unitText: '个' },
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
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${enabled ? PUBLIC_PATHS.map((p) => `<url><loc>${canonicalUrl(p)}</loc><lastmod>${CONTENT_UPDATED}</lastmod></url>`).join('') : ''}</urlset>`;
}
export function llmsText(enabled: boolean) {
  if (enabled && !site.features.orchard)
    return (
      [
        '# ' + BRAND_NAME,
        site.storefront.description,
        PUBLISHER_TAGLINE,
        '发货地：' + ORIGIN_LABEL,
        '经营者：' +
          site.publisher +
          '。开源项目由得否科技与得否维护，X：https://x.com/wangdefou 。',
        '## 商品目录',
        ...activeCatalog().map(
          (p) =>
            `- ${p.name}（${p.sku}）：${p.specification}；¥${(p.price / 100).toFixed(2)}/${p.unit}。${p.description} ${PUBLIC_ORIGIN + productPath(p)}`,
        ),
        '## 配送与售后',
        site.storefront.shippingNote,
        site.storefront.afterSalesNote,
        '价格、库存与可售状态以下单时服务端校验为准。',
        ...PUBLIC_PATHS.map((p) => `- ${PAGE_META[p]?.label || p}：${PUBLIC_ORIGIN + p}`),
      ].join('\n\n') + '\n'
    );
  if (!enabled) return `# ${BRAND_NAME}\n\n本站暂未开放搜索索引。\n`;
  return (
    [
      `# ${BRAND_NAME}`,
      `> ${PUBLISHER_TAGLINE}。${BRAND_NAME}是由${site.publisher}运营的季节性苹果品牌，果园位于${ORIGIN_LABEL}。`,
      '## 品牌与商品事实',
      `- 品牌：${BRAND_NAME}；经营者：${site.publisher}；正式网站：${PUBLIC_ORIGIN}/。`,
      `- 产地：${ORIGIN_LABEL}。仅公开区域，不公开具体果园坐标、村庄或家庭住址。`,
      ...APPLE_PRODUCTS.map(
        (p) =>
          `- ${p.name}：每箱${p.count}个，单果约${p.weight}g，整箱约${p.totalKg}kg。详情：${canonicalUrl('/apples/' + p.slug)}。`,
      ),
      '- 苹安树认领：平安树本季8箱，每箱10斤，单果约250g；富贵树本季15箱，每箱6斤，单果约350g。认领箱型与零售箱型不同，本季有效，不自动续费。',
      `- 活动赞助：至少${SPONSOR_MIN_HEADCOUNT}人，人工审核；日期与返图授权要求见申请页。`,
      `- 本季销售时间：${SEASON_START}至${SEASON_END}。零售付款后48小时内发货，快递配送，偏远运费和售后见指南。`,
      '## 官方页面',
      PUBLIC_PATHS.map(
        (p) => `- [${PAGE_META[p].title}](${canonicalUrl(p)}): ${PAGE_META[p].description}`,
      ).join('\n'),
      '## 常见问题',
      APPLE_FAQS.map(([q, a]) => `### ${q}\n${a}`).join('\n\n'),
      '## 引用与更新',
      '价格、库存、可售状态和运费以对应页面实时显示为准。事实与规格以文字为准，果品和包装以实物为准。订单、后台、登录及媒体中的私人信息不属于公开资料。',
      `内容更新：${CONTENT_UPDATED}。`,
    ].join('\n\n') + '\n'
  );
}

export function catalogProductSchema(product: CatalogProduct) {
  return {
    '@type': 'Product',
    '@id': canonicalUrl(productPath(product)) + '#product',
    name: product.name,
    sku: product.sku,
    description: product.description,
    image: new URL(product.image, PUBLIC_ORIGIN).href,
    category: product.category,
    brand: { '@type': 'Brand', name: BRAND_NAME },
    additionalProperty: [{ '@type': 'PropertyValue', name: '规格', value: product.specification }],
    offers: {
      '@type': 'Offer',
      url: canonicalUrl(productPath(product)),
      priceCurrency: 'CNY',
      price: (product.price / 100).toFixed(2),
      seller: { '@id': PUBLIC_ORIGIN + '/#organization' },
    },
  };
}
