/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
interface DefouBindings {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  SITE_OFFLINE?: string;
  DEMO_MODE?: string;
  SALES_OPEN?: string;
  SANDBOX_CHECKOUT?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_REFUND_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_MODE?: string;
  STRIPE_PAYMENT_METHOD_CONFIGURATION?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAIL?: string;
  OPS_WEBHOOK_URL?: string;
  NOTIFICATIONS_ENABLED?: string;
  NOTIFICATION_DAILY_HOUR?: string;
  NOTIFICATION_DAILY_MINUTE?: string;
  NOTIFICATION_START_DATE?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  MEDIA_BASE_URL?: string;
  HERO_VIDEO_URL?: string;
  CONTACT_WECHAT?: string;
  OFFICIAL_QR_URL?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  BING_SITE_VERIFICATION?: string;
  GOOGLE_ANALYTICS_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  TRACKING_ENABLED?: string;
  KUAIDI100_CUSTOMER?: string;
  KUAIDI100_KEY?: string;
}

interface Env extends DefouBindings {}
declare namespace Cloudflare {
  interface Env extends DefouBindings {}
}
