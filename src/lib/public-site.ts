// Small shared constants: browser analytics must not import the image / SEO graph.
// The named import keeps only this one section in browser code. The site URL is a deploy
// setting, not editable content.
import { brand } from '../../config/store.json';

export const PUBLIC_ORIGIN = brand.siteUrl;
// Every page that can be public. Module pages switched off in the site content answer 404;
// seo.ts publicPaths() gives the currently enabled list for the sitemap and llms.txt.
export const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/buy',
  '/tree',
  '/treat',
  '/map',
  '/guide',
  '/apples/family',
  '/apples/gift',
];
/** Which content switch each optional page belongs to. */
export const MODULE_PAGES: Record<string, 'adoption' | 'sponsorship' | 'footprintMap'> = {
  '/tree': 'adoption',
  '/tree/my': 'adoption',
  '/treat': 'sponsorship',
  '/map': 'footprintMap',
};

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
