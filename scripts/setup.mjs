import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, syncConfig } from './config-sync.mjs';

if (process.argv.slice(2).length) throw Error('setup 仅用于本地，不接受远端或环境参数。');
process.chdir(root);
syncConfig();
const vars = path.join(root, '.dev.vars');
if (!fs.existsSync(vars)) {
  fs.copyFileSync(path.join(root, '.dev.vars.example'), vars);
  fs.chmodSync(vars, 0o600);
  console.log('已创建本地 .dev.vars（仅回环地址允许模拟支付和免登录后台）。');
} else console.log('保留已有 .dev.vars。');
// The explicit --local flag is never taken from user arguments.
for (const args of [
  ['d1', 'migrations', 'apply', 'DB', '--local'],
  ['d1', 'execute', 'DB', '--local', '--file', 'scripts/seed.sql'],
  ['d1', 'execute', 'DB', '--local', '--file', 'scripts/catalog-update.sql'],
  ['d1', 'execute', 'DB', '--local', '--file', 'scripts/regions.sql'],
  ['d1', 'execute', 'DB', '--local', '--file', 'scripts/demo-stock.sql'],
]) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_ENV: '', CI: 'true' },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  '\n初始化完成。商品可用 npm run products 配置。运行 npm run dev，打开 http://localhost:4321；后台在 /admin。\n可体验下单、模拟付款、订单与后台经营，无需任何云端账号。重复 setup 会把本地演示库存恢复到 100。',
);
