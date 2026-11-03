import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export class LocalD1 {
  db = new DatabaseSync(':memory:');
  failLinkWrites = 0;
  beforeShipment: (() => Promise<void>) | undefined;
  beforePaymentLease: (() => void) | undefined;
  constructor(generic = false) {
    for (const f of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.db.exec(readFileSync('migrations/' + f, 'utf8'));
    this.db.exec(
      readFileSync(generic ? 'scripts/seed.sql' : 'tests/fixtures/orchard-seed.sql', 'utf8'),
    );
    this.db.exec(readFileSync('scripts/regions.sql', 'utf8'));
    this.db.exec('UPDATE products SET stock=100');
  }
  prepare(sql: string) {
    let args: unknown[] = [];
    const statement = {
      bind: (...v: unknown[]) => {
        args = v;
        return statement;
      },
      first: async () => {
        if (
          sql.startsWith("UPDATE payment_sessions SET state='submitting'") &&
          this.beforePaymentLease
        ) {
          const hook = this.beforePaymentLease;
          this.beforePaymentLease = undefined;
          hook();
        }
        return this.db.prepare(sql).get(...(args as any[])) || null;
      },
      all: async () => ({ results: this.db.prepare(sql).all(...(args as any[])), success: true }),
      run: async () => {
        if (sql.startsWith('UPDATE orders SET stripe_session_id') && this.failLinkWrites) {
          this.failLinkWrites--;
          throw Error('simulated D1 link failure');
        }
        if (sql.startsWith('INSERT OR IGNORE INTO shipments') && this.beforeShipment) {
          const hook = this.beforeShipment;
          this.beforeShipment = undefined;
          await hook();
        }
        return {
          meta: { changes: Number(this.db.prepare(sql).run(...(args as any[])).changes) },
          success: true,
        };
      },
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
export const address = {
  recipient: '本地虚构收件人',
  phone: '13800000000',
  province_code: '110000',
  city_code: '110100',
  district_code: '110101',
  province: '北京市',
  city: '北京市',
  district: '东城区',
  address: '本地虚构地址001号',
};
export const retail = {
  type: 'retail',
  sku: 'FAMILY',
  qty: 1,
  phone: address.phone,
  address,
  invoice: { type: 'none' },
  agreed: true,
};
export function environment(DB = new LocalD1()): Env {
  return {
    DB,
    APP_ORIGIN: 'http://localhost:4321',
    DEMO_MODE: 'true',
    CACHE: { put: async () => {}, get: async () => null },
  } as unknown as Env;
}
export async function call(env: Env, path: string, body?: unknown, cookie = '') {
  const { api } = await import('../src/lib/api');
  const r = await api(
    new Request(env.APP_ORIGIN + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: r.status, data: (await r.json()) as any };
}
