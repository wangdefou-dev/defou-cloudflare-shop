# Contributing

Use Node.js 24. Run `npm ci` and `npm run setup` for a local-only environment.

Before opening a pull request, run:

```bash
npm run config:check
npm run check
npm test
npm run build:production
npm run scan:public
```

Use synthetic data in tests, screenshots and bug reports. Never include credentials or customer data. Database changes need a new numbered migration. Keep the default setup usable without cloud accounts and remote inventory at zero. Preserve source credits for third-party data.

For security reports, follow [SECURITY.md](SECURITY.md).
