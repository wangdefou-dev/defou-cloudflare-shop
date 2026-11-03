import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { root, readJSON, validateCatalog, syncConfig } from './config-sync.mjs';

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (label, fallback = '') =>
  (await rl.question(`${label}${fallback !== '' ? ` [${fallback}]` : ''}：`)).trim() ||
  String(fallback);
try {
  const catalog = readJSON('config/products.json');
  console.log('商品配置向导：只保存本地配置，不操作库存或云端数据库。');
  catalog.forEach((p, i) =>
    console.log(`${i + 1}. ${p.name} · ${p.sku} · ¥${p.price / 100}/${p.unit}`),
  );
  const action = await ask('输入 add 新增、edit 编辑、remove 移除，或直接回车退出');
  if (['add', 'edit', 'remove'].includes(action)) {
    const index = action === 'add' ? -1 : Number(await ask('选择商品序号')) - 1;
    if (action !== 'add' && !catalog[index]) throw Error('商品序号无效');
    if (action === 'remove') catalog.splice(index, 1);
    else {
      const previous = index < 0 ? {} : catalog[index];
      const sku = index < 0 ? await ask('商品 SKU（例如 TSHIRT_M，创建后保持不变）') : previous.sku;
      const product = {
        sku,
        slug: await ask('商品网址 slug', previous.slug || sku.toLowerCase().replaceAll('_', '-')),
        name: await ask('商品名称', previous.name),
        category: await ask('分类', previous.category || '日常好物'),
        unit: await ask('单位（件、本、盒、包等）', previous.unit || '件'),
        price: Math.round(
          Number(
            await ask('价格（元）', previous.price === undefined ? '' : previous.price / 100),
          ) * 100,
        ),
        specification: await ask('规格（如黑色/M码、500克）', previous.specification),
        description: await ask('商品说明', previous.description),
        image: await ask('图片路径或 HTTPS 地址', previous.image || '/images/demo/package.svg'),
        maxPerOrder: Number(await ask('每单限购数量（1–20）', previous.maxPerOrder || 20)),
        active: (await ask('是否上架 true/false', previous.active ?? true)) === 'true',
      };
      if (index < 0) catalog.push(product);
      else catalog[index] = product;
    }
    validateCatalog(catalog);
    fs.writeFileSync(
      path.join(root, 'config/products.json'),
      JSON.stringify(catalog, null, 2) + '\n',
    );
    syncConfig();
    console.log(
      '已保存。新商店运行 setup；已有商店按 docs/配置.md 应用 catalog-update.sql，再重新构建发布。',
    );
  }
} finally {
  rl.close();
}
