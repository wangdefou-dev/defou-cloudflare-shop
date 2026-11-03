import { PUBLIC_ORIGIN, PUBLIC_PATHS, PUBLIC_SKUS } from './public-site';

export const ANALYTICS_CHOICE_KEY = 'orchard.analytics.v1';
export const ANALYTICS_CHOICE_TTL = 90 * 24 * 60 * 60 * 1000;
export type AnalyticsChoice = 'granted' | 'denied';

export function readAnalyticsChoice(raw: string | null, now = Date.now()): AnalyticsChoice | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value &&
      ['granted', 'denied'].includes(value.choice) &&
      typeof value.at === 'number' &&
      value.at <= now &&
      now - value.at < ANALYTICS_CHOICE_TTL
      ? value.choice
      : null;
  } catch {
    return null;
  }
}

export function analyticsPage(raw: string) {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (url.origin !== PUBLIC_ORIGIN || !PUBLIC_PATHS.includes(path)) return null;
    // Only known product selectors can accompany a measured page. Never pass tokens or free text.
    if ([...url.searchParams].some(([key, value]) => key !== 'sku' || !PUBLIC_SKUS.includes(value)))
      return null;
    if (url.hash && !/^#[a-z-]+$/.test(url.hash)) return null;
    return { location: PUBLIC_ORIGIN + path, path, cloudflare: !url.search && !url.hash };
  } catch {
    return null;
  }
}

export function analyticsReferrer(raw: string) {
  if (!raw) return { origin: '', cloudflare: true };
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return { origin: '', cloudflare: false };
    // Cloudflare reads document.referrer directly; skip its beacon for any non-origin referrer.
    return {
      origin: url.origin + '/',
      cloudflare: url.pathname === '/' && !url.search && !url.hash,
    };
  } catch {
    return { origin: '', cloudflare: false };
  }
}

export const validGoogleId = (value = '') => (/^G-[A-Z0-9]+$/.test(value) ? value : '');
export const validCloudflareToken = (value = '') => (/^[a-f0-9]{32}$/.test(value) ? value : '');
