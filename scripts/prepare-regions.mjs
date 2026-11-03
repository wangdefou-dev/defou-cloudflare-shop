import fs from 'node:fs';
const provinces = JSON.parse(
  fs.readFileSync('node_modules/china-division/dist/pcas-code.json', 'utf8'),
);
const sql = [
  '-- Administrative address dictionary from china-division. This is NOT map boundary data.',
];
const escape = (s) => "'" + s.replaceAll("'", "''") + "'";
const code = (s) => s.padEnd(6, '0');
let count = 0;
for (const p of provinces) {
  sql.push(`INSERT OR IGNORE INTO regions VALUES('${code(p.code)}',${escape(p.name)},1,NULL);`);
  count++;
  for (const c of p.children || []) {
    const cn = ['11', '12', '31', '50'].includes(p.code) ? p.name : c.name;
    sql.push(
      `INSERT OR IGNORE INTO regions VALUES('${code(c.code)}',${escape(cn)},2,'${code(p.code)}');`,
    );
    count++;
    for (const d of c.children || []) {
      sql.push(
        `INSERT OR IGNORE INTO regions VALUES('${code(d.code)}',${escape(d.name)},3,'${code(c.code)}');`,
      );
      count++;
    }
  }
}
const content = sql.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync('scripts/regions.sql','utf8') !== content) throw Error('Regenerate SQL dictionary: node scripts/prepare-regions.mjs');
} else fs.writeFileSync('scripts/regions.sql', content);
console.log(`Prepared ${count} administrative address records.`);
