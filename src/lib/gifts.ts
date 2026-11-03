import { z } from 'zod';
import { assert, digest } from './security';

const municipalities = ['110000', '120000', '310000', '500000'];
const code = z.string().regex(/^\d{6}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, '寄出日期无效');
const input = z
  .object({
    id: z.uuid(),
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(80),
    shipped_date: date.nullable().optional(),
    confirmed_shipped: z.literal(true),
    entries: z
      .array(
        z
          .object({
            source_row: z.number().int().positive().max(1000000),
            province_code: code,
            city_code: code,
            qty: z.number().int().positive().max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
type Query = { sql: string; args: (string | number | null)[] };
type GiftTotals = {
  batches: number;
  records: number;
  boxes: number;
  cities: number;
  provinces: number;
};

export async function giftImportQueries(raw: unknown): Promise<Query[]> {
  const b = input.parse(raw);
  assert(
    new Set(b.entries.map((e) => e.source_row)).size === b.entries.length,
    400,
    '名单中存在重复原始行号',
  );
  const entries = b.entries
    .map((e) => {
      if (!municipalities.includes(e.province_code)) return e;
      assert(
        [
          e.province_code,
          e.province_code.slice(0, 2) + '0100',
          e.province_code.slice(0, 2) + '0200',
        ].includes(e.city_code),
        400,
        '直辖市与城市不匹配',
      );
      return { ...e, city_code: e.province_code };
    })
    .sort((a, b) => a.source_row - b.source_row);
  const shippedDate = b.shipped_date ?? null;
  const contentHash = await digest(
    JSON.stringify({ name: b.name, shipped_date: shippedDate, entries }),
  );
  const count = entries.reduce((n, e) => n + e.qty, 0);
  return [
    {
      sql: `INSERT OR IGNORE INTO gift_batches(id,source_hash,content_hash,name,row_count,box_count,shipped_date)
      VALUES(?,?,?,?,?,?,?)`,
      args: [b.id, b.source_hash, contentHash, b.name, entries.length, count, shippedDate],
    },
    ...entries.map((e) => ({
      sql: `INSERT OR IGNORE INTO gift_deliveries(batch_id,source_row,province_code,city_code,qty)
      SELECT id,?,?,?,? FROM gift_batches WHERE source_hash=? AND content_hash=? AND status='draft'`,
      args: [e.source_row, e.province_code, e.city_code, e.qty, b.source_hash, contentHash],
    })),
    {
      sql: `UPDATE gift_batches SET status='active' WHERE source_hash=? AND content_hash=? AND status='draft'`,
      args: [b.source_hash, contentHash],
    },
  ];
}
export async function giftBatchStatements(env: Env, raw: unknown) {
  return (await giftImportQueries(raw)).map((q) => env.DB.prepare(q.sql).bind(...q.args));
}

export async function adminGifts(env: Env) {
  const [batchRows, cityRows, totals] = await Promise.all([
    env.DB.prepare(
      `SELECT id,name,status,row_count,box_count,created_at,shipped_date FROM gift_batches ORDER BY created_at DESC,id LIMIT 100`,
    ).all(),
    env.DB.prepare(
      `SELECT g.batch_id,g.province_code,g.city_code,
      p.name||' / '||c.name region_label,SUM(g.qty) qty FROM gift_deliveries g
      JOIN regions p ON p.adcode=g.province_code JOIN regions c ON c.adcode=g.city_code
      WHERE g.batch_id IN (SELECT id FROM gift_batches ORDER BY created_at DESC,id LIMIT 100)
      GROUP BY g.batch_id,g.province_code,g.city_code ORDER BY qty DESC,g.city_code`,
    ).all<{
      batch_id: string;
      province_code: string;
      city_code: string;
      region_label: string;
      qty: number;
    }>(),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM gift_batches WHERE status='active') batches,
      COUNT(*) records,COALESCE(SUM(g.qty),0) boxes,COUNT(DISTINCT g.city_code) cities,
      COUNT(DISTINCT g.province_code) provinces FROM gift_deliveries g
      JOIN gift_batches b ON b.id=g.batch_id AND b.status='active'`,
    ).first<GiftTotals>(),
  ]);
  assert(totals, 503, '赠送统计暂时不可用');
  return {
    batches: batchRows.results.map((b) => ({
      ...b,
      cities: cityRows.results
        .filter((c) => c.batch_id === b.id)
        .map(({ batch_id: _batch, ...city }) => city),
    })),
    totals,
  };
}
