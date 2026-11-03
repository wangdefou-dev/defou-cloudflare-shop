import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readJSON, syncConfig } from './config-sync.mjs';

const production = process.argv.includes('--production');
const problems = [];
const requireValue = (ok, message) => { if (!ok) problems.push(message); };
try { syncConfig(true); } catch (e) { problems.push(e.message); }
const cf = readJSON('wrangler.jsonc');
if (production) {
  const prod = cf.env.production, vars = prod.vars;
  requireValue(!new URL(vars.APP_ORIGIN).hostname.endsWith('.example.com'), '请填写自己的正式 HTTPS 域名（config/site.json → config:sync）');
  requireValue(/^[\da-f-]{36}$/i.test(prod.d1_databases[0].database_id) && !/^0+-0+-/.test(prod.d1_databases[0].database_id), '请填写 D1 database_id');
  requireValue(/^[\da-f]{32}$/i.test(prod.kv_namespaces[0].id) && !/^0+$/.test(prod.kv_namespaces[0].id), '请填写 KV namespace id');
  requireValue(/^[a-z0-9][a-z0-9.-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN), '请配置 ACCESS_TEAM_DOMAIN');
  requireValue(/^[a-f0-9]{64}$/i.test(vars.ACCESS_AUD), '请配置 ACCESS_AUD');
  requireValue(Boolean(vars.TURNSTILE_SITE_KEY) && !/^1x000/.test(vars.TURNSTILE_SITE_KEY), '请配置正式 Turnstile site key');
  requireValue(vars.DEMO_MODE === 'false' && vars.SANDBOX_CHECKOUT === 'false', '正式环境必须关闭 DEMO_MODE / SANDBOX_CHECKOUT');
  requireValue(vars.STRIPE_MODE === 'live', '正式环境 STRIPE_MODE 必须为 live');
  requireValue(new Date().toISOString().slice(0,10) <= readJSON('config/site.json').season.end, '销售季已经结束，请更新日期');
  requireValue(!vars.MEDIA_BASE_URL || vars.MEDIA_BASE_URL === vars.APP_ORIGIN, '私有 PDF 与图片统一使用本站 /media/ 路由，不配置公开 R2 URL');
  if (!process.argv.includes('--offline')) {
    const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','secret','list','--env','production'], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) problems.push('无法读取 Worker Secret 名单，请登录 Wrangler 并按 docs/部署.md 创建 Worker、上传 Secrets');
    else {
      let names = [];
      try { names = JSON.parse(result.stdout).map(item => item.name); } catch { problems.push('Secret 名单无法解析，请单独运行 wrangler secret list --env production 检查'); }
      const required = ['ADMIN_EMAIL','TURNSTILE_SECRET_KEY'];
      if (vars.SALES_OPEN === 'true') required.push('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET');
      if (vars.NOTIFICATIONS_ENABLED === 'true') required.push('TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID');
      if (vars.TRACKING_ENABLED === 'true') required.push('KUAIDI100_CUSTOMER','KUAIDI100_KEY');
      for (const key of required) requireValue(names.includes(key), `Worker 缺少 Secret：${key}`);
    }
  }
} else requireValue(fs.existsSync(path.join(root,'.dev.vars')), '请先运行 npm run setup');
if (problems.length) { console.error('需要补齐配置：\n' + problems.map(p => '- '+p).join('\n')); process.exit(1); }
console.log(production ? '生产配置检查通过（仍需按部署文档实测 Access、Webhook 和支付）。' : '本地配置检查通过。');
