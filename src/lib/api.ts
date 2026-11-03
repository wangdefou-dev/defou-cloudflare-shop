import { sanitizeImage } from './image-sanitize';
import { adminList } from './admin-lists';
import { checkoutOrder } from './orders';
import { validateAddress, openSales, orderToken } from './order-access';
import { z } from 'zod';
import { booking, phone, sponsor } from './validation';
import {
  admin,
  boundedBody,
  assert,
  digest,
  HttpError,
  human,
  isDemo,
  isSandbox,
  jsonBody,
  rateLimit,
  sameOrigin,
  verifyPin,
} from './security';
import { settings, rebuildMap, notify, MAP_CACHE_KEY, publicMap } from './database';
import {
  assertPaymentBrowser,
  createSession,
  markPaid,
  shipmentStatement,
  webhook,
  stripe,
} from './payments';
import { chinaDate, csvCell, isSaleDay, SEASON_END, shippingFee } from './shared';
import { OWNER_WECHAT } from './content';
import { adminOrderDetail } from './admin-order';
import { quoteCoupon, adminCoupons, createAdminCoupons } from './coupons';
import { refundPreview, syncAdminRefunds, createAdminRefund } from './refunds';
import { adminGifts } from './gifts';
import { shipmentTracking, validTrackingNumber, type TrackingShipment } from './tracking';
import { resolveCarrier } from './shipping';
import {
  searchPeople,
  customerDetail,
  adoptionDetail,
  resetAdoptionPin,
  renameAdoption,
} from './admin-people';
const id = () => crypto.randomUUID();
const orderNo = () =>
  'DF' +
  chinaDate().replaceAll('-', '').slice(2) +
  crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex,nofollow,noarchive,nosnippet',
      ...headers,
    },
  });
async function currentAdoption(env: Env, request: Request) {
  const token = request.headers.get('cookie')?.match(/(?:^|; )tree_session=([^;]+)/)?.[1];
  assert(token, 401, '请先登录我的苹安树');
  const a = await env.DB.prepare(
    "SELECT a.* FROM sessions s JOIN adoptions a ON s.adoption_id=a.id JOIN orders o ON a.order_id=o.id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND o.status IN ('paid','shipped')",
  )
    .bind(await digest(token))
    .first<any>();
  assert(a, 401, '登录已过期，请重新登录');
  return a;
}
async function lookup(env: Env, request: Request, b: any) {
  if (b.view_token) {
    const o = await env.DB.prepare(
      "SELECT o.* FROM order_tokens t JOIN orders o ON t.order_id=o.id WHERE t.token_hash=? AND t.expires_at>datetime('now')",
    )
      .bind(await digest(z.string().min(60).max(100).parse(b.view_token)))
      .first<any>();
    assert(o && o.order_no === b.order_no, 401, '订单访问凭证无效');
    return o;
  }
  phone.parse(b.phone);
  z.string()
    .regex(/^DF[A-Z0-9]{18}$/)
    .parse(b.order_no);
  await human(env, request, b.turnstile);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE order_no=? AND phone=?')
    .bind(b.order_no, b.phone)
    .first<any>();
  assert(o, 404, '未找到匹配订单，请检查手机号和订单号');
  return o;
}
async function publicOrder(env: Env, o: any) {
  const shipments = await env.DB.prepare(
    "SELECT id,qty,status,carrier,tracking_no,expected_date,region_label,card_message FROM shipments WHERE (source='retail' AND source_id=?) OR id=?",
  )
    .bind(o.id, o.shipment_id || '')
    .all();
  const adoption = await env.DB.prepare(
    'SELECT adopt_code,tier,plate_name,total_boxes FROM adoptions WHERE order_id=?',
  )
    .bind(o.id)
    .first();
  return {
    order_no: o.order_no,
    type: o.type,
    status: o.status,
    amount: o.amount,
    remote_fee: o.remote_fee,
    original_amount: o.original_amount ?? o.amount,
    discount_amount: o.discount_amount || 0,
    coupon_percent_off: o.coupon_percent_off,
    coupon_code_hint: o.coupon_code_hint,
    created_at: o.created_at,
    invoice_status: o.invoice_status,
    shipments: shipments.results,
    adoption,
  };
}
export async function api(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/\/$/, '');
    if (path === '/api/stripe/webhook' && request.method === 'POST')
      return json(await webhook(env, request));
    if (request.method !== 'GET' && request.method !== 'HEAD') sameOrigin(request);
    const demo = isDemo(env, request);
    // Reject anonymous management requests before even touching the rate-limit DB.
    if (path.startsWith('/api/admin')) return await adminApi(request, env, path);
    if (path === '/api/config' && request.method === 'GET') {
      const [products, publicSettings] = await Promise.all([
        env.DB.prepare('SELECT * FROM products').all(),
        settings(env),
      ]);
      return json({
        demo,
        sandbox: isSandbox(env, request),
        sales_open: demo || isSandbox(env, request) || (env.SALES_OPEN === 'true' && isSaleDay()),
        products: products.results,
        settings: publicSettings,
        turnstile_site_key: env.TURNSTILE_SITE_KEY || '',
        contact_wechat: env.CONTACT_WECHAT || OWNER_WECHAT,
        official_qr_url: env.OFFICIAL_QR_URL || '',
      });
    }
    if (path === '/api/map' && request.method === 'GET') {
      const cache = await env.CACHE.get<Awaited<ReturnType<typeof rebuildMap>>>(
        MAP_CACHE_KEY,
        'json',
      );
      return json(publicMap(cache || (await rebuildMap(env))));
    }
    if (path === '/api/wall' && request.method === 'GET')
      return json(
        (
          await env.DB.prepare(
            "SELECT event_name,event_date,headcount,photos,address_json FROM sponsor_apps WHERE show_on_wall=1 AND photo_consent=1 AND status='photo_back'",
          ).all<any>()
        ).results.map((x) => ({
          event_name: x.event_name,
          event_date: x.event_date,
          headcount: x.headcount,
          photos: JSON.parse(x.photos),
          city: JSON.parse(x.address_json).city,
        })),
      );
    if (path === '/api/diary' && request.method === 'GET')
      return json(
        (await env.DB.prepare('SELECT * FROM diary_posts ORDER BY date DESC LIMIT 12').all())
          .results,
      );
    if (path === '/api/regions' && request.method === 'GET') {
      const parent = url.searchParams.get('parent');
      return json(
        (
          await env.DB.prepare(
            parent
              ? 'SELECT * FROM regions WHERE parent_adcode=? ORDER BY adcode'
              : 'SELECT * FROM regions WHERE level=1 ORDER BY adcode',
          )
            .bind(...(parent ? [parent] : []))
            .all()
        ).results,
      );
    }
    await rateLimit(
      env,
      (request.headers.get('cf-connecting-ip') || 'local') + ':' + path,
      path === '/api/order/status' ? 600 : 60,
    );
    if (path === '/api/coupons/quote' && request.method === 'POST') {
      openSales(env, request);
      const b = z
        .object({ code: z.string().trim().min(1).max(40), sku: z.enum(['FAMILY', 'GIFT']) })
        .parse(await jsonBody(request));
      const p = await env.DB.prepare('SELECT price,stock,active FROM products WHERE sku=?')
        .bind(b.sku)
        .first<{ price: number; stock: number; active: number }>();
      assert(p && p.active === 1 && p.stock > 0, 409, '所选规格暂不可购买');
      const quote = await quoteCoupon(env, b.code, b.sku, p.price);
      const { id: _privateId, ...publicQuote } = quote;
      return json(publicQuote);
    }
    if (path === '/api/checkout' && request.method === 'POST')
      return json(await checkoutOrder(env, request));
    if (path === '/api/order/tracking' && request.method === 'POST') {
      const b = z
        .object({
          shipment_id: z.string().min(1).max(100),
          view_token: z.string().min(60).max(100),
        })
        .strict()
        .parse(await jsonBody(request));
      const o = await env.DB.prepare(
        "SELECT o.id,o.shipment_id FROM order_tokens t JOIN orders o ON t.order_id=o.id WHERE t.token_hash=? AND t.expires_at>datetime('now')",
      )
        .bind(await digest(b.view_token))
        .first<{ id: string; shipment_id: string | null }>();
      assert(o, 401, '订单访问凭证已过期，请重新查询');
      const shipment = await env.DB.prepare(
        "SELECT id,carrier,tracking_no,status,shipped_at,phone,recipient,address,sender FROM shipments WHERE id=? AND ((source='retail' AND source_id=?) OR id=?)",
      )
        .bind(b.shipment_id, o.id, o.shipment_id || '')
        .first<TrackingShipment>();
      assert(shipment, 404, '未找到该订单的物流记录');
      await rateLimit(env, 'tracking-order:' + o.id + ':' + shipment.id, 30, 600);
      return json(await shipmentTracking(env, shipment), 200, {
        'cache-control': 'private, no-store',
      });
    }
    if (path === '/api/tree/tracking' && request.method === 'POST') {
      const b = z
        .object({ shipment_id: z.string().min(1).max(100) })
        .strict()
        .parse(await jsonBody(request));
      const a = await currentAdoption(env, request);
      const shipment = await env.DB.prepare(
        "SELECT id,carrier,tracking_no,status,shipped_at,phone,recipient,address,sender FROM shipments WHERE id=? AND source='adoption' AND source_id=?",
      )
        .bind(b.shipment_id, String(a.id))
        .first<TrackingShipment>();
      assert(shipment, 404, '未找到这棵树的物流记录');
      await rateLimit(env, 'tracking-tree:' + a.id + ':' + shipment.id, 30, 600);
      return json(await shipmentTracking(env, shipment), 200, {
        'cache-control': 'private, no-store',
      });
    }
    if (path === '/api/order/status' && request.method === 'POST') {
      const b = z
        .object({ view_token: z.string().min(60).max(100) })
        .parse(await jsonBody(request));
      const o = await env.DB.prepare(
        "SELECT o.* FROM order_tokens t JOIN orders o ON t.order_id=o.id WHERE t.token_hash=? AND t.expires_at>datetime('now')",
      )
        .bind(await digest(b.view_token))
        .first<any>();
      assert(o, 401, '订单访问凭证已过期，请重新查询');
      return json(await publicOrder(env, o));
    }
    if (path === '/api/order/lookup' && request.method === 'POST') {
      const o = await lookup(env, request, await jsonBody(request));
      return json({ ...(await publicOrder(env, o)), view_token: await orderToken(env, o.id) });
    }
    if (path === '/api/order/resume' && request.method === 'POST') {
      assertPaymentBrowser(request);
      const o = await lookup(env, request, await jsonBody(request));
      assert(o.status === 'pending', 409, '该订单无需继续支付');
      assert(
        Date.parse(o.expires_at.replace(' ', 'T') + 'Z') > Date.now(),
        409,
        '支付已超时，请重新下单',
      );
      if (demo) return json({ url: '/pay/result?order=' + o.order_no });
      const s = await stripe(env).checkout.sessions.retrieve(o.stripe_session_id);
      assert(s.url && s.status === 'open', 409, '支付已结束，请查询订单状态');
      return json({ url: s.url });
    }
    if (path === '/api/demo/pay' && request.method === 'POST') {
      assert(demo, 404, '页面不存在');
      const o = await lookup(env, request, await jsonBody(request));
      assert(o.status === 'pending', 409, '订单已处理');
      await markPaid(env, o, 'demo-' + o.id, null);
      return json(await publicOrder(env, { ...o, status: 'paid' }));
    }
    if (path === '/api/tree/login' && request.method === 'POST') {
      const b = z
        .object({
          phone,
          code: z.string().regex(/^(PA|FG)-\d{4,}$/),
          pin: z.string().regex(/^\d{6}$/),
          turnstile: z.string().optional(),
        })
        .parse(await jsonBody(request));
      await human(env, request, b.turnstile);
      await rateLimit(env, 'tree-' + b.phone, 8, 600);
      const a = await env.DB.prepare(
        "SELECT a.* FROM adoptions a JOIN orders o ON a.order_id=o.id WHERE a.adopt_code=? AND o.phone=? AND o.status IN ('paid','shipped')",
      )
        .bind(b.code, b.phone)
        .first<any>();
      assert(a && (await verifyPin(b.pin, a.pin_hash)), 401, '手机号、认领码或 PIN 不正确');
      const token = crypto.randomUUID() + crypto.randomUUID();
      const login = await env.DB.prepare(
        `INSERT INTO sessions(token_hash,adoption_id,expires_at)
        SELECT ?,?,datetime('now','+12 hours') WHERE EXISTS(
         SELECT 1 FROM adoptions a JOIN orders o ON o.id=a.order_id
         WHERE a.id=? AND a.pin_hash=? AND o.status IN ('paid','shipped'))`,
      )
        .bind(await digest(token), a.id, a.id, a.pin_hash)
        .run();
      assert(login.meta.changes === 1, 409, 'PIN 已变更，请使用新 PIN 重新登录');
      return json({ ok: true }, 200, {
        'set-cookie': `tree_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${demo ? '' : '; Secure'}`,
      });
    }
    if (path === '/api/tree/logout' && request.method === 'POST') {
      const a = await currentAdoption(env, request);
      await env.DB.prepare('DELETE FROM sessions WHERE adoption_id=?').bind(a.id).run();
      return json({ ok: true }, 200, {
        'set-cookie': 'tree_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      });
    }
    if (path === '/api/tree/me' && request.method === 'GET') {
      const a = await currentAdoption(env, request);
      delete a.pin_hash;
      delete a.pin_version;
      delete a.pin_updated_at;
      return json({
        ...a,
        shipments: (
          await env.DB.prepare(
            "SELECT * FROM shipments WHERE source='adoption' AND source_id=? ORDER BY created_at DESC",
          )
            .bind(String(a.id))
            .all()
        ).results,
      });
    }
    if (path === '/api/tree/book' && request.method === 'POST') {
      const a = await currentAdoption(env, request);
      assert(chinaDate() <= SEASON_END, 409, '本季预约已截止');
      const b = booking.parse(await jsonBody(request));
      await validateAddress(env, b.address);
      assert(b.qty <= a.total_boxes - a.used_boxes, 409, '剩余箱数不足');
      const c = await settings(env),
        fee = shippingFee(b.address.province_code, b.qty, c.remote_provinces, c.remote_fee),
        sid = id();
      if (fee) {
        assertPaymentBrowser(request);
        if (!demo)
          assert(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET, 503, '运费支付尚未配置');
        const o = { id: id(), order_no: orderNo(), type: 'shipping', amount: fee };
        const owner = await env.DB.prepare('SELECT phone FROM orders WHERE id=?')
          .bind(a.order_id)
          .first<any>();
        await env.DB.batch([
          shipmentStatement(
            env,
            sid,
            'adoption',
            String(a.id),
            a.tier === 888 ? 'PA' : 'FG',
            b.qty,
            b.address,
            b.expected_date,
            'awaiting_payment',
          ),
          env.DB.prepare(
            "INSERT INTO orders(id,order_no,type,phone,amount,remote_fee,expires_at,shipment_id) VALUES(?,?,?,?,?,?,datetime('now','+30 minutes'),?)",
          ).bind(o.id, o.order_no, 'shipping', owner.phone, fee, fee, sid),
        ]);
        try {
          return json({
            ...o,
            view_token: await orderToken(env, o.id),
            ...(await createSession(env, request, o, '苹安树偏远地区运费', b.payment_method)),
            payment_required: true,
          });
        } catch (e) {
          throw e;
        }
      }
      await shipmentStatement(
        env,
        sid,
        'adoption',
        String(a.id),
        a.tier === 888 ? 'PA' : 'FG',
        b.qty,
        b.address,
        b.expected_date,
      ).run();
      await notify(
        env,
        'booking-' + sid,
        `新预约：${a.adopt_code}，${b.qty} 箱，期望 ${b.expected_date} 发货。`,
      );
      await rebuildMap(env);
      return json({ ok: true });
    }
    if (path === '/api/tree/cancel' && request.method === 'POST') {
      const a = await currentAdoption(env, request),
        b = z.object({ id: z.uuid() }).parse(await jsonBody(request));
      const s = await env.DB.prepare(
        "SELECT * FROM shipments WHERE id=? AND source='adoption' AND source_id=?",
      )
        .bind(b.id, String(a.id))
        .first<any>();
      assert(
        s && ['reserved', 'awaiting_payment'].includes(s.status),
        409,
        '已发货或已取消的预约不能取消',
      );
      const feeOrder = await env.DB.prepare(
        "SELECT * FROM orders WHERE shipment_id=? AND status IN ('pending','paid')",
      )
        .bind(s.id)
        .first<any>();
      if (feeOrder?.status === 'paid')
        throw new HttpError(409, '已支付补差运费，请联系运营退回运费后取消');
      if (feeOrder?.stripe_session_id && !demo)
        await stripe(env).checkout.sessions.expire(feeOrder.stripe_session_id);
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE shipments SET status='cancelled' WHERE id=? AND status IN ('reserved','awaiting_payment')",
        ).bind(s.id),
        env.DB.prepare(
          "UPDATE orders SET status='expired' WHERE shipment_id=? AND status='pending'",
        ).bind(s.id),
      ]);
      await rebuildMap(env);
      return json({ ok: true });
    }
    if (path === '/api/tree/edit' && request.method === 'POST') {
      const a = await currentAdoption(env, request),
        b = z
          .object({
            id: z.uuid(),
            expected_date: z.string(),
            card_message: z.string().max(60),
          })
          .parse(await jsonBody(request));
      assert(
        b.expected_date >= chinaDate(2) && b.expected_date <= SEASON_END,
        400,
        '请选择有效的期望日期',
      );
      const result = await env.DB.prepare(
        "UPDATE shipments SET expected_date=?,card_message=? WHERE id=? AND source='adoption' AND source_id=? AND status='reserved'",
      )
        .bind(b.expected_date, b.card_message, b.id, String(a.id))
        .run();
      assert(result.meta.changes, 409, '只能修改尚未发货的预约');
      return json({ ok: true });
    }
    if (path === '/api/treat/apply' && request.method === 'POST') {
      assert(demo || chinaDate() <= SEASON_END, 409, '本季申请已结束');
      const b = sponsor.parse(await jsonBody(request));
      await human(env, request, b.turnstile);
      await validateAddress(env, b.address);
      await rateLimit(env, 'sponsor-' + b.phone, 1, 30 * 86400);
      const exists = await env.DB.prepare(
        "SELECT id FROM sponsor_apps WHERE phone=? AND created_at>datetime('now','-30 days')",
      )
        .bind(b.phone)
        .first();
      assert(!exists, 409, '同一手机号 30 天内仅能提交一次');
      const appNo = 'AP-' + id().slice(0, 12).toUpperCase(),
        appId = id();
      await env.DB.prepare(
        'INSERT INTO sponsor_apps(id,app_no,org_name,event_name,event_date,headcount,contact,phone,wechat,address_json,reason,link) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
        .bind(
          appId,
          appNo,
          b.org_name,
          b.event_name,
          b.event_date,
          b.headcount,
          b.contact,
          b.phone,
          b.wechat,
          JSON.stringify(b.address),
          b.reason,
          b.link,
        )
        .run();
      // The insert trigger records the Telegram notification in the same
      // transaction. External delivery must not delay or fail the application.
      return json({ app_no: appNo });
    }
    if (path === '/api/treat/lookup' && request.method === 'POST') {
      const b = z
        .object({ phone, app_no: z.string().min(10).max(40), turnstile: z.string().optional() })
        .parse(await jsonBody(request));
      await human(env, request, b.turnstile);
      const a = await env.DB.prepare(
        'SELECT app_no,event_name,status,boxes_granted,rejection_reason FROM sponsor_apps WHERE phone=? AND app_no=?',
      )
        .bind(b.phone, b.app_no)
        .first<any>();
      assert(a, 404, '未找到匹配的申请');
      return json(a);
    }
    return json({ error: '接口不存在' }, 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: e.issues.map((x) => x.message).join('；') }, 400);
    if (e instanceof HttpError)
      return json({ error: e.message, code: e.code, request_id: requestId }, e.status);
    if (
      e instanceof Error &&
      /pin_reset_conflict|UNIQUE constraint.*adoption_pin_resets/.test(e.message)
    )
      return json({ error: 'PIN 或认领状态已变化，请刷新详情后重试' }, 409);
    if (e instanceof Error && /coupon_issuance_conflict/.test(e.message))
      return json({ error: '创建请求内容已变化，请保留原清单并刷新核对' }, 409);
    if (e instanceof Error && /UNIQUE constraint.*coupons\.code_hash/.test(e.message))
      return json({ error: '清单中的券码已属于其他批次，请核对已有批次或重新生成清单' }, 409);
    if (e instanceof Error && /coupon_refund_limit/.test(e.message))
      return json({ error: '剩余可赔付金额已变化，请刷新订单并核对 Stripe 可退余额' }, 409);
    if (e instanceof Error && /refund_in_progress|refund_shipping_pending/.test(e.message))
      return json({ error: '该订单退款或补运费付款尚未完成，请先核对状态后再操作' }, 409);
    if (e instanceof Error && /coupon_|coupon_reservations/.test(e.message))
      return json({ error: '优惠码状态已变化，请重新应用优惠码后下单' }, 409);
    if (e instanceof Error && /CHECK constraint|商品已下架|无效认领/.test(e.message))
      return json({ error: '库存或剩余箱数已变化，请刷新后重试' }, 409);
    console.error(
      JSON.stringify({
        event: 'api_failed',
        request_id: requestId,
        route: /^\/api\/[a-z/-]{1,70}$/.test(new URL(request.url).pathname)
          ? new URL(request.url).pathname
          : 'unknown',
        kind: e instanceof Error ? e.name : 'unknown',
      }),
    );
    return json({ error: '暂时无法处理，请稍后重试或联系运营', request_id: requestId }, 500);
  }
}
async function adminApi(request: Request, env: Env, path: string) {
  const actor = await admin(env, request);
  await rateLimit(env, 'admin-' + actor + ':' + path, 60);
  if (path === '/api/admin/gifts' && request.method === 'GET') return json(await adminGifts(env));
  if (
    ['/api/admin/refunds/preview', '/api/admin/refunds/sync'].includes(path) &&
    request.method === 'POST'
  ) {
    const b = z.object({ order_id: z.string().min(1).max(100) }).parse(await jsonBody(request));
    return json(await (path.endsWith('/sync') ? syncAdminRefunds : refundPreview)(env, b.order_id));
  }
  if (path === '/api/admin/refunds/create' && request.method === 'POST')
    return json(await createAdminRefund(env, actor, await jsonBody(request)));
  if (path === '/api/admin/people/search' && request.method === 'POST')
    return json(await searchPeople(env, await jsonBody(request)));
  if (path === '/api/admin/customer-detail' && request.method === 'POST') {
    const detail = await customerDetail(env, await jsonBody(request));
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, 'view-customer-detail', detail.customer.id)
      .run();
    return json(detail);
  }
  if (path === '/api/admin/adoption-detail' && request.method === 'POST') {
    const b = z.object({ id: z.number().int().positive() }).parse(await jsonBody(request));
    const detail = await adoptionDetail(env, b.id);
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, 'view-adoption-detail', String(b.id))
      .run();
    return json(detail);
  }
  if (path === '/api/admin/adoption-pin' && request.method === 'POST')
    return json(await resetAdoptionPin(env, actor, await jsonBody(request)));
  if (path === '/api/admin/adoption-name' && request.method === 'POST')
    return json(await renameAdoption(env, actor, await jsonBody(request)));
  if (path === '/api/admin/coupons' && request.method === 'GET')
    return json(await adminCoupons(env));
  if (path === '/api/admin/coupons/search' && request.method === 'POST')
    return json(await adminCoupons(env, await jsonBody(request)));
  if (path === '/api/admin/coupons/create' && request.method === 'POST')
    return json(await createAdminCoupons(env, actor, await jsonBody(request)));
  if (path === '/api/admin/coupons/disable' && request.method === 'POST') {
    const b = z
      .object({ id: z.string().min(1).max(100), disabled: z.boolean() })
      .parse(await jsonBody(request));
    const result = await env.DB.prepare('UPDATE coupons SET disabled=? WHERE id=?')
      .bind(b.disabled ? 1 : 0, b.id)
      .run();
    assert(result.meta.changes === 1, 404, '未找到优惠券');
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, b.disabled ? 'disable-coupon' : 'enable-coupon', b.id)
      .run();
    return json({ ok: true });
  }
  if (path === '/api/admin/shipment-tracking' && request.method === 'POST') {
    const b = z
      .object({ shipment_id: z.string().min(1).max(100) })
      .strict()
      .parse(await jsonBody(request));
    const shipment = await env.DB.prepare(
      'SELECT id,carrier,tracking_no,status,shipped_at,phone,recipient,address,sender FROM shipments WHERE id=?',
    )
      .bind(b.shipment_id)
      .first<TrackingShipment>();
    assert(shipment, 404, '未找到物流记录');
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, 'view-shipment-tracking', shipment.id)
      .run();
    return json(await shipmentTracking(env, shipment), 200, {
      'cache-control': 'private, no-store',
    });
  }
  if (path === '/api/admin/order-detail' && request.method === 'POST') {
    const b = z.object({ id: z.string().min(1).max(100) }).parse(await jsonBody(request));
    const detail = await adminOrderDetail(env, b.id);
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, 'view-order-detail', b.id)
      .run();
    return json(detail);
  }
  if (path === '/api/admin/list' && request.method === 'POST')
    return json(await adminList(env, await jsonBody(request)));
  if (path === '/api/admin/data' && request.method === 'GET') {
    const summaryOnly = new URL(request.url).searchParams.get('summary') === '1';
    const previewList = (kind: 'orders' | 'shipments' | 'sponsors') =>
      summaryOnly ? Promise.resolve({ rows: [] }) : adminList(env, { kind, page_size: 20 });
    const [orders, shipments, sponsors, products] = await Promise.all([
      previewList('orders'),
      previewList('shipments'),
      previewList('sponsors'),
      env.DB.prepare('SELECT * FROM products').all(),
    ]);
    const stats = await env.DB.prepare(
      "SELECT (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status IN ('paid','shipped')) revenue,(SELECT COALESCE(SUM(qty),0) FROM shipments WHERE status='reserved') pending_boxes,(SELECT COUNT(*) FROM adoptions a JOIN orders o ON a.order_id=o.id WHERE o.status IN ('paid','shipped')) trees,(SELECT COUNT(*) FROM sponsor_apps WHERE status='pending') pending_sponsors,(SELECT COALESCE(SUM(boxes_granted),0) FROM sponsor_apps) sponsor_boxes,(SELECT COALESCE(SUM(boxes_granted*CASE WHEN product_id='GIFT' THEN 90 ELSE 80 END),0) FROM sponsor_apps) sponsor_cost",
    ).first();
    return json({
      stats,
      orders: orders.rows,
      shipments: shipments.rows,
      sponsors: sponsors.rows,
      adoptions: [],
      claims: [],
      diary: [],
      products: products.results,
      settings: await settings(env),
    });
  }
  if (path === '/api/admin/recipient' && request.method === 'POST') {
    const b = z.object({ id: z.string() }).parse(await jsonBody(request));
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?, ?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, 'view-recipient', b.id)
      .run();
    const shipment = await env.DB.prepare(
      'SELECT recipient,phone,region_label,address,card_message,sender FROM shipments WHERE id=?',
    )
      .bind(b.id)
      .first();
    if (shipment) return json(shipment);
    const sponsor = await env.DB.prepare('SELECT address_json FROM sponsor_apps WHERE id=?')
      .bind(b.id)
      .first<any>();
    return json(sponsor ? JSON.parse(sponsor.address_json) : null);
  }
  if (path === '/api/admin/export' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      "SELECT s.*,p.box_type,o.order_no,o.stripe_payment_intent FROM shipments s JOIN products p ON s.product_id=p.id LEFT JOIN orders o ON s.source='retail' AND o.id=s.source_id WHERE s.status='reserved' ORDER BY p.box_type,s.created_at",
    ).all<any>();
    const cols = [
      'order_no',
      'box_type',
      'qty',
      'recipient',
      'phone',
      'region_label',
      'address',
      'card_message',
      'sender',
      'expected_date',
      'stripe_payment_intent',
    ];
    const labels = [
      '订单号',
      '箱型',
      '箱数',
      '收件人',
      '手机号',
      '省市区',
      '详细地址',
      '卡片寄语',
      '寄件人署名',
      '期望日期',
      'Stripe 支付 ID',
    ];
    await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
      .bind(id(), actor, 'export-shipping', String(rows.results.length))
      .run();
    return new Response(
      '\ufeff' +
        [
          labels.map(csvCell).join(','),
          ...rows.results.map((r) => cols.map((k) => csvCell(r[k])).join(',')),
        ].join('\r\n'),
      {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename=shipments.csv',
          'cache-control': 'no-store',
        },
      },
    );
  }
  if (path === '/api/admin/upload' && request.method === 'POST') {
    assert(
      Number(request.headers.get('content-length') || 0) <= 6 * 1024 * 1024,
      413,
      '文件最大 5MB',
    );
    const form = await new Response((await boundedBody(request, 6 * 1024 * 1024)) as BodyInit, {
      headers: { 'content-type': request.headers.get('content-type') || '' },
    }).formData();
    const f = form.get('file');
    assert(f instanceof File && f.size <= 5 * 1024 * 1024, 400, '请上传 5MB 内的图片或 PDF');
    assert(
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type),
      400,
      '仅支持 JPG、PNG、WebP、PDF',
    );
    let bytes = new Uint8Array(await f.arrayBuffer());
    const valid =
      f.type === 'image/png'
        ? bytes[0] === 137 && bytes[1] === 80
        : f.type === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216
          : f.type === 'image/webp'
            ? new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
            : new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
    assert(valid, 400, '文件内容与格式不匹配');
    if (f.type !== 'application/pdf') {
      try {
        bytes = sanitizeImage(bytes, f.type).bytes as Uint8Array<ArrayBuffer>;
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : '图片无效');
      }
    }
    const key =
      'apple-2026/' +
      id() +
      '.' +
      { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[
        f.type
      ];
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: f.type } });
    return json({ url: '/media/' + key });
  }
  assert(request.method === 'POST', 405, '请求方法不支持');
  const b = await jsonBody(request);
  if (path === '/api/admin/product') {
    const p = z
      .object({
        id: z.enum(['FAMILY', 'GIFT', 'PA', 'FG']),
        revision: z.number().int().nonnegative(),
        reason: z.string().trim().max(160).default(''),
        stock: z.number().int().min(0).max(1000000),
        active: z.boolean(),
        restock_date: z.string().nullable().optional(),
      })
      .parse(b);
    const current = await env.DB.prepare('SELECT stock,revision FROM products WHERE id=?')
      .bind(p.id)
      .first<{ stock: number; revision: number }>();
    assert(
      current && current.revision === p.revision,
      409,
      '库存已被订单或其他操作更新，请刷新后核对再保存',
    );
    assert(current.stock === p.stock || p.reason.length >= 2, 400, '调整库存请填写原因');
    const [, updated] = await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO inventory_adjustments(id,product_id,actor,delta,reason,revision) SELECT ?,?,?,?-stock,?,revision FROM products WHERE id=? AND revision=? AND stock!=?',
      ).bind(id(), p.id, actor, p.stock, p.reason, p.id, p.revision, p.stock),
      env.DB.prepare(
        'UPDATE products SET stock=?,active=?,restock_date=? WHERE id=? AND revision=?',
      ).bind(p.stock, p.active ? 1 : 0, p.restock_date || null, p.id, p.revision),
    ]);
    assert(updated.meta.changes === 1, 409, '库存已变化，请刷新后重新保存');
  } else if (path === '/api/admin/settings') {
    const s = z
      .object({
        remote_fee: z.number().int().min(0).max(100000),
        remote_provinces: z.array(z.string().regex(/^\d{6}$/)),
      })
      .parse(b);
    await env.DB.batch(
      Object.entries(s).map(([k, v]) =>
        env.DB.prepare(
          'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        ).bind(k, JSON.stringify(v)),
      ),
    );
  } else if (path === '/api/admin/ship') {
    const s = z
      .object({
        id: z.string().min(1).max(100),
        carrier: z.string().max(40).default('shunfeng'),
        tracking_no: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{6,32}$/, '请填写 6–32 位字母或数字单号'),
      })
      .strict()
      .parse(b);
    const carrier = resolveCarrier(s.carrier);
    assert(carrier, 400, '请选择支持的快递公司');
    assert(
      validTrackingNumber(carrier, s.tracking_no),
      400,
      '请核对快递公司与单号，顺丰单号须以 SF 开头',
    );
    const shipment = await env.DB.prepare('SELECT status FROM shipments WHERE id=?')
      .bind(s.id)
      .first<{ status: string }>();
    assert(shipment, 404, '未找到发货记录');
    assert(shipment.status === 'reserved', 409, '该记录已发货、已取消或仍待补运费，请刷新后查看');
    const [updated] = await env.DB.batch([
      env.DB.prepare(
        "UPDATE shipments SET tracking_no=?,carrier=?,status='shipped',shipped_at=CURRENT_TIMESTAMP WHERE id=? AND status='reserved'",
      ).bind(s.tracking_no, carrier.name, s.id),
      env.DB.prepare(
        "UPDATE orders SET status='shipped' WHERE id=(SELECT source_id FROM shipments WHERE id=? AND source='retail' AND status='shipped' AND tracking_no=?) AND status='paid'",
      ).bind(s.id, s.tracking_no),
      env.DB.prepare(
        "UPDATE sponsor_apps SET status='shipped' WHERE id=(SELECT source_id FROM shipments WHERE id=? AND source='sponsor' AND status='shipped' AND tracking_no=?) AND status='approved'",
      ).bind(s.id, s.tracking_no),
    ]);
    assert(updated.meta.changes === 1, 409, '发货状态已变化，请刷新后查看');
    await rebuildMap(env);
  } else if (path === '/api/admin/invoice') {
    const s = z.object({ id: z.string(), url: z.string().max(1000).default('') }).parse(b);
    assert(!s.url || s.url.startsWith('/media/apple-2026/'), 400, '请使用上传的 PDF');
    await env.DB.prepare(
      "UPDATE orders SET invoice_status='issued',invoice_url=? WHERE id=? AND status IN ('paid','shipped') AND invoice_status='requested'",
    )
      .bind(s.url, s.id)
      .run();
  } else if (path === '/api/admin/tree-photos') {
    const s = z
      .object({
        id: z.number().int(),
        photos: z.array(z.string().startsWith('/media/apple-2026/')).min(1).max(6),
      })
      .parse(b);
    await env.DB.prepare('UPDATE adoptions SET tree_photo_urls=? WHERE id=?')
      .bind(JSON.stringify(s.photos), s.id)
      .run();
  } else if (path === '/api/admin/sponsor') {
    const s = z
      .object({
        id: z.string(),
        action: z.enum(['approve', 'reject', 'photos']),
        qty: z.number().int().min(1).max(1000).optional(),
        sku: z.enum(['FAMILY', 'GIFT']).optional(),
        reason: z.string().max(300).default(''),
        photos: z.array(z.string().startsWith('/media/apple-2026/')).max(6).default([]),
        show: z.boolean().default(false),
        consent: z.boolean().default(false),
      })
      .parse(b);
    const a = await env.DB.prepare('SELECT * FROM sponsor_apps WHERE id=?').bind(s.id).first<any>();
    assert(a, 404, '申请不存在');
    if (s.action === 'approve') {
      assert(a.status === 'pending' && s.qty && s.sku, 409, '请填写赠送规格与箱数');
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE sponsor_apps SET status='approved',boxes_granted=?,product_id=? WHERE id=? AND status='pending'",
        ).bind(s.qty, s.sku, s.id),
        shipmentStatement(
          env,
          'sponsor-' + s.id,
          'sponsor',
          s.id,
          s.sku,
          s.qty,
          JSON.parse(a.address_json),
        ),
      ]);
    }
    if (s.action === 'reject') {
      assert(a.status === 'pending', 409, '只能拒绝待审核申请');
      await env.DB.prepare(
        "UPDATE sponsor_apps SET status='rejected',rejection_reason=? WHERE id=?",
      )
        .bind(s.reason, s.id)
        .run();
    }
    if (s.action === 'photos') {
      assert(['shipped', 'photo_back'].includes(a.status), 409, '请发货后记录返图');
      assert(s.photos.length, 400, '请先上传活动返图');
      assert(!s.show || s.consent, 400, '公开展示须取得组织者授权');
      await env.DB.prepare(
        "UPDATE sponsor_apps SET status='photo_back',photos=?,show_on_wall=?,photo_consent=? WHERE id=?",
      )
        .bind(JSON.stringify(s.photos), s.show ? 1 : 0, s.consent ? 1 : 0, s.id)
        .run();
    }
  } else if (path === '/api/admin/claim') {
    const s = z
      .object({
        shipment_id: z.string(),
        count: z.number().int().min(1).max(500),
        photos: z.array(z.string().startsWith('/media/apple-2026/')).min(1).max(5),
      })
      .parse(b);
    const p = await env.DB.prepare(
      "SELECT p.unit_weight_g,s.qty,p.count_per_box,o.amount paid_amount,o.discount_amount,(SELECT COALESCE(SUM(c.amount),0) FROM claims c JOIN shipments old_s ON old_s.id=c.shipment_id WHERE old_s.source='retail' AND old_s.source_id=o.id) claimed_amount FROM shipments s JOIN products p ON s.product_id=p.id LEFT JOIN orders o ON s.source='retail' AND s.source_id=o.id WHERE s.id=? AND s.status='shipped'",
    )
      .bind(s.shipment_id)
      .first<any>();
    assert(p && s.count <= p.qty * p.count_per_box, 400, '请核对坏果个数');
    const requestedAmount = s.count * (p.unit_weight_g === 350 ? 1500 : 500);
    const amount =
      p.discount_amount > 0
        ? Math.min(requestedAmount, p.paid_amount - p.claimed_amount)
        : requestedAmount;
    assert(amount > 0, 409, '优惠订单登记的赔付已达到实付金额，请核对 Stripe 可退余额');
    await env.DB.prepare('INSERT INTO claims(id,shipment_id,count,amount,photos) VALUES(?,?,?,?,?)')
      .bind(id(), s.shipment_id, s.count, amount, JSON.stringify(s.photos))
      .run();
  } else if (path === '/api/admin/claim-done') {
    const s = z.object({ id: z.string() }).parse(b);
    await env.DB.prepare("UPDATE claims SET status='refunded' WHERE id=?").bind(s.id).run();
  } else if (path === '/api/admin/diary') {
    const s = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        text: z.string().min(1).max(500),
        photos: z.array(z.string().startsWith('/media/apple-2026/')).min(1).max(6),
      })
      .parse(b);
    await env.DB.prepare('INSERT INTO diary_posts VALUES(?,?,?,?)')
      .bind(id(), s.date, s.text, JSON.stringify(s.photos))
      .run();
  } else throw new HttpError(404, '接口不存在');
  await env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(id(), actor, path, String(b.id || b.shipment_id || 'settings'))
    .run();
  return json({ ok: true });
}
