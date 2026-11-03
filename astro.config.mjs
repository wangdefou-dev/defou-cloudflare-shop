import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import site from './config/site.json' with { type: 'json' };
import preact from '@astrojs/preact';

export default defineConfig({
  site: site.url,
  output: 'server',
  build: { inlineStylesheets: 'never' },
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [preact({ compat: true })],
  vite: {
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
