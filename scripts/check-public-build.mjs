import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import site from '../config/site.json' with { type: 'json' };
import { PUBLIC_PATHS } from '../src/lib/public-site.ts';

const root = new URL('../dist/client/', import.meta.url);
const config = JSON.parse(
  await readFile(new URL('../dist/server/wrangler.json', import.meta.url), 'utf8'),
);
assert.equal(
  config.assets.run_worker_first,
  true,
  'Offline/access checks must run before static assets',
);
const rows = [];
for (const path of [...PUBLIC_PATHS, '/privacy']) {
  const file = (path === '/' ? '' : path.slice(1) + '/') + 'index.html';
  const html = await readFile(new URL(file, root), 'utf8');
  const inlineCSS = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].reduce(
    (n, m) => n + Buffer.byteLength(m[1]),
    0,
  );
  assert(inlineCSS < 1024, `${path}: large inline stylesheet returned`);
  assert(html.includes('rel="stylesheet"'), `${path}: missing external CSS`);
  assert(html.includes(site.publisher + '出品'), `${path}: publisher missing`);
  assert(!/href="\/admin(?:[\/?#"])/.test(html), `${path}: admin entry exposed in public HTML`);
  if (path !== '/privacy')
    assert(
      html.includes('content="index,follow,max-image-preview:large"'),
      `${path}: production indexing disabled`,
    );
  // Public HTML must never contain production credentials.
  assert(
    !/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{15,}/.test(html),
    `${path}: credential detected`,
  );
  for (const match of html.matchAll(
    /(?:href|src|component-url|renderer-url)="(\/_astro\/[^"?]+)"/g,
  ))
    await stat(new URL(match[1].slice(1), root));
  rows.push({
    path,
    htmlBytes: Buffer.byteLength(html),
    gzipBytes: gzipSync(html).length,
    inlineStyleBytes: inlineCSS,
  });
}
for (const path of ['admin', 'order', 'pay/result', 'tree/my']) {
  await assert.rejects(stat(new URL(path + '/index.html', root)), { code: 'ENOENT' });
}
const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
const mapBase = JSON.parse(
  await readFile(new URL('../src/lib/map-base.json', import.meta.url), 'utf8'),
);
const mapHTML = await readFile(new URL('map/index.html', root), 'utf8');
assert(
  mapBase.kind === 'vector' &&
    mapHTML.includes(mapBase.source_url) &&
    mapHTML.includes(mapBase.source_label),
  'Map source or credit missing',
);
const mapGeometry = await readFile(new URL('../src/lib/map-provinces.json', import.meta.url));
const mapSource = JSON.parse(
  await readFile(new URL('../assets/maps/vector-source.json', import.meta.url), 'utf8'),
);
assert.equal(
  createHash('sha256').update(mapGeometry).digest('hex'),
  mapSource.generated_sha256,
  'Generated map geometry drifted from verified source',
);
assert(mapGeometry.length < 80000, 'Province data exceeded lightweight map budget');
assert.equal(JSON.parse(mapGeometry).provinces.length, 34);
assert.equal((mapHTML.match(/class="footprint-province(?:\s|")/g) || []).length, 34);
assert(!/china-(?:admin-)?gs\d{4}-.*\.jpg/.test(mapHTML), 'Raster map returned to current page');
assert(mapHTML.includes('南海诸岛'), 'Sea inset label missing');
await stat(new URL('images/maps/licenses.txt', root));
assert.equal((sitemap.match(/<loc>/g) || []).length, PUBLIC_PATHS.length);
for (const file of ['sitemap.xml', 'llms.txt']) {
  const body = await readFile(new URL(file, root), 'utf8');
  assert(
    !/https:\/\/shop\.example\.com\/(?:admin|api|tree\/my|order|pay)(?:[\s\/<#?]|$)/.test(body),
    `${file}: private URL exposed`,
  );
}
assert((await readFile(new URL('robots.txt', root), 'utf8')).includes('Disallow: /admin'));
const bundles = [];
for (const file of await readdir(new URL('_astro/', root))) {
  if (!/\.(js|css)$/.test(file)) continue;
  const bytes = await readFile(new URL('_astro/' + file, root));
  if (file.endsWith('.js'))
    assert(
      !/react-dom-client\.production/.test(bytes.toString()) &&
        !/^(?:react-runtime|echarts|zrender)\./.test(file),
      'Unused heavy browser runtime returned',
    );
  bundles.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}
const runtime = bundles.find((b) => b.file.startsWith('preact-runtime.'));
assert(runtime && runtime.bytes < 30000, 'Lightweight runtime missing or too large');
const out = new URL('../outputs/static-performance/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(
  new URL('build-metrics.json', out),
  JSON.stringify({ pages: rows, bundles }, null, 2),
);
console.log(
  `Verified ${rows.length} static HTML pages; homepage ${rows[0].htmlBytes} B, inline CSS ${rows[0].inlineStyleBytes} B; Preact runtime ${runtime.bytes} B.`,
);
