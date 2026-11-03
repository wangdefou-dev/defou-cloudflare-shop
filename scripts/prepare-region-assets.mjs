import fs from 'node:fs';
import { createHash } from 'node:crypto';
const provinces = JSON.parse(fs.readFileSync('node_modules/china-division/dist/pcas-code.json', 'utf8'));
const rows = [], code = s => s.padEnd(6, '0');
for (const p of provinces) {
  rows.push({adcode:code(p.code),name:p.name,level:1,parent_adcode:null});
  for (const c of p.children || []) {
    rows.push({adcode:code(c.code),name:['11','12','31','50'].includes(p.code)?p.name:c.name,level:2,parent_adcode:code(p.code)});
    for (const d of c.children || []) rows.push({adcode:code(d.code),name:d.name,level:3,parent_adcode:code(c.code)});
  }
}
const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,12);
const prefix = `/regions/v1-${hash}/`, manifest = JSON.stringify({prefix}) + '\n';
const files = [...Map.groupBy(rows,r=>r.parent_adcode || 'root')].map(([key,data])=>['public'+prefix+key+'.json',JSON.stringify(data)]);
files.push(['src/lib/region-assets.json',manifest]);
if (process.argv.includes('--check')) {
  for (const [path,data] of files) if (!fs.existsSync(path) || fs.readFileSync(path,'utf8') !== data) throw Error('Regenerate static region data: '+path);
} else {
  fs.mkdirSync('public'+prefix,{recursive:true});
  for (const [path,data] of files) fs.writeFileSync(path,data);
}
console.log(`Verified ${files.length-1} static region lookups at ${prefix}`);
