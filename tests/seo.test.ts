import catalog from '../config/products.json';
import { SEASON_END } from '../src/lib/shared';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLE_PRODUCTS,
  BRAND_NAME,
  ORIGIN_LABEL,
  PUBLISHER_TAGLINE,
  PUBLIC_ORIGIN,
} from '../src/lib/content';
import {
  canonicalUrl,
  publicSearchEnabled,
  robotsText,
  sitemapXml,
  productSchema,
  serializeJsonLd,
  PUBLIC_PATHS,
  PAGE_META,
  websiteGraph,
  llmsText,
  publisherTitle,
  publisherDescription,
} from '../src/lib/seo';

test('search indexing requires the formal host and explicit reopening; previews stay blocked', () => {
  const env = { APP_ORIGIN: PUBLIC_ORIGIN, SITE_OFFLINE: 'false' };
  assert.equal(publicSearchEnabled(env, new URL(PUBLIC_ORIGIN)), true);
  for (const value of ['true', undefined])
    assert.equal(
      publicSearchEnabled({ ...env, SITE_OFFLINE: value }, new URL(PUBLIC_ORIGIN)),
      false,
    );
  assert.equal(publicSearchEnabled({ ...env, DEMO_MODE: 'true' }, new URL(PUBLIC_ORIGIN)), false);
  assert.equal(
    publicSearchEnabled({ ...env, SANDBOX_CHECKOUT: 'true' }, new URL(PUBLIC_ORIGIN)),
    false,
  );
  for (const host of [
    'http://127.0.0.1:4321',
    'https://orchard-shop-sandbox.example.workers.dev',
    'https://other.example',
  ])
    assert.equal(publicSearchEnabled({ ...env, APP_ORIGIN: host }, new URL(host)), false);
});

test('canonical links cannot inherit personal query parameters or a preview host', () => {
  assert.equal(
    canonicalUrl('/buy/?phone=13800000000&view_token=private#result'),
    PUBLIC_ORIGIN + '/buy',
  );
  assert.equal(
    canonicalUrl('https://other.example/apples/gift?token=private'),
    PUBLIC_ORIGIN + '/apples/gift',
  );
  assert.equal(canonicalUrl('/?phone=13800000000'), PUBLIC_ORIGIN + '/');
});

test('sitemaps whitelist public content, preview maps are empty, crawler rules exclude private paths', () => {
  const sitemap = sitemapXml(true);
  assert.equal((sitemap.match(/<loc>/g) || []).length, PUBLIC_PATHS.length);
  assert(sitemap.includes(PUBLIC_ORIGIN + '/products/' + catalog[0].slug));
  assert(!sitemap.includes('/apples/'));
  assert(!/\/api\/|\/admin|\/tree\/my|\/order|\/pay\/|\/media\//.test(sitemap));
  assert(!sitemapXml(false).includes('<loc>'));
  assert.equal(robotsText(false), 'User-agent: *\nDisallow: /\n');
  const robots = robotsText(true);
  const searchBot = robots.split('User-agent: OAI-SearchBot\n')[1].split('\n\n')[0];
  assert(searchBot.includes('Allow: /'));
  for (const path of ['/api/', '/admin', '/tree/my', '/order', '/pay/', '/media/'])
    assert(searchBot.includes('Disallow: ' + path));
  assert(robots.includes('User-agent: GPTBot\nDisallow: /'));
});

test('product metadata uses actual DB prices and never claims availability from demo or closed sales', () => {
  const product = APPLE_PRODUCTS[0];
  const stock = { price: 12300, stock: 3, active: 1 };
  const season = new Date('2026-11-02T08:00:00+08:00');
  const closed = productSchema(product, stock, { SALES_OPEN: 'false' }, season);
  assert.equal(closed.offers?.price, '123.00');
  assert.equal(closed.offers?.availability, 'https://schema.org/OutOfStock');
  assert.equal(
    productSchema(product, stock, { SALES_OPEN: 'true' }, season).offers?.availability,
    'https://schema.org/InStock',
  );
  assert.equal(
    productSchema(product, { ...stock, stock: 0 }, { SALES_OPEN: 'true' }, season).offers
      ?.availability,
    'https://schema.org/OutOfStock',
  );
  assert.equal(
    productSchema(product, stock, { SALES_OPEN: 'true' }, new Date('2026-10-21T23:59:59+08:00'))
      .offers?.availability,
    'https://schema.org/OutOfStock',
  );
  assert.equal(
    productSchema(
      product,
      stock,
      { SALES_OPEN: 'true' },
      new Date(Date.parse(SEASON_END + 'T00:00:00+08:00') + 2 * 86400000),
    ).offers,
    undefined,
  );
  assert.equal(productSchema(product, null, { SALES_OPEN: 'true' }, season).offers, undefined);
  assert(!('aggregateRating' in closed));
  assert(!('geo' in closed));
});

test('JSON-LD serialization cannot break out of its script element', () => {
  const source = { text: '</script><script>alert(1)</script> & \u2028\u2029' };
  const encoded = serializeJsonLd(source);
  assert(!encoded.includes('<'));
  assert.deepEqual(JSON.parse(encoded), source);
});

test('all public TDK and custom titles carry the current brand and publisher exactly once', () => {
  assert.equal(new Set(Object.values(PAGE_META).map((p) => p.title)).size, PUBLIC_PATHS.length);
  for (const meta of Object.values(PAGE_META)) {
    assert(meta.title.includes(BRAND_NAME));
    for (const text of [meta.title, meta.description, meta.keywords.join(',')]) {
      assert.equal(text.split(PUBLISHER_TAGLINE).length - 1, 1);
      assert(!text.includes('旧品牌'));
    }
    assert.equal(publisherTitle(meta.title), meta.title);
    assert.equal(publisherDescription(meta.description), meta.description);
  }
  assert(publisherTitle('示例果园家庭装｜¥108').endsWith(PUBLISHER_TAGLINE));
});

test('search graph links the brand, publisher and broad origin; product breadcrumbs match navigation', () => {
  const graph = websiteGraph(
    '/products/' + catalog[0].slug,
    PAGE_META['/products/' + catalog[0].slug].title,
    PAGE_META['/products/' + catalog[0].slug].description,
  );
  const brand = graph.find((node) => node['@type'] === 'Brand')!;
  const organization = graph.find((node) => node['@type'] === 'Organization')!;
  const site = graph.find((node) => node['@type'] === 'WebSite')!;
  assert.equal(brand.name, BRAND_NAME);
  assert.equal(organization.name, '示例运营者');
  assert.deepEqual(organization.brand, { '@id': brand['@id'] });
  assert.equal(site.name, BRAND_NAME);
  const place = graph.find((node) => node['@type'] === 'Place')!;
  assert.equal(place.description, ORIGIN_LABEL);
  assert(!('geo' in place));
  assert(!('streetAddress' in (place.address as object)));
  const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList')!.itemListElement as any[];
  assert.deepEqual(
    crumbs.map((c) => [c.position, c.name]),
    [
      [1, '首页'],
      [2, '选购商品'],
      [3, catalog[0].name],
    ],
  );
  assert.equal(crumbs[1].item, PUBLIC_ORIGIN + '/buy');
});

test('machine-readable facts stay public and accurate; QR and private routes remain excluded from crawling', () => {
  const facts = llmsText(true);
  for (const value of [
    BRAND_NAME,
    PUBLISHER_TAGLINE,
    ORIGIN_LABEL,
    catalog[0].name,
    catalog[0].specification,
    '得否科技',
    'https://x.com/wangdefou',
  ])
    assert(facts.includes(value));
  assert(!facts.includes('your_wechat_id'));
  assert(!facts.includes('view_token'));
  assert(!llmsText(false).includes(ORIGIN_LABEL));
  for (const block of robotsText(true)
    .split('User-agent: ')
    .filter((s) => s.startsWith('*') || s.startsWith('OAI-SearchBot'))) {
    assert(block.includes('Disallow: /images/optimized/wechat-qr-'));
    assert(block.includes('Disallow: /admin'));
    assert(block.includes('Disallow: /order'));
  }
});

test('static product offers keep the approved season price without baking in inventory', () => {
  const offer = productSchema(
    APPLE_PRODUCTS[0],
    { price: 10800 },
    {},
    new Date('2026-10-22T12:00:00+08:00'),
  ).offers!;
  assert.equal(offer.price, '108.00');
  assert.equal(offer.priceValidUntil, SEASON_END);
  assert.equal('availability' in offer, false);
});
