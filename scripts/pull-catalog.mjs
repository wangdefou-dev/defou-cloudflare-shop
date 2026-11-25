// Copies product name / price / specs / copy / image from D1 into src/lib/catalog-snapshot.json,
// so prebuilt pages, SEO titles and JSON-LD match what the admin saved.
//   npm run catalog:pull            # production D1 (read-only query)
//   npm run catalog:pull -- --local # local dev D1
// Commit the updated JSON, then build and deploy as usual.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const local = process.argv.includes('--local');
const file = new URL('../src/lib/catalog-snapshot.json', import.meta.url);
const fields = [
  'name',
  'price',
  'unit_weight_g',
  'count_per_box',
  'tagline',
  'description',
  'image_url',
];
const out = execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'DB',
    local ? '--local' : '--remote',
    '--json',
    ...(local ? [] : ['--env', 'production']),
    '--command',
    `SELECT id,${fields.join(',')} FROM products WHERE id IN ('FAMILY','GIFT','PA','FG')`,
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const rows = JSON.parse(out)[0]?.results || [];
const previous = JSON.parse(readFileSync(file, 'utf8'));
if (rows.length !== 4) throw new Error('Expected 4 products, got ' + rows.length);
const next = {};
for (const sku of ['FAMILY', 'GIFT', 'PA', 'FG']) {
  const row = rows.find((r) => r.id === sku);
  next[sku] = Object.fromEntries(
    fields.map((k) => [k, row[k] ?? (k === 'image_url' ? null : previous[sku][k])]),
  );
}
writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
for (const sku of Object.keys(next))
  for (const k of fields)
    if (JSON.stringify(previous[sku][k]) !== JSON.stringify(next[sku][k]))
      console.log(
        `${sku}.${k}: ${JSON.stringify(previous[sku][k])} → ${JSON.stringify(next[sku][k])}`,
      );
console.log('catalog snapshot updated');
