// Loads the admin-edited site content and live product rows into the shared modules.
// Each isolate keeps them for a few seconds, so an edit shows up everywhere within that time.
import { applyStoreContent, storeVersion } from './store-config';
import { applyCatalog } from './content';
import { refreshPageMeta } from './seo';

const TTL_MS = 10_000;
let cache: { at: number; db: unknown } = { at: 0, db: null };

export async function loadSiteContent(env: Pick<Env, 'DB'>, force = false) {
  if (!force && cache.db === env.DB && Date.now() - cache.at < TTL_MS) return;
  const [row, products] = await Promise.all([
    env.DB.prepare('SELECT data,version FROM site_content WHERE id=1').first<{
      data: string;
      version: number;
    }>(),
    env.DB.prepare(
      'SELECT sku,name,price,unit_weight_g,count_per_box,tagline,description,image_url FROM products',
    ).all(),
  ]);
  applyStoreContent(row ? JSON.parse(row.data) : {}, row?.version ?? 0);
  applyCatalog((products.results || []) as any[]);
  refreshPageMeta();
  cache = { at: Date.now(), db: env.DB };
}
/** Forget the cached copy, e.g. right after a save in this isolate. */
export const invalidateSiteContent = () => {
  cache = { at: 0, db: null };
};
export { storeVersion };
