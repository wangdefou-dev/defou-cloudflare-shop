import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// STORE_CONFIG=config/examples/xxx.json swaps the whole store config for a local preview.
const storeConfig = process.env.STORE_CONFIG ? resolve(process.env.STORE_CONFIG) : null;
const store = JSON.parse(readFileSync(storeConfig || 'config/store.json', 'utf8'));

export default defineConfig({
  site: store.brand.siteUrl,
  output: 'server',
  build: { inlineStylesheets: 'never' },
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [preact({ compat: true })],
  vite: {
    resolve: {
      alias: storeConfig
        ? [{ find: /^(?:\.\.\/)+config\/store\.json$/, replacement: storeConfig }]
        : [],
    },
    // Keep small shopping dependencies together without pulling public analytics
    // into the UI runtime. These groups apply only to browser output.
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  { name: 'preact-runtime', test: /node_modules\/preact\// },
                  {
                    name: 'shop-shared',
                    test: /src\/(?:components\/(?:ui|ProductPhoto|ResponsivePhoto|CouponField|PaymentOptions)\.tsx|lib\/(?:shared|media|image-assets|payment-experience)\.)/,
                  },
                ],
              },
            },
          },
        },
      },
    },
    ssr: {
      noExternal: [
        'lucide-react',
        'react',
        'react-dom',
        'react-dom/test-utils',
        'react/jsx-runtime',
      ],
    },
  },
  session: false,
  devToolbar: { enabled: false },
});
