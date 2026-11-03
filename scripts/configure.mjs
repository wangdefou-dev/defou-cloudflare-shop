import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readJSON, root, syncConfig, validateSite } from './config-sync.mjs';

const rl = createInterface({ input: stdin, output: stdout });
async function ask(label, fallback = '') { return (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}：`)).trim() || fallback; }
try {
  const site = readJSON('config/site.json'), cf = readJSON('wrangler.jsonc');
  console.log('配置向导只写本地公开配置，不创建云资源、不上传密钥、不部署。密钥请按 docs/部署.md 配置。');
  site.name = await ask('商店名称', site.name);
  site.publisher = await ask('运营者名称', site.publisher);
  site.originLabel = await ask('公开产地（区域级）', site.originLabel);
  site.url = (await ask('网站 HTTPS 地址', site.url)).replace(/\/$/, '');
  site.ownerWechat = await ask('客服微信号', site.ownerWechat);
  site.wechatQrUrl = await ask('微信二维码（/images/... 或 HTTPS，可留空）', site.wechatQrUrl);
  site.season.start = await ask('销售开始日期 YYYY-MM-DD', site.season.start);
  site.season.end = await ask('销售截止日期 YYYY-MM-DD', site.season.end);
  site.season.label = await ask('销售季标签', site.season.label);
  site.paymentProject = await ask('本站支付项目标识（商户账号内唯一）', site.paymentProject);
  for (const sku of ['FAMILY','GIFT','PA','FG']) site.prices[sku] = Number(await ask(`${sku} 单价（整数分）`, String(site.prices[sku])));
  const prod = cf.env.production;
  prod.name = await ask('Worker 名称', prod.name);
  prod.d1_databases[0].database_name = await ask('D1 数据库名称', prod.d1_databases[0].database_name);
  prod.d1_databases[0].database_id = await ask('D1 database_id', prod.d1_databases[0].database_id);
  prod.kv_namespaces[0].id = await ask('KV namespace id', prod.kv_namespaces[0].id);
  prod.r2_buckets[0].bucket_name = await ask('R2 bucket 名称', prod.r2_buckets[0].bucket_name);
  prod.vars.ACCESS_TEAM_DOMAIN = await ask('Access team domain', prod.vars.ACCESS_TEAM_DOMAIN);
  prod.vars.ACCESS_AUD = await ask('Access application AUD', prod.vars.ACCESS_AUD);
  prod.vars.TURNSTILE_SITE_KEY = await ask('Turnstile site key（公开值）', prod.vars.TURNSTILE_SITE_KEY);
  validateSite(site);
  fs.writeFileSync(path.join(root, 'config/site.json'), JSON.stringify(site,null,2)+'\n');
  fs.writeFileSync(path.join(root, 'wrangler.jsonc'), JSON.stringify(cf,null,2)+'\n');
  syncConfig();
  console.log('已保存。SALES_OPEN 仍为 false；完成部署说明中的 Access、Webhook、库存设置和测试后再开售。');
} finally { rl.close(); }
