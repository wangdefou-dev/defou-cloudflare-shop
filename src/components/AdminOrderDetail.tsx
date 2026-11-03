import { useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, Package, RefreshCw, Truck, X } from 'lucide-react';
import type { AdminOrderDetail as Detail, AdminRecipient } from '../lib/admin-order';
import { money, statusNames } from '../lib/shared';
import { Button, ErrorBox, Field, request } from './ui';
import AdminRefunds from './AdminRefunds';
import ShipmentTracking from './ShipmentTracking';
import { CARRIERS, resolveCarrier } from '../lib/shipping';
import '../styles/admin-order.css';

export function adminTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      });
}

export default function AdminOrderDetail({
  orderId,
  onClose,
  onUpdated,
  onAdoption,
}: {
  orderId: string;
  onClose: () => void;
  onUpdated: () => Promise<unknown>;
  onAdoption?: (id: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const saving = useRef(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shipping, setShipping] = useState('');
  const [busy, setBusy] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const locked = busy || refundBusy;
  async function load() {
    setLoading(true);
    setError('');
    try {
      const next = await request('/admin/order-detail', { id: orderId });
      if (active.current) setDetail(next);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void load();
    return () => {
      active.current = false;
      document.body.style.overflow = overflow;
    };
  }, [orderId]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('已复制');
    } catch {
      setNotice('复制未成功，请选中文字手动复制');
    }
  }
  function recipient(address: AdminRecipient) {
    return (
      <div className="admin-recipient">
        <p>
          <strong>{address.recipient || '未填写姓名'}</strong>
          <span>{address.phone || '—'}</span>
        </p>
        <p>
          {address.region_label} {address.address}
        </p>
        {address.card_message && (
          <p className="admin-gift-note">
            心意卡：{address.card_message}
            {address.sender && ` · 署名：${address.sender}`}
          </p>
        )}
        {!address.card_message && address.sender && <p>寄件署名：{address.sender}</p>}
        <button
          className="small-button"
          type="button"
          onClick={() =>
            copy(
              `${address.recipient} ${address.phone}\n${address.region_label} ${address.address}`,
            )
          }
        >
          <Copy size={15} aria-hidden="true" />
          复制收件信息
        </button>
      </div>
    );
  }
  async function ship(event: React.SyntheticEvent<HTMLFormElement>, shipmentId: string) {
    event.preventDefault();
    if (saving.current || refundBusy) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await request('/admin/ship', {
        id: shipmentId,
        carrier: String(form.get('carrier')),
        tracking_no: String(form.get('tracking_no')).trim().toUpperCase(),
      });
      setShipping('');
      setNotice('物流单号已保存，已标记发货');
      await load();
      await onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const order = detail?.order;
  return (
    <dialog
      ref={dialog}
      className="admin-order-dialog"
      aria-labelledby="order-detail-title"
      onClose={onClose}
      onCancel={(e) => {
        if (locked) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || locked) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          dialog.current?.close();
      }}
    >
      <header className="admin-detail-heading">
        <div>
          <h2 id="order-detail-title">订单详情</h2>
          <p>{order?.order_no || (loading ? '正在读取订单…' : '读取未完成，请重试')}</p>
        </div>
        <div>
          <button
            type="button"
            className="small-button"
            disabled={loading || locked}
            onClick={load}
            aria-label="刷新订单详情"
          >
            <RefreshCw size={17} />
          </button>
          <button
            type="button"
            className="small-button"
            disabled={locked}
            onClick={() => dialog.current?.close()}
            aria-label="关闭订单详情"
          >
            <X size={21} />
          </button>
        </div>
      </header>
      <div className="admin-detail-body" aria-busy={loading}>
        <ErrorBox text={error} />
        {notice && (
          <p role="status" className="alert success">
            {notice}
          </p>
        )}
        {loading && (
          <p className="admin-detail-loading">
            <LoaderCircle size={19} className="spin" />
            正在读取订单和发货信息…
          </p>
        )}
        {detail && order && (
          <>
            <section className="admin-detail-section">
              <div className="admin-detail-section-heading">
                <h3>订单与付款</h3>
                <span className={'status-tag ' + order.status}>
                  {order.status === 'paid' ? '已付款' : statusNames[order.status] || order.status}
                </span>
              </div>
              <dl className="admin-detail-grid">
                <div>
                  <dt>订单类型</dt>
                  <dd>
                    {{ retail: '苹果零售', adoption: '果树认领', shipping: '预约补运费' }[
                      order.type
                    ] || order.type}
                  </dd>
                </div>
                <div>
                  <dt>下单手机号</dt>
                  <dd>{order.phone}</dd>
                </div>
                <div>
                  <dt>{order.discount_amount > 0 ? '折后应付金额' : '订单总额'}</dt>
                  <dd className="admin-detail-amount">¥{money(order.amount)}</dd>
                </div>
                {order.discount_amount > 0 && (
                  <>
                    <div>
                      <dt>优惠前总额</dt>
                      <dd>
                        ¥{money(order.original_amount ?? order.amount + order.discount_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt>优惠券减免（仅一箱）</dt>
                      <dd>
                        −¥{money(order.discount_amount)} ·{' '}
                        {(100 - (order.coupon_percent_off || 0)) / 10} 折
                      </dd>
                    </div>
                    <div>
                      <dt>优惠码标记</dt>
                      <dd>{order.coupon_code_hint}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>其中运费</dt>
                  <dd>¥{money(order.remote_fee)}</dd>
                </div>
                <div>
                  <dt>下单时间（北京时间）</dt>
                  <dd>{adminTime(order.created_at)}</dd>
                </div>
                <div>
                  <dt>付款时间（北京时间）</dt>
                  <dd>{adminTime(order.paid_at)}</dd>
                </div>
                {order.status === 'pending' && (
                  <div>
                    <dt>支付截止时间</dt>
                    <dd>{adminTime(order.expires_at)}</dd>
                  </div>
                )}
              </dl>
              <button type="button" className="small-button" onClick={() => copy(order.order_no)}>
                <Copy size={15} aria-hidden="true" />
                复制订单号
              </button>
            </section>
            <AdminRefunds
              orderId={order.id}
              onBusyChange={setRefundBusy}
              onUpdated={async () => {
                await load();
                await onUpdated();
              }}
            />
            <section className="admin-detail-section">
              <h3>商品与认领</h3>
              {detail.items.map((item) => (
                <div className="admin-detail-product" key={item.product_id}>
                  <Package size={22} aria-hidden="true" />
                  <div>
                    <strong>
                      {item.product_name} × {item.qty} {order.type === 'adoption' ? '棵' : '箱'}
                    </strong>
                    <p>
                      {item.box_type} · 单果约 {item.unit_weight_g}g
                    </p>
                  </div>
                </div>
              ))}
              {order.type === 'shipping' && (
                <p>本单为预约发货补运费，对应商品与收件信息见下方发货记录。</p>
              )}
              {detail.adoption && (
                <dl className="admin-detail-grid">
                  <div>
                    <dt>认领码</dt>
                    <dd>
                      {detail.adoption.adopt_code}
                      {onAdoption && (
                        <button
                          className="small-button"
                          type="button"
                          disabled={locked}
                          onClick={() => onAdoption(detail.adoption!.id)}
                        >
                          认领详情 / PIN 管理
                        </button>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>树牌昵称</dt>
                    <dd>{detail.adoption.plate_name}</dd>
                  </div>
                  <div>
                    <dt>本季权益</dt>
                    <dd>
                      共 {detail.adoption.total_boxes} 箱，已预约 {detail.adoption.used_boxes}{' '}
                      箱，剩余 {detail.adoption.total_boxes - detail.adoption.used_boxes} 箱
                    </dd>
                  </div>
                  <div>
                    <dt>预约截止</dt>
                    <dd>{detail.adoption.expires_at}</dd>
                  </div>
                </dl>
              )}
              {order.type === 'adoption' && !detail.adoption && (
                <p className="fine-print">付款确认后生成认领码与本季权益。</p>
              )}
            </section>
            <section className="admin-detail-section">
              <h3>
                收货与物流{detail.shipments.length > 0 && `（${detail.shipments.length} 条）`}
              </h3>
              {!detail.shipments.length && (
                <>
                  {detail.address ? (
                    recipient(detail.address)
                  ) : (
                    <p className="fine-print">
                      {order.type === 'adoption'
                        ? '认领订单在客户预约发货时填写收货信息，可寄往不同地址。'
                        : '本单暂无收件信息。'}
                    </p>
                  )}
                  <p className="fine-print">
                    {order.type === 'adoption'
                      ? '尚无预约发货记录。'
                      : order.status === 'pending'
                        ? '尚未付款，付款确认后生成发货记录。'
                        : '暂无发货记录。'}
                  </p>
                </>
              )}
              {detail.shipments.map((s) => (
                <article className="admin-detail-shipment" key={s.id}>
                  <div className="admin-detail-section-heading">
                    <strong>
                      <Truck size={18} aria-hidden="true" />
                      {s.box_type} · {s.qty} 箱
                    </strong>
                    <span className={'status-tag ' + s.status}>
                      {s.status === 'reserved' ? '待发货' : statusNames[s.status] || s.status}
                    </span>
                  </div>
                  {recipient(s)}
                  <dl className="admin-detail-grid">
                    <div>
                      <dt>快递公司</dt>
                      <dd>{s.carrier}</dd>
                    </div>
                    <div>
                      <dt>期望发货</dt>
                      <dd>{s.expected_date || '付款后 48 小时内'}</dd>
                    </div>
                    <div>
                      <dt>实际发货时间（北京时间）</dt>
                      <dd>{adminTime(s.shipped_at)}</dd>
                    </div>
                  </dl>
                  <ShipmentTracking shipment={s} context="admin" />
                  {s.status === 'reserved' &&
                    (shipping === s.id ? (
                      <form className="admin-detail-ship-form" onSubmit={(e) => ship(e, s.id)}>
                        <Field label="快递公司">
                          <select
                            name="carrier"
                            required
                            defaultValue={resolveCarrier(s.carrier)?.code || 'shunfeng'}
                            disabled={locked}
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
                            disabled={locked}
                          />
                        </Field>
                        <p className="fine-print">请确认包裹已交寄，保存后将标记为已发货。</p>
                        <div>
                          <Button type="submit" busy={busy} disabled={refundBusy}>
                            保存单号并标记发货
                          </Button>
                          <button
                            type="button"
                            className="small-button"
                            disabled={locked}
                            onClick={() => setShipping('')}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="small-button"
                        disabled={locked}
                        onClick={() => setShipping(s.id)}
                      >
                        填写单号并发货
                      </button>
                    ))}
                </article>
              ))}
            </section>
            <section className="admin-detail-section">
              <div className="admin-detail-section-heading">
                <h3>发票信息</h3>
                <span>{statusNames[order.invoice_status] || order.invoice_status}</span>
              </div>
              {detail.invoice && (
                <dl className="admin-detail-grid">
                  <div>
                    <dt>发票类型</dt>
                    <dd>{detail.invoice.type === 'company' ? '企业' : '个人'}</dd>
                  </div>
                  <div>
                    <dt>发票抬头</dt>
                    <dd>{detail.invoice.title}</dd>
                  </div>
                  {detail.invoice.tax_no && (
                    <div>
                      <dt>企业税号</dt>
                      <dd>{detail.invoice.tax_no}</dd>
                    </div>
                  )}
                  <div>
                    <dt>接收邮箱</dt>
                    <dd>{detail.invoice.email}</dd>
                  </div>
                </dl>
              )}
              {order.invoice_url?.startsWith('/media/apple-2026/') && (
                <a
                  className="text-link"
                  href={order.invoice_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看已上传发票 ↗
                </a>
              )}
            </section>
            <details className="admin-payment-reference">
              <summary>支付参考信息</summary>
              <dl>
                <dt>Stripe 支付 ID</dt>
                <dd>{order.stripe_payment_intent || '暂无'}</dd>
                <dt>Stripe Checkout ID</dt>
                <dd>{order.stripe_session_id || '暂无'}</dd>
              </dl>
            </details>
          </>
        )}
      </div>
    </dialog>
  );
}
