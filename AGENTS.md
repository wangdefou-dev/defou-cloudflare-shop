# Project conventions

- This is an independent Cloudflare Workers application, using Astro + Preact, D1, KV and R2.
- Read README.md and docs/配置.md before changing setup, deployment or catalog behavior.
- Run npm run config:check, npm run check, npm test, npm run build:production and npm run scan:public for relevant changes. Do not run build and dev concurrently.
- Never commit credentials, .dev.vars, .secrets*.json, customer exports, private uploads, coupon plaintext, or local databases. The example files must remain empty of credentials.
- Local demo authentication and simulated payments must remain limited to loopback hosts. Production Access JWT verification, admin-email matching, Turnstile, signed Stripe webhooks, stock consistency and refund ownership checks must remain in place.
- Database changes use new numbered migrations. Keep inventory at zero in remote seed data; scripts/demo-stock.sql is local only.
- config/site.json owns the public identity, season, project identifier, static prices and shipping defaults. npm run config:sync updates generated SQL and public Wrangler values; it must never call remote services.
- Prices are integer CNY cents. Paid orders and adoption entitlements are historical snapshots. Never reset inventory or rewrite paid orders during config updates.
- Preserve third-party credits and licenses. Public screenshots and examples may contain only synthetic data.
- GitHub Actions validates builds and tests without production credentials and does not deploy.
