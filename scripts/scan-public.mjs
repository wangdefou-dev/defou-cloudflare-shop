import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './config-sync.mjs';

// Findings print only file names and rule names, never the matched credential.
let files;
try { files = execFileSync('git',['ls-files','-z'],{ cwd: root, encoding:'utf8' }).split('\0').filter(Boolean); }
catch {
  const walk = folder => fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry => {
    if (['.git','node_modules','dist','.astro','.wrangler','outputs'].includes(entry.name)) return [];
    const target = path.join(folder,entry.name);
    return entry.isDirectory() ? walk(target) : [path.relative(root,target)];
  });
  files = walk(root);
}
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:ghp_|gho_|ghu_|ghs_|github_pat_)[A-Za-z0-9_]{30,}/],
  ['stripe-secret', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/],
  ['webhook-secret', /\bwhsec_[A-Za-z0-9]{24,}/],
  ['telegram-token', /\b\d{8,12}:[A-Za-z0-9_-]{30,}/],
  ['local-user-path', /\/Users\/[A-Za-z][^\s/]{1,50}\//],
];
const findings=[];
for (const file of files) {
  if (!file.endsWith('.example.json') && /^(?:outputs\/|\.wrangler\/|\.secrets|\.dev\.vars$|\.env$)|\.(?:sqlite\w*|db|xlsx?|csv|pem|key|p12)$/i.test(file)) findings.push([file,'private-file']);
  const bytes=fs.readFileSync(path.join(root,file));
  if (bytes.includes(0)) continue;
  const body=bytes.toString('utf8');
  for (const [rule,pattern] of rules) if (pattern.test(body)) findings.push([file,rule]);
}
if (findings.length) { console.error(findings.map(([file,rule]) => `${file}: ${rule}`).join('\n')); process.exit(1); }
console.log(`公开文件检查通过：${files.length} 个文件，无匹配的凭证或私有文件。`);
