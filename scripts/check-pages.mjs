// Checks rendered public pages on a running server:
//   npm run verify:pages                         # local preview, http://127.0.0.1:4321
//   npm run verify:pages -- https://你的域名 --production
// --production also requires indexable robots tags (only the formal host is indexable).
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4321').replace(/\/$/, '');
const production = args.includes('--production');
const get = async (path) => {
  const r = await fetch(base + path, { redirect: 'manual' });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const sitemap = await get('/sitemap.xml');
const robots = await get('/robots.txt');
assert(robots.text.includes(production ? 'Disallow: /admin' : 'Disallow: /'), 'robots.txt rules');
const fromSitemap = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
  new URL(m[1]).pathname.replace(/(.)\/$/, '$1'),
);
const pages =
  production && fromSitemap.length
    ? fromSitemap
    : ['/', '/buy', '/guide', '/apples/family', '/apples/gift'];
const rows = [];
for (const path of [...new Set([...pages, '/privacy'])]) {
  const { status, headers, text: html } = await get(path);
  assert.equal(status, 200, `${path}: HTTP ${status}`);
  const inlineCSS = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].reduce(
    (n, m) => n + Buffer.byteLength(m[1]),
    0,
  );
  assert(inlineCSS < 1024, `${path}: large inline stylesheet returned`);
  assert(html.includes('rel="stylesheet"'), `${path}: missing external CSS`);
  assert(!/href="\/admin(?:[/?#"])/.test(html), `${path}: admin entry exposed in public HTML`);
  assert(
    !/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{15,}/.test(html),
    `${path}: credential detected`,
  );
  assert(!/private|no-store/.test(headers.get('cache-control') || ''), `${path}: private cache`);
  if (production && path !== '/privacy')
    assert(
      html.includes('content="index,follow,max-image-preview:large"'),
      `${path}: production indexing disabled`,
    );
  rows.push(`${path} ${Buffer.byteLength(html)} B`);
}
for (const path of ['/admin', '/order', '/api/admin/data'])
  assert(
    /private|no-store/.test((await get(path)).headers.get('cache-control') || ''),
    `${path}: must stay private`,
  );
const unknown = await get('/?utm_source=x');
assert(/noindex/.test(unknown.headers.get('x-robots-tag') || ''), 'unknown query must be noindex');
console.log(`Verified ${rows.length} rendered pages at ${base}: ${rows.join('; ')}`);
