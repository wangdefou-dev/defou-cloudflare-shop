import site from '../../config/site.json';
import configured from '../../config/products.json';
export type CatalogProduct = (typeof configured)[number];
const orchard: CatalogProduct[] = site.features.orchard
  ? [
      {
        sku: 'FAMILY',
        slug: 'family',
        name: '家庭装',
        category: '农产品',
        unit: '箱',
        price: site.prices.FAMILY,
        specification: '22 个 · 约 5.5kg',
        description: '果园示例家庭装，具体规格和售后以经营者确认为准。',
        image: '/images/demo/family.svg',
        active: true,
        maxPerOrder: 20,
      },
      {
        sku: 'GIFT',
        slug: 'gift',
        name: '礼盒装',
        category: '农产品',
        unit: '箱',
        price: site.prices.GIFT,
        specification: '8 个 · 约 2.8kg',
        description: '果园示例礼盒装，具体规格和售后以经营者确认为准。',
        image: '/images/demo/gift.svg',
        active: true,
        maxPerOrder: 20,
      },
    ]
  : [];
export const CATALOG: CatalogProduct[] = [...configured, ...orchard];
export const activeCatalog = () => CATALOG.filter((p) => p.active);
export const catalogProduct = (sku: string) => CATALOG.find((p) => p.sku === sku);
export const productPath = (product: CatalogProduct) => '/products/' + product.slug;
