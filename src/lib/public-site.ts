import products from '../../config/products.json' with { type: 'json' };
import site from '../../config/site.json' with { type: 'json' };
// Small shared constants: browser analytics must not import the image / SEO graph.
export const PUBLIC_ORIGIN = site.url;
const productPages = [
  ...products.filter((p) => p.active).map((p) => '/products/' + p.slug),
  ...(site.features.orchard ? ['/products/family', '/products/gift'] : []),
];
export const PUBLIC_SKUS: readonly string[] = [
  ...products.filter((p) => p.active).map((p) => p.sku),
  'FAMILY',
  'GIFT',
  'PA',
  'FG',
];
export const PUBLIC_PATHS: readonly string[] = site.features.orchard
  ? [
      '/',
      '/buy',
      '/tree',
      '/treat',
      '/map',
      '/guide',
      '/apples/family',
      '/apples/gift',
      ...productPages,
    ]
  : ['/', '/buy', '/map', '/guide', ...productPages];

type SearchEnv = Pick<Env, 'APP_ORIGIN' | 'SITE_OFFLINE' | 'DEMO_MODE' | 'SANDBOX_CHECKOUT'>;
export function publicSearchEnabled(env: SearchEnv, url: URL) {
  return (
    url.origin === PUBLIC_ORIGIN &&
    env.APP_ORIGIN === PUBLIC_ORIGIN &&
    env.SITE_OFFLINE === 'false' &&
    env.DEMO_MODE !== 'true' &&
    env.SANDBOX_CHECKOUT !== 'true'
  );
}
