import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalD1, environment, call, retail } from './local-d1';

test('pausing sales in the admin closes checkout without a deploy and shows the announcement', async () => {
  const DB = new LocalD1(),
    admin = environment(DB);
  const live = environment(DB);
  Object.assign(live, {
    DEMO_MODE: 'false',
    SALES_OPEN: 'true',
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  });
  const store = { remote_fee: 2000, remote_provinces: ['650000'] };
  const saved = await call(admin, '/admin/studio/store', {
    ...store,
    sales_paused: true,
    announcement: '11 月 20 日起暂停发货',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const config = (await call(admin, '/config')).data;
  assert.equal(config.settings.sales_paused, true);
  assert.equal(config.settings.announcement, '11 月 20 日起暂停发货');
  const blocked = await call(live, '/checkout', retail);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /暂停接单|销售时间/);
  assert.equal(
    (
      await call(admin, '/admin/studio/store', {
        ...store,
        sales_paused: false,
        announcement: '',
        x: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(admin, '/admin/studio/store', { ...store, sales_paused: false, announcement: '' }))
      .status,
    200,
  );
  assert.equal((await call(admin, '/config')).data.settings.sales_paused, false);
});

test('dashboard revenue subtracts confirmed partial refunds', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const order = await call(env, '/checkout', retail);
  assert.equal(order.status, 200, JSON.stringify(order.data));
  await call(env, '/demo/pay', {
    order_no: order.data.order_no,
    view_token: order.data.view_token,
  });
  DB.db
    .prepare(
      "INSERT INTO admin_refund_requests(request_id,order_id,actor,amount,reason,status) VALUES('00000000-0000-4000-8000-000000000001',?,'local-demo',1000,'requested_by_customer','succeeded')",
    )
    .run(order.data.id);
  const stats = (await call(env, '/admin/data?summary=1')).data.stats;
  assert.equal(stats.gross_revenue, order.data.amount);
  assert.equal(stats.revenue, order.data.amount - 1000);
});

test('marking an invoice requires a requested invoice and an uploaded PDF', async () => {
  const DB = new LocalD1(),
    env = environment(DB);
  const order = await call(env, '/checkout', retail);
  await call(env, '/demo/pay', {
    order_no: order.data.order_no,
    view_token: order.data.view_token,
  });
  // No invoice was requested, so nothing changes and the admin is told.
  assert.equal((await call(env, '/admin/invoice', { id: order.data.id })).status, 409);
  assert.equal(
    (await call(env, '/admin/invoice', { id: order.data.id, url: '/media/apple-2026/a.jpg' }))
      .status,
    400,
  );
});
