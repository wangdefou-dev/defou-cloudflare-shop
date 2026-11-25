import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fill, feature } from '../src/lib/store-config';
import { disabledModule } from '../src/lib/api';
import { PUBLIC_PATHS } from '../src/lib/public-site';

const check = (file: string) =>
  execFileSync('npx', ['tsx', 'scripts/check-config.ts', file], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

test('fill replaces known tokens and keeps unknown ones visible', () => {
  assert.equal(fill('{brand}·{name}·{nope}', { name: '礼盒装' }), '太行深处·礼盒装·{nope}');
});

test('the default config and the tea example both pass the config check', () => {
  assert.match(check('config/store.json'), /格式正确/);
  assert.match(check('config/examples/tea.json'), /adoption=关/);
});

test('the config check names missing keys, wrong types and missing images', () => {
  const config = JSON.parse(readFileSync('config/store.json', 'utf8'));
  delete config.brand.slogan;
  config.features.adoption = 'yes';
  config.images.FAMILY = { src: '/images/not-there.jpg', width: 10, height: 10 };
  const file = join(mkdtempSync(join(tmpdir(), 'store-')), 'store.json');
  writeFileSync(file, JSON.stringify(config));
  assert.throws(
    () => check(file),
    (e: any) =>
      /features\.adoption：应为 boolean/.test(e.stderr) &&
      /找不到 public\/images\/not-there\.jpg/.test(e.stderr),
  );
});

test('enabled modules keep their pages and APIs', () => {
  for (const name of ['adoption', 'sponsorship', 'footprintMap', 'diary'] as const)
    assert.equal(feature(name), true);
  assert.ok(PUBLIC_PATHS.includes('/tree') && PUBLIC_PATHS.includes('/map'));
  for (const path of ['/api/tree/login', '/api/treat/apply', '/api/wall', '/api/map', '/api/diary'])
    assert.equal(disabledModule(path), null);
});
