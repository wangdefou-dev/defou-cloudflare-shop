import { SHOP_IMAGES } from './media';
import SNAPSHOT from './catalog-snapshot.json';
import { boxKg } from './shared';
import { STORE, fill, onStoreChange } from './store-config';

// Brand facts and copy come from the site content (config/store.json defaults, edited in the
// admin). These are live ES module bindings: refresh() reassigns them when content changes.
export { PUBLIC_ORIGIN } from './public-site';
export let CONTENT_UPDATED = STORE.season.contentUpdated;
export let BRAND_NAME = STORE.brand.name;
export let PUBLISHER_NAME = STORE.brand.publisher;
export let PUBLISHER_TAGLINE = STORE.brand.publisherTagline;
export let OWNER_X_URL = STORE.brand.contact.xUrl;
export let OWNER_WECHAT = STORE.brand.contact.wechat;
type QR = { src: string; width: number; height: number; alt?: string } | null;
export let WECHAT_QR = STORE.brand.contact.wechatQr as QR;
export let ORIGIN_LABEL = STORE.brand.originLabel;

// Product name / price / specs / copy. Pages render the live D1 rows (applyCatalog); the
// snapshot is only the fallback before the first D1 read, e.g. in browsers before hydration.
type Sku = 'FAMILY' | 'GIFT' | 'PA' | 'FG';
type CatalogRow = (typeof SNAPSHOT)['FAMILY'];
let catalog: Record<Sku, CatalogRow> = { ...SNAPSHOT };
const retail = (sku: 'FAMILY' | 'GIFT', slug: string) => {
  const p = catalog[sku];
  const photo = SHOP_IMAGES[sku];
  return {
    slug,
    sku,
    name: p.name,
    count: p.count_per_box,
    weight: p.unit_weight_g,
    totalKg: boxKg(p.count_per_box, p.unit_weight_g),
    image: p.image_url || photo.src,
    imageUrl: p.image_url,
    imageAlt: photo.alt,
    tagline: p.tagline,
    description: p.description,
  };
};
const prices = () => ({
  FAMILY: catalog.FAMILY.price,
  GIFT: catalog.GIFT.price,
  PA: catalog.PA.price,
  FG: catalog.FG.price,
});
const weights = () => ({
  FAMILY: catalog.FAMILY.unit_weight_g,
  GIFT: catalog.GIFT.unit_weight_g,
  PA: catalog.PA.unit_weight_g,
  FG: catalog.FG.unit_weight_g,
});
const products = () => [retail('FAMILY', 'family'), retail('GIFT', 'gift')] as const;
export let SEASON_PRICES = prices();
export let APPLE_UNIT_WEIGHTS = weights();
export let APPLE_PRODUCTS = products();
const faqList = () => {
  const vars = Object.fromEntries(
    APPLE_PRODUCTS.flatMap((p) =>
      Object.entries({ name: p.name, count: p.count, weight: p.weight, totalKg: p.totalKg }).map(
        ([k, v]) => [p.sku + '.' + k, v],
      ),
    ),
  );
  return STORE.faqs.map(([q, a]) => [fill(q, vars), fill(a, vars)] as const);
};
export let APPLE_FAQS = faqList();

function refresh() {
  CONTENT_UPDATED = STORE.season.contentUpdated;
  BRAND_NAME = STORE.brand.name;
  PUBLISHER_NAME = STORE.brand.publisher;
  PUBLISHER_TAGLINE = STORE.brand.publisherTagline;
  OWNER_X_URL = STORE.brand.contact.xUrl;
  OWNER_WECHAT = STORE.brand.contact.wechat;
  WECHAT_QR = STORE.brand.contact.wechatQr as QR;
  ORIGIN_LABEL = STORE.brand.originLabel;
  SEASON_PRICES = prices();
  APPLE_UNIT_WEIGHTS = weights();
  APPLE_PRODUCTS = products();
  APPLE_FAQS = faqList();
}
onStoreChange(refresh);
/** Live product rows from D1 (subset of columns). Unknown SKUs are ignored. */
export function applyCatalog(rows: Partial<CatalogRow & { sku: string }>[]) {
  const next = { ...catalog };
  for (const row of rows)
    if (row.sku && row.sku in next)
      next[row.sku as Sku] = { ...next[row.sku as Sku], ...row } as CatalogRow;
  catalog = next;
  refresh();
}
