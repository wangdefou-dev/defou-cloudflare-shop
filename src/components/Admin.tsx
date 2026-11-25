import { prepareImageUpload } from './image-upload';
import '../styles/admin.css';
import '../styles/admin-app.css';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Package,
  ClipboardList,
  TreeDeciduous,
  Users,
  Settings,
  Receipt,
  Camera,
  ShieldCheck,
  Gift,
  X,
  ExternalLink,
  ShoppingBag,
} from 'lucide-react';
import { Button, ErrorBox, Field, request } from './ui';
import { money, statusNames, chinaDate } from '../lib/shared';
import { BRAND_NAME, ORIGIN_LABEL } from '../lib/content';
import { CARRIERS, resolveCarrier } from '../lib/shipping';
import AdminCoupons from './AdminCoupons';
import AdminOrderDetail, { adminTime } from './AdminOrderDetail';
import AdminPeople from './AdminPeople';
import AdminAdoptionDetail from './AdminAdoptionDetail';
import AdminGifts from './AdminGifts';
import { feature } from '../lib/store-config';
import AdminShipmentPicker from './AdminShipmentPicker';
import { shopImage } from '../lib/media';
const moduleTabs: Record<string, boolean> = {
  adoptions: feature('adoption'),
  sponsors: feature('sponsorship'),
  diary: feature('diary'),
};
const tabs = [
  ['orders', '订单', ClipboardList],
  ['customers', '用户列表', Users],
  ['shipments', '发货', Package],
  ['catalog', '商品', ShoppingBag],
  ['products', '库存与运费', Settings],
  ['coupons', '优惠券', Receipt],
  ['adoptions', '认领', TreeDeciduous],
  ['sponsors', '活动审核', Users],
  ['gifts', '赠送苹果', Gift],
  ['invoices', '发票', Receipt],
  ['claims', '坏果理赔', ShieldCheck],
  ['diary', '采摘日记', Camera],
].filter(([key]) => moduleTabs[key as string] !== false) as unknown as readonly (readonly [
  string,
  string,
  typeof Camera,
])[];
const fieldNames: Record<string, string> = {
  name: '名称',
  price: '价格',
  unit_weight_g: '单果约重（克）',
  count_per_box: '每箱个数',
  tagline: '卖点',
  description: '介绍',
  image_url: '商品图',
};
// Sponsor applications use pending for review, rather than an unpaid order.
const sponsorStatusNames: Record<string, string> = {
  pending: '待审核',
  approved: '已通过（待发货）',
  rejected: '未通过',
  shipped: '已发货',
  photo_back: '已返图',
};
export default function Admin() {
  const [data, setData] = useState<any>(null),
    [tab, setTab] = useState('orders'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<any>(null),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [success, setSuccess] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ item: any; rows: any[] | null } | null>(null);
  async function openHistory(item: any) {
    setHistory({ item, rows: null });
    try {
      setHistory({ item, rows: await request('/admin/product-changes?id=' + item.id) });
    } catch (e) {
      setHistory(null);
      setError((e as Error).message);
    }
  }
  const [adoptionId, setAdoptionId] = useState<number | null>(null);
  const managedTab = ['coupons', 'customers', 'adoptions', 'gifts'].includes(tab);
  const paginated = ['orders', 'shipments', 'invoices', 'sponsors', 'claims', 'diary'].includes(
    tab,
  );
  const [page, setPage] = useState(1),
    [pageData, setPageData] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 }),
    [listBusy, setListBusy] = useState(false);
  const listVersion = useRef(0);
  const loadList = async () => {
    if (!paginated) return;
    const version = ++listVersion.current;
    setListBusy(true);
    try {
      const next = await request('/admin/list', {
        kind: tab,
        page,
        page_size: 20,
        search: query,
        status,
        from,
        to,
      });
      if (version === listVersion.current) setPageData(next);
    } finally {
      if (version === listVersion.current) setListBusy(false);
    }
  };
  const load = async () => {
    await Promise.all([request('/admin/data?summary=1').then(setData), loadList()]);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadList().catch((e) => setError(e.message));
    }, 200);
    return () => {
      clearTimeout(timer);
      listVersion.current++;
    };
  }, [tab, page, query, status, from, to]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  function changeTab(next: string) {
    setTab(next);
    setPage(1);
    setPageData({ rows: [], total: 0 });
    setQuery('');
    setStatus(next === 'sponsors' ? 'pending' : '');
    setFrom('');
    setTo('');
    setError('');
    setSuccess('');
  }
  async function refresh() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, b: any) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request('/admin/' + path, b);
      setModal(null);
      setSuccess('已保存');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return [];
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set('file', await prepareImageUpload(file));
      const r = await fetch('/api/admin/upload', { method: 'POST', body: form }),
        v: any = await r.json();
      if (!r.ok) throw Error(v.error);
      urls.push(v.url);
    }
    return urls;
  }
  async function action(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const photos = await upload(
        f
          .getAll('files')
          .filter((x) => x instanceof File && (x as File).size > 0) as unknown as FileList,
      );
      const m = modal;
      let p = '',
        b: any = { id: m.item?.id };
      if (m.kind === 'ship') {
        p = 'ship';
        b.carrier = f.get('carrier');
        b.tracking_no = String(f.get('tracking_no')).trim().toUpperCase();
      }
      if (m.kind === 'product') {
        p = 'product';
        Object.assign(b, {
          stock: Number(f.get('stock')),
          revision: m.item.revision,
          reason: String(f.get('adjustment_reason') || ''),
          active: f.get('active') === 'on',
          restock_date: f.get('restock_date') || null,
        });
      }
      if (m.kind === 'content') {
        p = 'product-content';
        const x = m.item,
          price = Math.round(Number(f.get('price')) * 100);
        if (
          price !== x.price &&
          !confirm(
            `确认把「${x.name}」从 ¥${money(x.price)} 改为 ¥${money(price)}？已付款订单不受影响。`,
          )
        ) {
          setBusy(false);
          return;
        }
        b = {
          id: x.id,
          content_revision: x.content_revision,
          name: String(f.get('name') || '').trim(),
          price,
          unit_weight_g: Number(f.get('unit_weight_g')),
          count_per_box: Number(f.get('count_per_box') || x.count_per_box),
          tagline: String(f.get('tagline') || '').trim(),
          description: String(f.get('description') || '').trim(),
          image_url: photos[0] || (f.get('reset_image') === 'on' ? null : x.image_url || null),
          reason: String(f.get('price_reason') || '').trim(),
        };
      }
      if (m.kind === 'tree') {
        p = 'tree-photos';
        b.photos = photos;
      }
      if (m.kind === 'approve') {
        p = 'sponsor';
        Object.assign(b, { action: 'approve', qty: Number(f.get('qty')), sku: f.get('sku') });
      }
      if (m.kind === 'reject') {
        p = 'sponsor';
        Object.assign(b, { action: 'reject', reason: f.get('reason') || '' });
      }
      if (m.kind === 'photos') {
        p = 'sponsor';
        Object.assign(b, {
          action: 'photos',
          photos,
          show: f.get('show') === 'on',
          consent: f.get('consent') === 'on',
        });
      }
      if (m.kind === 'invoice') {
        p = 'invoice';
        b.url = photos[0] || '';
      }
      if (m.kind === 'claim') {
        p = 'claim';
        b = { shipment_id: f.get('shipment_id'), count: Number(f.get('count')), photos };
      }
      if (m.kind === 'diary') {
        p = 'diary';
        b = { date: f.get('date'), text: f.get('text'), photos };
      }
      await mutate(p, b);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function details(id: string) {
    setError('');
    try {
      const recipient = await request('/admin/recipient', { id });
      setModal({ kind: 'recipient', item: recipient });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const list = paginated
    ? pageData.rows
    : (data?.[tab === 'catalog' ? 'products' : tab] || []).filter(
        (o: any) => !query || JSON.stringify(o).toLowerCase().includes(query.toLowerCase()),
      );
  const fields = (m: any) => {
    const x = m.item;
    return (
      <>
        {m.kind === 'ship' && (
          <>
            <p>
              {x.box_type} · {x.qty} 箱 · {x.recipient}
            </p>
            <Field label="快递公司">
              <select
                name="carrier"
                required
                defaultValue={resolveCarrier(x.carrier)?.code || 'shunfeng'}
                disabled={busy}
              >
                {CARRIERS.map((carrier) => (
                  <option key={carrier.code} value={carrier.code}>
                    {carrier.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="快递单号">
              <input
                name="tracking_no"
                required
                pattern="[A-Za-z0-9]{6,32}"
                minLength={6}
                maxLength={32}
                placeholder="请输入所选快递公司的单号"
                autoComplete="off"
                disabled={busy}
              />
            </Field>
            <p className="fine-print">请确认包裹已交寄，保存后将标记为已发货。</p>
          </>
        )}
        {m.kind === 'product' && (
          <>
            <Field label="可售库存 / 剩余认领名额">
              <input
                name="stock"
                type="number"
                required
                min="0"
                max="1000000"
                defaultValue={x.stock}
              />
            </Field>
            <Field label="库存调整原因（改数量时必填）">
              <input name="adjustment_reason" maxLength={160} placeholder="如：盘点补入 20 箱" />
            </Field>
            <Field label="下一批日期（选填）">
              <input name="restock_date" type="date" defaultValue={x.restock_date || ''} />
            </Field>
            <label className="check-row">
              <input name="active" type="checkbox" defaultChecked={!!x.active} />
              上架
            </label>
            <p className="fine-print">这里的库存为扣除待付款锁定数后的可售数量。</p>
          </>
        )}
        {m.kind === 'content' && (
          <>
            <Field label="商品名称">
              <input name="name" required maxLength={20} defaultValue={x.name} />
            </Field>
            <Field label="价格（元）">
              <input
                name="price"
                type="number"
                required
                min="1"
                max="100000"
                step="0.01"
                defaultValue={x.price / 100}
              />
            </Field>
            <Field label="改价原因（改价格时必填）">
              <input name="price_reason" maxLength={160} placeholder="如：季末调价" />
            </Field>
            <Field label="单果约重（克）">
              <input
                name="unit_weight_g"
                type="number"
                required
                min="1"
                max="5000"
                defaultValue={x.unit_weight_g || ''}
              />
            </Field>
            {['FAMILY', 'GIFT'].includes(x.id) ? (
              <Field label="每箱个数">
                <input
                  name="count_per_box"
                  type="number"
                  required
                  min="1"
                  max="500"
                  defaultValue={x.count_per_box || ''}
                />
              </Field>
            ) : (
              <p className="fine-print">认领树的箱数与每箱斤数按认领规则固定，这里不能修改。</p>
            )}
            <Field label="一句话卖点（选填，40 字内）">
              <input name="tagline" maxLength={40} defaultValue={x.tagline || ''} />
            </Field>
            <Field label="商品介绍（选填，300 字内）">
              <textarea
                name="description"
                maxLength={300}
                rows={4}
                defaultValue={x.description || ''}
              />
            </Field>
            <Field label="更换商品图（选填，JPG / PNG / WebP，最多 5MB）">
              <input name="files" type="file" accept="image/jpeg,image/png,image/webp" />
            </Field>
            {x.image_url && (
              <label className="check-row">
                <input name="reset_image" type="checkbox" />
                恢复默认商品图（当前使用上传的图片）
              </label>
            )}
            <p className="fine-print">
              保存后，下单页、首页商品卡和商品详情页立即显示新内容；已付款订单保持原金额。常见问题里的文字说明和搜索引擎信息在下次部署后更新。
            </p>
          </>
        )}
        {m.kind === 'approve' && (
          <>
            <Field label="赠送规格">
              <select name="sku">
                <option value="FAMILY">零售家庭装</option>
                <option value="GIFT">零售礼盒</option>
              </select>
            </Field>
            <Field label="赠送箱数">
              <input name="qty" required type="number" min="1" max="1000" />
            </Field>
          </>
        )}
        {m.kind === 'reject' && (
          <Field label="未通过原因（选填）">
            <textarea name="reason" maxLength={300} />
          </Field>
        )}
        {m.kind === 'claim' && (
          <>
            <AdminShipmentPicker />
            <Field label="坏果个数">
              <input name="count" required type="number" min="1" max="500" />
            </Field>
            <p className="fine-print">
              250g 规格 ¥5 / 个，350g 规格 ¥15 /
              个。优惠订单累计赔付不超过实付金额。系统登记后，请核对 Stripe 剩余可退余额并完成退款。
            </p>
          </>
        )}
        {m.kind === 'diary' && (
          <>
            <Field label="日期">
              <input name="date" type="date" required defaultValue={chinaDate()} />
            </Field>
            <Field label="果园里发生了什么">
              <textarea
                name="text"
                maxLength={500}
                rows={4}
                required
                placeholder={`只记录苹果与农事；产地写${ORIGIN_LABEL}，不写家人身份、村名或具体位置。`}
              />
            </Field>
          </>
        )}
        {['tree', 'photos', 'claim', 'diary', 'invoice'].includes(m.kind) && (
          <Field
            label={m.kind === 'invoice' ? '上传已开票 PDF（选填）' : '上传照片（每张最多 5MB）'}
          >
            <input
              name="files"
              type="file"
              accept={m.kind === 'invoice' ? 'application/pdf' : 'image/jpeg,image/png,image/webp'}
              multiple={m.kind !== 'invoice'}
              required={m.kind !== 'invoice'}
            />
          </Field>
        )}
        {['tree', 'photos', 'diary'].includes(m.kind) && (
          <p className="fine-print">
            图片会自动压缩并清除定位等元数据。上传前仍请检查人脸、门牌、路牌、车牌和快递面单；果园产地使用“
            {ORIGIN_LABEL}”，树牌建议使用昵称。不要上传可识别家人或住址的素材。
          </p>
        )}
        {m.kind === 'photos' && (
          <>
            <label className="check-row">
              <input type="checkbox" name="consent" />
              已取得组织者公开展示授权
            </label>
            <label className="check-row">
              <input type="checkbox" name="show" />
              公开展示到活动墙
            </label>
          </>
        )}
        {m.kind === 'invoice' && (
          <div className="invoice-details">
            {Object.entries(JSON.parse(x.invoice || '{}')).map(([k, v]) => (
              <p key={k}>
                {({ type: '类型', title: '抬头', tax_no: '税号', email: '接收邮箱' } as any)[k]}：
                {String(v)}
              </p>
            ))}
          </div>
        )}
      </>
    );
  };
  const actions = (x: any) => (
    <>
      {['orders', 'invoices'].includes(tab) && (
        <button onClick={() => setOrderId(x.id)}>查看订单详情</button>
      )}
      {tab === 'orders' && x.status === 'pending' && <small>等待支付回调</small>}
      {tab === 'shipments' && (
        <>
          <button onClick={() => details(x.id)}>查看收件信息</button>
          {x.status === 'reserved' && (
            <button onClick={() => setModal({ kind: 'ship', item: x })}>填写单号</button>
          )}
        </>
      )}
      {tab === 'catalog' && (
        <>
          <button onClick={() => setModal({ kind: 'content', item: x })}>编辑</button>
          <button onClick={() => openHistory(x)}>修改记录</button>
        </>
      )}
      {tab === 'products' && (
        <button onClick={() => setModal({ kind: 'product', item: x })}>调整库存</button>
      )}
      {tab === 'adoptions' && (
        <button onClick={() => setModal({ kind: 'tree', item: x })}>上传树照</button>
      )}
      {tab === 'sponsors' && (
        <>
          <button onClick={() => details(x.id)}>查看收件信息</button>
          {x.status === 'pending' && (
            <>
              <button onClick={() => setModal({ kind: 'approve', item: x })}>通过</button>
              <button onClick={() => setModal({ kind: 'reject', item: x })}>未通过</button>
            </>
          )}
          {['shipped', 'photo_back'].includes(x.status) && (
            <button onClick={() => setModal({ kind: 'photos', item: x })}>返图与展示</button>
          )}
        </>
      )}
      {tab === 'invoices' &&
        x.invoice_status === 'requested' &&
        ['paid', 'shipped'].includes(x.status) && (
          <button onClick={() => setModal({ kind: 'invoice', item: x })}>标记已开票</button>
        )}
      {tab === 'claims' && x.status !== 'refunded' && (
        <>
          <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noreferrer">
            去 Stripe 退款 ↗
          </a>
          <button onClick={() => mutate('claim-done', { id: x.id })}>记录退款完成</button>
        </>
      )}
    </>
  );
  const unit = (x: any) => (['PA', 'FG'].includes(x.sku) || x.type === 'adoption' ? '棵' : '箱');
  const tag = (label: string, key = '') => (
    <span className={'status-tag ' + key}>{label || key}</span>
  );
  // One table per list. Text-heavy columns wrap; everything else stays on one line.
  const columns: Record<string, [string, (x: any) => any][]> = {
    orders: [
      ['订单号', (x) => <code>{x.order_no}</code>],
      ['商品', (x) => x.product_name || '预约运费'],
      ['数量', (x) => `${x.qty || 1} ${unit(x)}`],
      ['金额', (x) => '¥' + money(x.amount)],
      ['手机号', (x) => x.phone],
      ['状态', (x) => tag(statusNames[x.status], x.status)],
      ['下单时间', (x) => adminTime(x.created_at)],
    ],
    shipments: [
      ['规格', (x) => x.box_type],
      ['箱数', (x) => x.qty],
      ['收件人', (x) => `${x.recipient} · ${x.phone}`],
      ['地区', (x) => x.region_label],
      ['期望发货', (x) => x.expected_date || '付款后 48 小时内'],
      ['运单号', (x) => x.tracking_no || '—'],
      ['状态', (x) => tag(statusNames[x.status], x.status)],
    ],
    catalog: [
      [
        '商品',
        (x) => (
          <div className="cell-product">
            <img src={x.image_url || shopImage(x.sku).thumbnail || shopImage(x.sku).src} alt="" />
            <div className="cell-stack">
              <strong>{x.name}</strong>
              <small>{x.tagline || '未填写卖点'}</small>
            </div>
          </div>
        ),
      ],
      ['价格', (x) => '¥' + money(x.price)],
      [
        '规格',
        (x) =>
          ['PA', 'FG'].includes(x.sku)
            ? `认领 · 单果约 ${x.unit_weight_g}g`
            : `${x.count_per_box} 个 / 箱 · 单果约 ${x.unit_weight_g}g`,
      ],
      ['介绍', (x) => <span className="cell-clip">{x.description || '—'}</span>],
      ['图片', (x) => (x.image_url ? '已上传' : '默认图')],
      ['最近修改', (x) => (x.content_updated_at ? adminTime(x.content_updated_at) : '—')],
    ],
    products: [
      ['商品', (x) => <strong>{x.name}</strong>],
      ['可售', (x) => `${x.stock} ${unit(x)}`],
      ['状态', (x) => tag(x.active ? '已上架' : '已下架', x.active ? 'paid' : 'expired')],
      ['下一批', (x) => x.restock_date || '—'],
      ['箱型', (x) => x.box_type],
    ],
    sponsors: [
      [
        '活动',
        (x) => (
          <div className="cell-stack">
            <strong>{x.event_name}</strong>
            <small>{x.reason}</small>
            {x.link && (
              <a href={x.link} target="_blank" rel="noreferrer">
                活动链接 ↗
              </a>
            )}
          </div>
        ),
      ],
      ['主办方', (x) => x.org_name],
      ['人数', (x) => x.headcount],
      ['活动日期', (x) => x.event_date],
      ['联系人', (x) => `${x.contact} · ${x.phone}${x.wechat ? ' · 微信 ' + x.wechat : ''}`],
      ['状态', (x) => tag(sponsorStatusNames[x.status] || x.status, x.status)],
      [
        '编号',
        (x) => (
          <div className="cell-stack">
            <code>{x.app_no}</code>
            <small>{adminTime(x.created_at)}</small>
          </div>
        ),
      ],
    ],
    invoices: [
      ['订单号', (x) => <code>{x.order_no}</code>],
      ['金额', (x) => '¥' + money(x.amount)],
      ['开票状态', (x) => tag(statusNames[x.invoice_status], x.invoice_status)],
      ['说明', () => '发票内容与接收邮箱见订单详情'],
    ],
    claims: [
      ['坏果', (x) => `${x.count} 个`],
      ['应赔', (x) => '¥' + money(x.amount)],
      [
        '状态',
        (x) =>
          tag(
            x.status === 'refunded' ? '已退款' : '待退款',
            x.status === 'refunded' ? 'refunded' : 'pending',
          ),
      ],
      ['发货记录', (x) => <code>{x.shipment_id}</code>],
    ],
    diary: [
      ['日期', (x) => x.date],
      ['内容', (x) => <span className="cell-wrap">{x.text}</span>],
    ],
  };
  const pendingCount: Record<string, number> = {
    sponsors: data?.stats.pending_sponsors || 0,
    shipments: data?.stats.pending_boxes || 0,
  };
  const current = tabs.find((t) => t[0] === tab);
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <strong>{BRAND_NAME}</strong>
          <span>运营后台</span>
        </div>
        <nav className="admin-nav" aria-label="后台功能">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? 'selected' : ''}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => changeTab(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {pendingCount[key] > 0 && (
                <span className="admin-nav-count">{pendingCount[key]}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <a href="/api/admin/export">
            <ArrowDownToLine size={16} /> 导出待发货清单
          </a>
          <a href="/" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> 打开店铺
          </a>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <h1>{current?.[1]}</h1>
          {data && (
            <dl className="admin-stats">
              <div>
                <dt>销售额（扣退款）</dt>
                <dd>¥{money(data.stats.revenue)}</dd>
              </div>
              <div>
                <dt>待发货</dt>
                <dd>{data.stats.pending_boxes} 箱</dd>
              </div>
              <div>
                <dt>认领</dt>
                <dd>{data.stats.trees} 棵</dd>
              </div>
              <button type="button" onClick={() => changeTab('sponsors')}>
                <dt>待审核活动</dt>
                <dd>{data.stats.pending_sponsors} 场</dd>
              </button>
            </dl>
          )}
        </header>
        <div className="admin-body">
          <ErrorBox text={error} />
          {success && (
            <p role="status" className="alert success">
              {success}
            </p>
          )}
          {data?.settings.sales_paused && (
            <p className="alert">
              店铺当前<strong>暂停接单</strong>，可在「网站设置 → 接单与运费」中恢复。
            </p>
          )}
          {!data && !error && <p className="admin-loading">正在读取…</p>}
          {data && (
            <>
              <div className="admin-toolbar">
                {!managedTab && (
                  <div className="admin-filters">
                    <input
                      type="search"
                      aria-label="搜索记录"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder={
                        tab === 'sponsors'
                          ? '搜索申请编号 / 活动 / 主办方'
                          : ['catalog', 'products'].includes(tab)
                            ? '搜索商品名称'
                            : '搜索订单号 / 名称 / 规格'
                      }
                    />
                    {paginated && (
                      <>
                        <select
                          aria-label="筛选状态"
                          value={status}
                          onChange={(e) => {
                            setStatus(e.target.value);
                            setPage(1);
                          }}
                        >
                          <option value="">全部状态</option>
                          {Object.entries(
                            tab === 'sponsors' ? sponsorStatusNames : statusNames,
                          ).map(([v, label]) => (
                            <option value={v} key={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="开始日期"
                          type="date"
                          value={from}
                          onChange={(e) => {
                            setFrom(e.target.value);
                            setPage(1);
                          }}
                        />
                        <span className="admin-filter-sep">至</span>
                        <input
                          aria-label="结束日期"
                          type="date"
                          value={to}
                          onChange={(e) => {
                            setTo(e.target.value);
                            setPage(1);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
                <div className="admin-toolbar-actions">
                  {tab === 'sponsors' && (
                    <button className="small-button" disabled={busy} onClick={refresh}>
                      {busy ? '正在刷新…' : '刷新'}
                    </button>
                  )}
                  {['claims', 'diary'].includes(tab) && (
                    <button
                      className="small-button primary"
                      onClick={() => setModal({ kind: tab === 'claims' ? 'claim' : 'diary' })}
                    >
                      + 新增
                    </button>
                  )}
                </div>
              </div>
              {tab === 'sponsors' && (
                <p className="admin-note">
                  本季已批准 {data.stats.sponsor_boxes} 箱，估算成本 ¥{data.stats.sponsor_cost}
                  （不设上限，按人工审核）。
                </p>
              )}
              {tab === 'coupons' && <AdminCoupons />}
              {tab === 'gifts' && <AdminGifts />}
              {(tab === 'customers' || tab === 'adoptions') && (
                <AdminPeople
                  key={tab}
                  kind={tab}
                  refreshToken={data}
                  onOrder={setOrderId}
                  onAdoption={setAdoptionId}
                  onPhotos={(row) => setModal({ kind: 'tree', item: row })}
                />
              )}
              {!managedTab && columns[tab] && (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        {columns[tab].map(([label]) => (
                          <th key={label}>{label}</th>
                        ))}
                        {tab !== 'diary' && <th className="actions-col">操作</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((x: any) => (
                        <tr key={x.id}>
                          {columns[tab].map(([label, cell]) => (
                            <td key={label} data-label={label}>
                              {cell(x)}
                            </td>
                          ))}
                          {tab !== 'diary' && <td className="record-actions">{actions(x)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!list.length && (
                    <div className="admin-empty">
                      <Package size={32} strokeWidth={1.2} />
                      <p>
                        {listBusy
                          ? '正在读取…'
                          : tab === 'sponsors'
                            ? status === 'pending' && !query && !from && !to
                              ? '暂无待审核活动'
                              : '没有匹配的活动申请'
                            : '没有记录'}
                      </p>
                      {tab === 'sponsors' && status && (
                        <button className="small-button" onClick={() => setStatus('')}>
                          查看全部申请
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {paginated && (
                <div className="admin-pagination" aria-label="列表分页">
                  <span>{listBusy ? '正在读取…' : `共 ${pageData.total} 条 · 第 ${page} 页`}</span>
                  <button
                    type="button"
                    className="small-button"
                    disabled={page <= 1 || listBusy}
                    onClick={() => setPage(page - 1)}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    className="small-button"
                    disabled={page * 20 >= pageData.total || listBusy}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {adoptionId && (
        <AdminAdoptionDetail
          key={adoptionId}
          id={adoptionId}
          onClose={() => setAdoptionId(null)}
          onUpdated={load}
          onOrder={(id) => {
            setAdoptionId(null);
            setOrderId(id);
          }}
        />
      )}
      {orderId && (
        <AdminOrderDetail
          key={orderId}
          orderId={orderId}
          onClose={() => setOrderId(null)}
          onUpdated={load}
          onAdoption={(id) => {
            setOrderId(null);
            setAdoptionId(id);
          }}
        />
      )}
      {history && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setHistory(null)}
        >
          <div
            className="modal admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <button className="modal-close" aria-label="关闭" onClick={() => setHistory(null)}>
              <X size={20} />
            </button>
            <h2 id="history-title">{history.item.name} · 修改记录</h2>
            {!history.rows && <p>正在读取…</p>}
            {history.rows && !history.rows.length && <p>还没有修改记录。</p>}
            <ol className="admin-history">
              {(history.rows || []).map((r: any, i: number) => {
                const before = JSON.parse(r.before_json),
                  after = JSON.parse(r.after_json);
                return (
                  <li key={i}>
                    <small>
                      {adminTime(r.created_at)} · {r.actor}
                    </small>
                    {Object.keys(after).map((k) => (
                      <p key={k}>
                        <b>{fieldNames[k] || k}</b>
                        {k === 'price'
                          ? ` ¥${money(before[k])} → ¥${money(after[k])}`
                          : k === 'description' || k === 'image_url'
                            ? ' 已更新'
                            : ` ${before[k] ?? '—'} → ${after[k] ?? '—'}`}
                      </p>
                    ))}
                    {r.reason && <p className="fine-print">原因：{r.reason}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <div
            className="modal admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button className="modal-close" aria-label="关闭" onClick={() => setModal(null)}>
              <X size={20} />
            </button>
            <h2 id="modal-title">
              {
                (
                  {
                    ship: '安排发货',
                    product: '调整库存',
                    content: '编辑商品',
                    tree: '上传专属树照',
                    approve: '通过赞助申请',
                    reject: '未通过申请',
                    photos: '记录活动返图',
                    invoice: '发票处理',
                    claim: '登记坏果理赔',
                    diary: '写一篇采摘日记',
                    recipient: '收件信息',
                  } as any
                )[modal.kind]
              }
            </h2>
            {modal.kind === 'recipient' ? (
              <div>
                {modal.item ? (
                  Object.entries(modal.item).map(([k, v]) => (
                    <p key={k}>
                      <small>
                        {(
                          {
                            recipient: '收件人',
                            phone: '手机号',
                            region_label: '省市区',
                            address: '详细地址',
                            card_message: '寄语',
                            sender: '署名',
                          } as any
                        )[k] || k}
                        ：
                      </small>
                      {String(v || '—')}
                    </p>
                  ))
                ) : (
                  <p>没有收件信息</p>
                )}
              </div>
            ) : (
              <form onSubmit={action}>
                {fields(modal)}
                <ErrorBox text={error} />
                <Button busy={busy}>保存</Button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
