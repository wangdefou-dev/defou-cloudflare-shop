import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  MAP_BASE,
  MAP_PROVINCES,
  MAP_DECORATIONS,
  MAP_ORIGIN,
  cityCode,
  cityPoint,
  cityQuantity,
  footprintSummary,
  mapClipPath,
  projectCityPoint,
  routePath,
  type MapSnapshot,
} from '../src/lib/map-geometry';
import { bundledAsset } from '../src/lib/static-assets';

function assertPath(path: string, label: string) {
  assert.equal(typeof path, 'string', label);
  assert.match(path, /^\s*[Mm]/, label);
  assert.match(path, /^[MmZzLlHhVvCcSsQqTtAa0-9.,eE+\-\s]+$/, label);
  assert(!/NaN|Infinity|undefined|null/i.test(path), label);
  const numbers = path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  assert(numbers.length >= 4, label);
  assert(
    numbers.every((value) => Number.isFinite(Number(value))),
    label,
  );
}

test('the bundled vector data matches its recorded source and output fingerprints and stays under the geometry size budget', () => {
  const audit = JSON.parse(readFileSync('assets/maps/vector-source.json', 'utf8'));
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(hash('assets/maps/china-provinces-amcharts.svg'), audit.province_source_sha256);
  assert.equal(hash('assets/maps/nanhai-echarts-6.0.0.ts.txt'), audit.inset_source_sha256);
  assert.equal(hash('src/lib/map-provinces.json'), audit.generated_sha256);
  assert.equal(audit.province_count, MAP_PROVINCES.length);
  assert.equal(audit.decoration_count, MAP_DECORATIONS.length);
  assert(readFileSync('src/lib/map-provinces.json').byteLength < 80 * 1024);
});

test('the data-drawn basemap contains all 34 distinct province-level regions and finite SVG geometry with source and license credits', () => {
  assert(Number.isFinite(MAP_BASE.width) && MAP_BASE.width > 0);
  assert(Number.isFinite(MAP_BASE.height) && MAP_BASE.height > 0);
  assert.equal(typeof MAP_BASE.source_label, 'string');
  assert(MAP_BASE.source_label.trim().length > 0);
  assert.match(MAP_BASE.source_url, /^https?:\/\//);
  assert.equal(typeof MAP_BASE.license_url, 'string');
  assert(MAP_BASE.license_url.trim().length > 0);
  const license = new URL(MAP_BASE.license_url, 'https://shop.example.com');
  assert(['http:', 'https:'].includes(license.protocol));
  assert(!('src' in MAP_BASE));
  assert(!('review' in MAP_BASE));
  assert(!('sha256' in MAP_BASE));
  const expected = [
    '110000',
    '120000',
    '130000',
    '140000',
    '150000',
    '210000',
    '220000',
    '230000',
    '310000',
    '320000',
    '330000',
    '340000',
    '350000',
    '360000',
    '370000',
    '410000',
    '420000',
    '430000',
    '440000',
    '450000',
    '460000',
    '500000',
    '510000',
    '520000',
    '530000',
    '540000',
    '610000',
    '620000',
    '630000',
    '640000',
    '650000',
    '710000',
    '810000',
    '820000',
  ];
  assert.equal(MAP_PROVINCES.length, 34);
  assert.equal(new Set(MAP_PROVINCES.map((p) => p.code)).size, 34);
  assert.deepEqual(MAP_PROVINCES.map((p) => p.code).sort(), expected);
  for (const province of MAP_PROVINCES) {
    assert(province.name.trim().length > 0, province.code);
    assertPath(province.path, province.code);
    if (province.label) {
      assert(Number.isFinite(province.label.x) && Number.isFinite(province.label.y));
      assert(province.label.x >= 0 && province.label.x <= MAP_BASE.width, province.code);
      assert(province.label.y >= 0 && province.label.y <= MAP_BASE.height, province.code);
    }
  }
  assert(MAP_DECORATIONS.length > 0);
  assert.equal(new Set(MAP_DECORATIONS.map((d) => d.id)).size, MAP_DECORATIONS.length);
  for (const decoration of MAP_DECORATIONS) {
    assert(decoration.id.trim().length > 0);
    assert(['outline', 'islands', 'sea-lines'].includes(decoration.kind));
    assertPath(decoration.path, decoration.id);
  }
});

test('the shared projection keeps mainland city references finite and inside the data-drawn map while rejecting invalid coordinates', () => {
  for (const [lng, lat] of [
    [114.5048, 37.0706],
    [118.7969, 32.0603],
    [113.5767, 22.2707],
    [104.0665, 30.5728],
  ]) {
    const point = projectCityPoint(lng, lat);
    assert(point, `${lng},${lat}`);
    assert(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert(point.x > 0 && point.x < MAP_BASE.width, `${lng},${lat}`);
    assert(point.y > 0 && point.y < MAP_BASE.height, `${lng},${lat}`);
  }
  const north = projectCityPoint(110, 50)!,
    south = projectCityPoint(110, 20)!;
  assert(north && south);
  assert(north.y < south.y);
  for (const pair of [
    [NaN, 30],
    [110, Infinity],
    [0, 0],
    [180, 30],
  ])
    assert.equal(projectCityPoint(pair[0], pair[1]), null);
});

test('city reference points share the province geometry projection for inland destinations away from simplified coastal borders', () => {
  // The prepared source has only absolute M/L/Z polygons. A small ray-casting
  // check catches projection/translation drift without adding a map runtime.
  const contains = (path: string, point: { x: number; y: number }) => {
    assert.match(path, /^[MLZ0-9.,\-\s]+$/);
    const rings: { x: number; y: number }[][] = [];
    let ring: { x: number; y: number }[] = [];
    for (const match of path.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)|(Z)/g)) {
      if (match[4]) {
        if (ring.length) rings.push(ring);
        ring = [];
      } else {
        if (match[1] === 'M' && ring.length) {
          rings.push(ring);
          ring = [];
        }
        ring.push({ x: Number(match[2]), y: Number(match[3]) });
      }
    }
    if (ring.length) rings.push(ring);
    return rings.some((polygon) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i],
          b = polygon[j];
        if (
          a.y > point.y !== b.y > point.y &&
          point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
        )
          inside = !inside;
      }
      return inside;
    });
  };
  for (const [city, province] of [
    [MAP_ORIGIN.code, '320000'],
    ['320100', '320000'],
    ['510100', '510000'],
  ]) {
    const point = cityPoint(city),
      region = MAP_PROVINCES.find((p) => p.code === province);
    assert(point && region, city);
    assert(contains(region.path, point), `${city} should project inside ${province}`);
  }
});

test('municipalities share city reference points, current destinations resolve, and missing points are never invented', () => {
  assert.equal(cityCode('110100'), '110000');
  assert.equal(cityCode('310115'), '310000');
  for (const code of ['110000', '120000', '310000', '500000']) assert(cityPoint(code), code);
  assert.deepEqual(cityPoint('110100'), cityPoint('110000'));
  assert.deepEqual(cityPoint('120100'), cityPoint('120000'));
  assert.deepEqual(cityPoint('310115'), cityPoint('310000'));
  assert.deepEqual(cityPoint('500200'), cityPoint('500000'));
  for (const code of [
    MAP_ORIGIN.code,
    '320100',
    '320200',
    '330200',
    '440400',
    '440800',
    '510100',
  ]) {
    const p = cityPoint(code);
    assert(p);
    assert(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert(p.x > 0 && p.x < MAP_BASE.width && p.y > 0 && p.y < MAP_BASE.height);
  }
  for (const code of ['659000', '999999', '__proto__', '130500/../../', ''])
    assert.equal(cityPoint(code), null);
  assertPath(mapClipPath(), 'map clipping area');
  assert.equal(routePath(cityPoint(MAP_ORIGIN.code)!, cityPoint(MAP_ORIGIN.code)!), '');
  assert.match(
    routePath(cityPoint(MAP_ORIGIN.code)!, cityPoint('440400')!),
    /^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/,
  );
});

test('map totals and rankings consistently use the chosen source and retain unmapped cities in real statistics', () => {
  const data: MapSnapshot = {
    updated_at: '2026-10-24T00:00:00Z',
    adoption_trees: 2,
    recent: [],
    cities: [
      {
        city_code: '320100',
        province_code: '320000',
        region_label: '江苏省 / 南京市',
        boxes: 2,
        adopted: 4,
        sponsored: 5,
        gifted: 1,
      },
      {
        city_code: '440400',
        province_code: '440000',
        region_label: '广东省 / 珠海市',
        boxes: 3,
        adopted: 0,
        sponsored: 0,
        gifted: 2,
      },
      {
        city_code: '659000',
        province_code: '650000',
        region_label: '新疆维吾尔自治区 / 自治区直辖县级行政区划',
        boxes: 0,
        adopted: 0,
        sponsored: 4,
        gifted: 3,
      },
    ],
  };
  const before = JSON.stringify(data);
  const all = footprintSummary(data, 'all'),
    orders = footprintSummary(data, 'orders'),
    sponsor = footprintSummary(data, 'sponsor'),
    gift = footprintSummary(data, 'gift');
  assert.equal(all.total, 24);
  assert.equal(all.provinces, 3);
  assert.equal(orders.total, 9);
  assert.equal(orders.provinces, 2);
  assert.equal(orders.cities[0].city_code, '320100');
  assert.equal(sponsor.total, 9);
  assert.equal(sponsor.cities.length, 2);
  assert.equal(sponsor.cities[0].city_code, '320100');
  assert.equal(gift.total, 6);
  assert.equal(gift.provinces, 3);
  assert.equal(gift.cities[0].city_code, '659000');
  assert.equal(cityQuantity(data.cities[0], 'sponsor'), 5);
  assert.equal(cityQuantity(data.cities[0], 'orders'), 6);
  assert.equal(cityQuantity(data.cities[0], 'gift'), 1);
  assert.equal(cityQuantity(data.cities[0], 'all'), 12);
  assert.equal(cityQuantity({ ...data.cities[0], gifted: undefined }, 'gift'), 0);
  assert.deepEqual(
    footprintSummary(
      {
        ...data,
        cities: [
          { ...data.cities[1], city_code: '440400', gifted: 4 },
          { ...data.cities[0], city_code: '320100', gifted: 4 },
        ],
      },
      'gift',
    ).cities.map((city) => city.city_code),
    ['320100', '440400'],
  );
  assert.equal(data.adoption_trees, 2);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(footprintSummary({ ...data, cities: [] }, 'all'), {
    cities: [],
    total: 0,
    provinces: 0,
  });
});

test('the immutable map and public license preserve conditional/HEAD requests without widening private asset caching', async () => {
  const seen: Request[] = [];
  const assets = {
    async fetch(request: Request) {
      seen.push(request);
      return new Response(null, { status: 304, headers: { etag: '"map-fixture"' } });
    },
  };
  const req = new Request(
    'https://shop.example.com/images/maps/china-admin-gs2019-1825-ba27af31e029.jpg',
    {
      method: 'HEAD',
      headers: { 'if-none-match': '"map-fixture"' },
    },
  );
  const response = await bundledAsset(req, assets);
  assert.equal(response?.status, 304);
  assert.match(response!.headers.get('cache-control')!, /31536000.*immutable/);
  assert.equal(seen[0].method, 'HEAD');
  assert.equal(seen[0].headers.get('if-none-match'), '"map-fixture"');
  const license = await bundledAsset(
    new Request('https://shop.example.com/images/maps/licenses.txt'),
    {
      async fetch() {
        return new Response('license', { headers: { 'content-type': 'text/plain' } });
      },
    },
  );
  assert.equal(license?.status, 200);
  assert.equal(license?.headers.get('cache-control'), 'public, max-age=86400');
  for (const path of ['/api/map', '/admin', '/media/apple-2026/a.jpg', '/images/maps/private.txt'])
    assert.equal(
      await bundledAsset(new Request('https://shop.example.com' + path), assets),
      undefined,
    );
});
