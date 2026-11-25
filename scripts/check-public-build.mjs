// Build-artifact checks. Pages render per request now (site content is editable in the admin),
// so page HTML is checked against a running server with `npm run verify:pages`.
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = new URL('../dist/client/', import.meta.url);
const config = JSON.parse(
  await readFile(new URL('../dist/server/wrangler.json', import.meta.url), 'utf8'),
);
assert.equal(
  config.assets.run_worker_first,
  true,
  'Offline/access checks must run before static assets',
);
// No page HTML may ship as a static asset: every page goes through the worker.
for (const path of ['index.html', 'buy/index.html', 'admin/index.html', 'order/index.html'])
  await assert.rejects(stat(new URL(path, root)), { code: 'ENOENT' }, path + ' was prebuilt');
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
await stat(new URL('images/maps/licenses.txt', root));
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
await writeFile(new URL('build-metrics.json', out), JSON.stringify({ bundles }, null, 2));
const largest = bundles.reduce((a, b) => (b.gzipBytes > a.gzipBytes ? b : a));
console.log(
  `Verified build: Preact runtime ${runtime.bytes} B; largest bundle ${largest.file} ${largest.gzipBytes} B gzip.`,
);
