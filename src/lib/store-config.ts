// Site content: copy, images, words and module switches.
// config/store.json holds the defaults. The admin "网站内容" editor saves an edited copy in D1;
// the worker loads it per request (cached briefly) and calls applyStoreContent(), so pages
// render the latest content without a rebuild. Browsers receive the same sections through
// window.__STORE__, injected by the layout, so hydrated islands match the server HTML.
import DEFAULTS from '../../config/store.json';

export type StoreConfig = typeof DEFAULTS;
export type Feature = keyof StoreConfig['features'];
type ImagePath = { src: string; width: number; height: number; alt?: string } | null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const DEFAULT_STORE: StoreConfig = clone(DEFAULTS);

/** The live content. Sections are replaced in place so every importer sees updates. */
export const STORE: StoreConfig = clone(DEFAULTS);
const listeners: (() => void)[] = [];
/** Modules that derive constants from the content recompute them here. */
export function onStoreChange(listener: () => void) {
  listeners.push(listener);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** Saved content over the defaults: keys added to the defaults later still get a value. */
export function mergeStore(base: unknown, saved: unknown): any {
  if (!isObject(base) || !isObject(saved)) return saved === undefined ? clone(base) : saved;
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(saved)]))
    out[key] = key in saved ? mergeStore(base[key], saved[key]) : clone(base[key]);
  return out;
}

let appliedVersion = -1;
export function applyStoreContent(saved: unknown, version = 0) {
  const next = mergeStore(DEFAULT_STORE, saved || {}) as StoreConfig;
  for (const key of Object.keys(DEFAULT_STORE) as (keyof StoreConfig)[])
    (STORE as any)[key] = next[key];
  appliedVersion = version;
  for (const listener of listeners) listener();
}
export const storeVersion = () => appliedVersion;

/** The sections browser islands need (everything except home copy, FAQ and SEO). */
export const clientStore = () => ({
  brand: STORE.brand,
  season: STORE.season,
  features: STORE.features,
  words: STORE.words,
  pages: STORE.pages,
  images: STORE.images,
  rules: STORE.rules,
  map: STORE.map,
});
declare global {
  interface Window {
    __STORE__?: Partial<StoreConfig>;
  }
}
if (typeof window !== 'undefined' && window.__STORE__) applyStoreContent(window.__STORE__, 0);

/** Optional modules. Off removes the pages, nav links, home sections, APIs and admin tabs. */
export const feature = (name: Feature) => STORE.features[name] === true;

/** Replaces {key} tokens, e.g. "{brand}的果园位于{origin}". Unknown tokens stay visible. */
export function fill(template: string, vars: Record<string, string | number> = {}) {
  const all: Record<string, string | number> = {
    brand: STORE.brand.name,
    publisher: STORE.brand.publisher,
    tagline: STORE.brand.publisherTagline,
    origin: STORE.brand.originLabel,
    seasonStart: STORE.season.start,
    seasonEnd: STORE.season.end,
    ...vars,
  };
  return template.replace(/\{([\w.]+)\}/g, (m, key: string) => (key in all ? String(all[key]) : m));
}

/** A replacement photo set in the content, or null for the built-in one. */
export const configuredImage = (key: keyof StoreConfig['images']) =>
  (STORE.images as Record<string, ImagePath>)[key] ?? null;
