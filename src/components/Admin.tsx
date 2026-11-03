import site from '../../config/site.json';
import { prepareImageUpload } from './image-upload';
import '../styles/admin.css';
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
} from 'lucide-react';
import { Button, ErrorBox, Field, PageIntro, request } from './ui';
import { money, statusNames, chinaDate } from '../lib/shared';
import { ORIGIN_LABEL } from '../lib/content';
import { CARRIERS, resolveCarrier } from '../lib/shipping';
import AdminCoupons from './AdminCoupons';
import AdminOrderDetail, { adminTime } from './AdminOrderDetail';
import AdminPeople from './AdminPeople';
import AdminAdoptionDetail from './AdminAdoptionDetail';
import AdminGifts from './AdminGifts';
import AdminShipmentPicker from './AdminShipmentPicker';
const allTabs = [
  ['orders', '订单', ClipboardList],
  ['customers', '用户列表', Users],
  ['shipments', '发货', Package],
  ['products', '库存与运费', Settings],
  ['coupons', '优惠券', Receipt],
  ['adoptions', '认领', TreeDeciduous],
  ['sponsors', '活动审核', Users],
  ['gifts', '赠送苹果', Gift],
  ['invoices', '发票', Receipt],
  ['claims', '坏果理赔', ShieldCheck],
  ['diary', '采摘日记', Camera],
] as const;
const tabs = allTabs.filter(
  ([id]) =>
    site.features.orchard || !['adoptions', 'sponsors', 'gifts', 'claims', 'diary'].includes(id),
);
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
      if (m.kind === 'settings') {
        p = 'settings';
        b = {
          remote_fee: Math.round(Number(f.get('remote_fee')) * 100),
          remote_provinces: String(f.get('remote_provinces'))
            .split(/[,，\s]+/)
            .filter(Boolean),
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
    : (data?.[tab] || []).filter(
        (o: any) =>
          (tab !== 'products' ||
            site.features.orchard ||
            !['FAMILY', 'GIFT', 'PA', 'FG'].includes(o.sku)) &&
          (!query || JSON.stringify(o).toLowerCase().includes(query.toLowerCase())),
      );
  const fields = (m: any) => {
    const x = m.item;
    return (
      <>
        {m.kind === 'ship' && (
          <>
            <p>
              {x.box_type} · {x.qty} 件 · {x.recipient}
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
            <Field label="可售库存">
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
              <input name="adjustment_reason" maxLength={160} placeholder="如：盘点补入 20 件" />
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
        {m.kind === 'settings' && (
          <>
            <Field label="偏远运费（元 / 件）">
              <input
                name="remote_fee"
                type="number"
                required
                min="0"
                max="1000"
                step="0.01"
                defaultValue={data.settings.remote_fee / 100}
              />
            </Field>
            <Field label="偏远省份行政代码（逗号分隔）">
              <textarea
                name="remote_provinces"
                defaultValue={data.settings.remote_provinces.join(',')}
              />
            </Field>
            <small>默认：150000 内蒙古、460000 海南、540000 西藏、630000 青海、650000 新疆。</small>
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
  return (
    <div className="admin-wrap">
      <div className="admin-heading">
        <PageIntro eyebrow="DEFOU SHOP / OPERATIONS" title="把每一份订单，安排好">
          商店运营台 · {site.season.label}
        </PageIntro>
        <a className="button secondary" href="/api/admin/export">
          <ArrowDownToLine size={17} />
          导出待发货清单
        </a>
      </div>
      <ErrorBox text={error} />
      {success && (
        <p role="status" className="alert success">
          {success}
        </p>
      )}
      {data && (
        <>
          <div className="admin-metrics">
            <div>
              <small>已支付销售额</small>
              <strong>¥{money(data.stats.revenue)}</strong>
            </div>
            <div>
              <small>待发货</small>
              <strong>
                {data.stats.pending_boxes}
                <em>件</em>
              </strong>
            </div>
            {site.features.orchard && (
              <>
                <div>
                  <small>认领苹安树</small>
                  <strong>
                    {data.stats.trees}
                    <em>棵</em>
                  </strong>
                </div>
                <button
                  type="button"
                  className="admin-review-entry"
                  onClick={() => changeTab('sponsors')}
                  aria-label={`查看待审核活动，${data.stats.pending_sponsors} 场`}
                >
                  <small>待审核活动</small>
                  <strong>
                    {data.stats.pending_sponsors}
                    <em>场</em>
                  </strong>
                  <span className="admin-metric-action">查看申请 →</span>
                </button>
              </>
            )}
          </div>
          <div className="admin-shell">
            <nav className="admin-nav" aria-label="后台功能">
              {tabs.map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={tab === key ? 'selected' : ''}
                  onClick={() => changeTab(key)}
                >
                  <Icon size={18} />
                  {label}
                  {key === 'sponsors' && data.stats.pending_sponsors > 0 && (
                    <span className="admin-nav-count">{data.stats.pending_sponsors}</span>
                  )}
                </button>
              ))}
            </nav>
            <section className="admin-content">
              <div className="admin-toolbar">
                <h2>{tabs.find((t) => t[0] === tab)?.[1]}</h2>
                {tab === 'sponsors' && (
                  <button className="small-button" disabled={busy} onClick={refresh}>
                    {busy ? '正在刷新…' : '刷新列表'}
                  </button>
                )}
                {tab === 'products' && (
                  <button className="small-button" onClick={() => setModal({ kind: 'settings' })}>
                    偏远运费设置
                  </button>
                )}
                {['claims', 'diary'].includes(tab) && (
                  <button
                    className="small-button"
                    onClick={() => setModal({ kind: tab === 'claims' ? 'claim' : 'diary' })}
                  >
                    + 新增记录
                  </button>
                )}
              </div>
              {tab === 'sponsors' && (
                <p className="alert">
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
              <div className="admin-filters" hidden={managedTab}>
                <input
                  aria-label="搜索记录"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder={
                    tab === 'sponsors' ? '搜索申请编号 / 活动 / 主办方' : '搜索订单号 / 名称 / 规格'
                  }
                />
                <select
                  aria-label="筛选状态"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部状态</option>
                  {Object.entries(tab === 'sponsors' ? sponsorStatusNames : statusNames).map(
                    ([v, label]) => (
                      <option value={v} key={v}>
                        {label}
                      </option>
                    ),
                  )}
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
                <input
                  aria-label="结束日期"
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
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
              <div className="admin-records" hidden={managedTab}>
                {!list.length && (
                  <div className="empty-state">
                    <Package size={45} strokeWidth={1} />
                    <h3>
                      {tab === 'sponsors'
                        ? status === 'pending' && !query && !from && !to
                          ? '暂无待审核活动'
                          : '没有匹配的活动申请'
                        : '还没有相关记录'}
                    </h3>
                    <p>
                      {tab === 'sponsors'
                        ? '新申请会出现在这里，点击「刷新列表」获取最新记录。'
                        : '新的心意到来时，会出现在这里。'}
                    </p>
                    {tab === 'sponsors' && (
                      <button
                        className="small-button"
                        onClick={() => {
                          changeTab('sponsors');
                          setStatus('');
                        }}
                      >
                        查看全部申请
                      </button>
                    )}
                  </div>
                )}
                {list.map((x: any) => (
                  <article className="admin-record" key={x.id}>
                    <div className="record-main">
                      {tab === 'orders' && (
                        <>
                          <div>
                            <strong>{x.order_no}</strong>
                            <span className={'status-tag ' + x.status}>
                              {statusNames[x.status]}
                            </span>
                          </div>
                          <p>
                            {x.product_name || '预约运费'} · {x.qty || 1}{' '}
                            {x.type === 'adoption' ? '棵' : '件'} · {x.phone} · ¥{money(x.amount)}
                          </p>
                          <small>{adminTime(x.created_at)}（北京时间）</small>
                          {x.stripe_payment_intent && (
                            <p className="fine-print">Stripe：{x.stripe_payment_intent}</p>
                          )}
                        </>
                      )}
                      {tab === 'shipments' && (
                        <>
                          <div>
                            <strong>
                              {x.box_type} · {x.qty} 件
                            </strong>
                            <span className={'status-tag ' + x.status}>
                              {statusNames[x.status]}
                            </span>
                          </div>
                          <p>
                            {x.recipient} · {x.phone} · {x.region_label}
                          </p>
                          <small>
                            期望发货：{x.expected_date || '付款后 48 小时内'}{' '}
                            {x.tracking_no && ' · ' + x.tracking_no}
                          </small>
                        </>
                      )}
                      {tab === 'products' && (
                        <>
                          <strong>{x.name}</strong>
                          <p>
                            ¥{money(x.price)} · 可售 {x.stock} {x.unit || '件'} ·{' '}
                            {x.active ? '已上架' : '已下架'}
                          </p>
                          <small>
                            {x.box_type} {x.restock_date && ' · 下一批 ' + x.restock_date}
                          </small>
                        </>
                      )}
                      {tab === 'adoptions' && (
                        <>
                          <strong>
                            {x.adopt_code} · {x.plate_name}
                          </strong>
                          <p>
                            {x.phone} · 剩余 {x.total_boxes - x.used_boxes} / {x.total_boxes} 箱
                          </p>
                          <small>已上传 {JSON.parse(x.tree_photo_urls).length} 张照片</small>
                        </>
                      )}
                      {tab === 'sponsors' && (
                        <>
                          <div>
                            <strong>{x.event_name}</strong>
                            <span className="status-tag">
                              {sponsorStatusNames[x.status] || x.status}
                            </span>
                          </div>
                          <p>
                            {x.org_name} · {x.headcount} 人 · {x.event_date}
                          </p>
                          <small>
                            {x.app_no} · 提交于 {adminTime(x.created_at)}
                          </small>
                          <p>{x.reason}</p>
                          <small>
                            {x.contact} · {x.phone} {x.wechat && ' · 微信 ' + x.wechat}
                          </small>
                          {x.link && (
                            <p>
                              <a href={x.link} target="_blank" rel="noreferrer">
                                查看活动链接 ↗
                              </a>
                            </p>
                          )}
                        </>
                      )}
                      {tab === 'invoices' && (
                        <>
                          <strong>
                            {x.order_no} · ¥{money(x.amount)}
                          </strong>
                          <p>发票内容与接收邮箱请在订单详情查看</p>
                          <span className="status-tag">{statusNames[x.invoice_status]}</span>
                        </>
                      )}
                      {tab === 'claims' && (
                        <>
                          <strong>
                            坏果 {x.count} 个 · 应赔 ¥{money(x.amount)}
                          </strong>
                          <p>{x.status === 'refunded' ? '已记录退款完成' : '待 Stripe 部分退款'}</p>
                          <small>发货记录：{x.shipment_id}</small>
                        </>
                      )}
                      {tab === 'diary' && (
                        <>
                          <strong>{x.date}</strong>
                          <p>{x.text}</p>
                        </>
                      )}
                    </div>
                    <div className="record-actions">
                      {['orders', 'invoices'].includes(tab) && (
                        <button onClick={() => setOrderId(x.id)}>查看订单详情</button>
                      )}
                      {tab === 'orders' && x.status === 'pending' && <small>等待支付回调</small>}
                      {tab === 'shipments' && (
                        <>
                          <button onClick={() => details(x.id)}>查看收件信息</button>
                          {x.status === 'reserved' && (
                            <button onClick={() => setModal({ kind: 'ship', item: x })}>
                              填写单号
                            </button>
                          )}
                        </>
                      )}
                      {tab === 'products' && (
                        <button onClick={() => setModal({ kind: 'product', item: x })}>
                          调整库存
                        </button>
                      )}
                      {tab === 'adoptions' && (
                        <button onClick={() => setModal({ kind: 'tree', item: x })}>
                          上传树照
                        </button>
                      )}
                      {tab === 'sponsors' && (
                        <>
                          <button onClick={() => details(x.id)}>查看收件信息</button>
                          {x.status === 'pending' && (
                            <>
                              <button onClick={() => setModal({ kind: 'approve', item: x })}>
                                通过
                              </button>
                              <button onClick={() => setModal({ kind: 'reject', item: x })}>
                                未通过
                              </button>
                            </>
                          )}
                          {['shipped', 'photo_back'].includes(x.status) && (
                            <button onClick={() => setModal({ kind: 'photos', item: x })}>
                              返图与展示
                            </button>
                          )}
                        </>
                      )}
                      {tab === 'invoices' &&
                        x.invoice_status === 'requested' &&
                        ['paid', 'shipped'].includes(x.status) && (
                          <button onClick={() => setModal({ kind: 'invoice', item: x })}>
                            标记已开票
                          </button>
                        )}
                      {tab === 'claims' && x.status !== 'refunded' && (
                        <>
                          <a
                            href="https://dashboard.stripe.com/payments"
                            target="_blank"
                            rel="noreferrer"
                          >
                            去 Stripe 退款 ↗
                          </a>
                          <button onClick={() => mutate('claim-done', { id: x.id })}>
                            记录退款完成
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
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
                    settings: '偏远运费规则',
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
