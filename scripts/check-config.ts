// Checks a store config: npm run config:check [-- path/to.json]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStore } from '../src/lib/store-validate';
import { mergeStore } from '../src/lib/store-config';

const file = resolve(process.argv[2] || process.env.STORE_CONFIG || 'config/store.json');
const base = JSON.parse(readFileSync('config/store.json', 'utf8'));
let config: any;
try {
  config = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✖ ${file} 不是合法的 JSON：${(e as Error).message}`);
  process.exit(1);
}
// Missing keys fall back to the defaults, exactly as the running site does.
const errors = validateStore(base, mergeStore(base, config), (src, path) =>
  src.startsWith('/images/') && !existsSync(resolve('public' + src))
    ? `${path}.src：找不到 public${src}`
    : null,
);
if (errors.length) {
  console.error(`✖ ${file} 有 ${errors.length} 处需要修改：\n- ` + errors.join('\n- '));
  process.exit(1);
}
const on = Object.entries(config.features)
  .map(([k, v]) => `${k}=${v ? '开' : '关'}`)
  .join('，');
console.log(`✓ ${file} 格式正确（${on}）`);
