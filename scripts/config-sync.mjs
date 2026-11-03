import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
export function validateSite(site) {
  for (const key of ['name', 'publisher', 'originLabel', 'paymentProject'])
    assert(
      typeof site[key] === 'string' && site[key].trim() && !/[<>\r\n]/.test(site[key]),
      `config/site.json: ${key} 无效`,
    );
  assert(
    typeof site.features?.orchard === 'boolean' && typeof site.storefront?.seasonal === 'boolean',
    '请配置 features.orchard 和 storefront.seasonal',
  );
  for (const key of ['headline', 'description', 'shippingNote', 'afterSalesNote'])
    assert(
      typeof site.storefront[key] === 'string' &&
        site.storefront[key].trim() &&
        !/[<>]/.test(site.storefront[key]),
      '请填写 storefront.' + key,
    );
  const url = new URL(site.url);
  assert(
    url.protocol === 'https:' && url.origin === site.url && !url.username && !url.password,
    'url 必须是无尾斜杠的 HTTPS 源地址',
  );
  assert(
    /^[a-z0-9][a-z0-9-]{2,60}$/.test(site.paymentProject),
    'paymentProject 使用 3–61 位小写字母、数字和连字符',
  );
  for (const value of [site.season.start, site.season.end, site.contentUpdated])
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value,
      '日期必须使用有效 YYYY-MM-DD',
    );
  assert(site.season.start <= site.season.end, '销售开始日期不可晚于截止日期');
  for (const sku of ['FAMILY', 'GIFT', 'PA', 'FG'])
    assert(
      Number.isSafeInteger(site.prices[sku]) &&
        site.prices[sku] >= 300 &&
        site.prices[sku] <= 100000000,
      `${sku} 价格必须是整数分，至少 300 分`,
    );
  assert(
    Number.isSafeInteger(site.shipping.remoteFee) && site.shipping.remoteFee >= 0,
    '偏远运费必须是非负整数分',
  );
  assert(
    Array.isArray(site.shipping.remoteProvinces) &&
      site.shipping.remoteProvinces.every((v) => /^\d{6}$/.test(v)),
    '省份使用六位行政区代码',
  );
  const cities = readJSON('src/lib/map-cities.json');
  assert(Object.hasOwn(cities, site.mapOrigin.code), 'mapOrigin.code 不在内置城市坐标表中');
  for (const key of ['ownerXUrl', 'wechatQrUrl']) {
    const value = site[key];
    assert(typeof value === 'string', `${key} 必须是字符串`);
    if (value)
      assert(
        (key === 'wechatQrUrl' && /^\/images\/[\w/-]+\.(png|jpe?g|webp|svg)$/.test(value)) ||
          /^https:\/\//.test(value),
        `${key} 需使用 HTTPS 或本地公开图片路径`,
      );
  }
  return site;
}
export function validateCatalog(products) {
  assert(
    Array.isArray(products) && products.length > 0 && products.length <= 200,
    '商品目录需要 1–200 个商品',
  );
  const skus = new Set(),
    slugs = new Set();
  for (const p of products) {
    assert(
      /^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(p.sku) && !['FAMILY', 'GIFT', 'PA', 'FG'].includes(p.sku),
      'SKU 使用大写字母、数字、下划线或连字符，且不占用果园模块保留编号',
    );
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) && p.slug.length <= 80,
      '商品 slug 使用小写英文、数字和连字符',
    );
    assert(!skus.has(p.sku) && !slugs.has(p.slug), 'SKU 和 slug 不能重复');
    skus.add(p.sku);
    slugs.add(p.slug);
    for (const key of ['name', 'unit', 'category', 'specification', 'description'])
      assert(
        typeof p[key] === 'string' &&
          p[key].trim() &&
          p[key].length <= 2000 &&
          !/[<>]/.test(p[key]),
        '请填写商品 ' + key + '，不使用 HTML',
      );
    assert(
      Number.isSafeInteger(p.price) && p.price >= 300 && p.price <= 100000000,
      '商品价格为整数分，至少 300 分',
    );
    assert(
      typeof p.active === 'boolean' &&
        Number.isInteger(p.maxPerOrder) &&
        p.maxPerOrder >= 1 &&
        p.maxPerOrder <= 20,
      'active 为布尔值，单次限购 1–20',
    );
    assert(
      typeof p.image === 'string' &&
        (/^\/images\/[a-zA-Z0-9/_-]+\.(svg|webp|avif|png|jpe?g)$/.test(p.image) ||
          /^https:\/\//.test(p.image)),
      '商品图需使用公开图片目录或 HTTPS 地址',
    );
  }
  return products;
}
const sql = (v) => (v === null ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'");
export function catalogSQL(site, products = readJSON('config/products.json')) {
  validateCatalog(products);
  const legacy = [
    ['FAMILY', '家庭装', 250, 22, '零售家庭装'],
    ['GIFT', '礼盒装', 350, 8, '零售礼盒'],
    ['PA', '平安树', 250, 20, '认领 10 斤箱'],
    ['FG', '富贵树', 350, 9, '认领 6 斤箱'],
  ].map(([sku, name, weight, count, spec]) => ({
    sku,
    name,
    weight,
    count,
    specification: spec,
    price: site.prices[sku],
    kind: ['PA', 'FG'].includes(sku) ? 'adoption' : 'retail',
    unit: ['PA', 'FG'].includes(sku) ? '棵' : '箱',
    active: site.features.orchard,
  }));
  const rows = [
    ...products.map((p) => ({ ...p, kind: 'retail', weight: null, count: null })),
    ...legacy,
  ];
  const settings = {
    remote_provinces: site.shipping.remoteProvinces,
    remote_fee: site.shipping.remoteFee,
    season_end: site.season.end,
  };
  const columns =
    'id,sku,name,price,stock,active,restock_date,unit_weight_g,count_per_box,box_type,kind,unit,specification';
  const values = (p) =>
    [
      p.sku,
      p.sku,
      p.name,
      p.price,
      0,
      p.active ? 1 : 0,
      null,
      p.weight,
      p.count,
      p.specification,
      p.kind,
      p.unit,
      p.specification,
    ]
      .map(sql)
      .join(',');
  const seed =
    '-- Generated by npm run config:sync. Inventory starts at zero. Legacy orchard SKUs are inactive unless enabled.\n' +
    rows.map((p) => `INSERT OR IGNORE INTO products(${columns}) VALUES(${values(p)});`).join('\n') +
    '\n' +
    Object.entries(settings)
      .map(
        ([key, value]) =>
          `INSERT OR IGNORE INTO settings(key,value) VALUES(${sql(key)},${sql(JSON.stringify(value))});`,
      )
      .join('\n') +
    '\n';
  const update =
    '-- Explicit catalog update. Adds new SKUs with zero stock; preserves existing inventory and all orders.\n' +
    rows
      .map(
        (p) =>
          `INSERT INTO products(${columns}) VALUES(${values(p)}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,active=excluded.active,unit=excluded.unit,specification=excluded.specification,box_type=excluded.box_type;`,
      )
      .join('\n') +
    '\n' +
    `UPDATE products SET active=0 WHERE sku NOT IN (${rows.map((p) => sql(p.sku)).join(',')});\n` +
    Object.entries(settings)
      .map(
        ([key, value]) =>
          `INSERT INTO settings(key,value) VALUES(${sql(key)},${sql(JSON.stringify(value))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,
      )
      .join('\n') +
    '\n';
  return { seed, update };
}
export function syncConfig(check = false) {
  const site = validateSite(readJSON('config/site.json'));
  const config = readJSON('wrangler.jsonc');
  config.env.production.vars.APP_ORIGIN = site.url;
  // Public pages are built ahead of time, so public contact data must match the build.
  for (const vars of [config.vars, config.env.production.vars])
    vars.CONTACT_WECHAT = site.ownerWechat;
  const { seed, update } = catalogSQL(site);
  const files = {
    'wrangler.jsonc': JSON.stringify(config, null, 2) + '\n',
    'scripts/seed.sql': seed,
    'scripts/catalog-update.sql': update,
  };
  for (const [file, value] of Object.entries(files)) {
    const target = path.join(root, file);
    if (check)
      assert(
        fs.existsSync(target) && fs.readFileSync(target, 'utf8') === value,
        `配置未同步：${file}。请运行 npm run config:sync`,
      );
    else fs.writeFileSync(target, value);
  }
  console.log(
    check
      ? '配置与生成文件一致。'
      : '已同步域名、公开联系方式、商品价格与销售日期；未操作任何数据库。',
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  syncConfig(process.argv.includes('--check'));
