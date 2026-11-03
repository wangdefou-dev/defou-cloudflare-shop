import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJSON, root, syncConfig } from './config-sync.mjs';

syncConfig(true);
const target = path.join(root,'.dev.vars.production');
const marker = '# Generated public build variables; never add secrets here.\n';
if (fs.existsSync(target) && !fs.readFileSync(target,'utf8').startsWith(marker))
  throw Error('已有 .dev.vars.production。请将正式密钥迁入 Worker Secrets，并移开该本地文件后再构建，避免本地变量覆盖正式静态页面。');
// Cloudflare prerenders inside workerd and otherwise loads .dev.vars, including
// DEMO_MODE=true. Give the production build only public vars from its own config.
const values = readJSON('wrangler.jsonc').env.production.vars;
fs.writeFileSync(target,marker+Object.entries(values).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
let status = 1;
try {
  const result = spawnSync(process.execPath,['node_modules/astro/bin/astro.mjs','build'],{cwd:root,stdio:'inherit',env:{...process.env,CLOUDFLARE_ENV:'production'}});
  status=result.status ?? 1;
} finally { fs.unlinkSync(target); }
if (status===0) status=spawnSync(process.execPath,['scripts/check-public-build.mjs'],{cwd:root,stdio:'inherit'}).status ?? 1;
process.exitCode=status;
