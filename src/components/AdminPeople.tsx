import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Button, ErrorBox, Field, request } from './ui';
import { adminTime } from './AdminOrderDetail';
import { money, statusNames } from '../lib/shared';
import type { AdoptionRow, CustomerDetail, CustomerRow, PeopleResult } from '../lib/admin-people';
import '../styles/admin-people.css';

export default function AdminPeople({
  kind,
  refreshToken,
  onOrder,
  onAdoption,
  onPhotos,
}: {
  kind: 'customers' | 'adoptions';
  refreshToken: unknown;
  onOrder: (id: string) => void;
  onAdoption: (id: number) => void;
  onPhotos: (row: AdoptionRow) => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [result, setResult] = useState<PeopleResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    request('/admin/people/search', { kind, query, filter, page })
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [kind, query, filter, page, refresh, refreshToken]);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function customer(id: string, nextPage = 1) {
    const n = ++sequence.current;
    setDetailBusy(true);
    setError('');
    try {
      const d = await request('/admin/customer-detail', { id, page: nextPage });
      if (n === sequence.current) setDetail(d);
    } catch (e) {
      if (n === sequence.current) setError((e as Error).message);
    } finally {
      if (n === sequence.current) setDetailBusy(false);
    }
  }
  useEffect(() => {
    if (detail) void customer(detail.customer.id, detail.page);
  }, [refreshToken]);
  const pages = Math.max(1, Math.ceil((result?.total || 0) / 20));
  return (
    <div className="admin-people">
      <ErrorBox text={error} />
      {detail ? (
        <>
          <div className="admin-people-heading">
            <button
              className="small-button"
              onClick={() => {
                sequence.current++;
                setDetail(null);
                setDetailBusy(false);
                setError('');
              }}
            >
              <ArrowLeft size={16} /> 返回用户列表
            </button>
            <button
              className="small-button"
              disabled={detailBusy}
              onClick={() => customer(detail.customer.id, detail.page)}
            >
              刷新客户详情
            </button>
          </div>
          <section className="admin-detail-section">
            <h3>客户详情</h3>
            <dl className="admin-detail-grid">
              <div>
                <dt>下单手机号</dt>
                <dd>{detail.customer.phone}</dd>
              </div>
              <div>
                <dt>最近收件人</dt>
                <dd>{detail.customer.recipient || '尚未填写'}</dd>
              </div>
              <div>
                <dt>已付款商品订单 / 折后货款</dt>
                <dd>
                  {detail.customer.paid_orders} 单 / ¥{money(detail.customer.paid_amount)}
                </dd>
              </div>
              <div>
                <dt>首次 / 最近下单</dt>
                <dd>
                  {adminTime(detail.customer.first_order_at)}
                  <br />
                  {adminTime(detail.customer.last_order_at)}
                </dd>
              </div>
            </dl>
          </section>
          <section className="admin-detail-section">
            <h3>关联认领（含历史退款）</h3>
            {!detail.adoptions.length && <p className="fine-print">暂无已生成的认领记录</p>}
            {detail.adoptions.map((a) => (
              <article className="admin-record" key={a.id}>
                <div className="record-main">
                  <strong>
                    {a.adopt_code} · {a.plate_name}
                  </strong>
                  <p>
                    {statusNames[a.status] || a.status} · 剩余 {a.total_boxes - a.used_boxes} /{' '}
                    {a.total_boxes} 箱
                  </p>
                </div>
                <button className="small-button" onClick={() => onAdoption(a.id)}>
                  详情 / PIN 管理
                </button>
              </article>
            ))}
            {detail.more_adoptions && (
              <p>此处显示最近 200 条，全部记录可在「认领」中按手机号分页查询。</p>
            )}
          </section>
          <section className="admin-detail-section">
            <h3>关联订单（{detail.orders_total} 单）</h3>
            {detail.orders.map((o) => (
              <article className="admin-record" key={o.id}>
                <div className="record-main">
                  <strong>{o.order_no}</strong>
                  <p>
                    {o.product_name || '补运费'}
                    {o.qty ? ` × ${o.qty}` : ''} · ¥{money(o.amount)} ·{' '}
                    {statusNames[o.status] || o.status}
                  </p>
                  <small>{adminTime(o.created_at)}</small>
                </div>
                <button className="small-button" onClick={() => onOrder(o.id)}>
                  订单与收货详情
                </button>
              </article>
            ))}
            <div className="admin-pagination">
              <button
                className="small-button"
                disabled={detailBusy || detail.page <= 1}
                onClick={() => customer(detail.customer.id, detail.page - 1)}
              >
                上一页订单
              </button>
              <span>
                第 {detail.page} / {Math.max(1, Math.ceil(detail.orders_total / 20))} 页
              </span>
              <button
                className="small-button"
                disabled={detailBusy || detail.page * 20 >= detail.orders_total}
                onClick={() => customer(detail.customer.id, detail.page + 1)}
              >
                下一页订单
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          <p className="fine-print">
            {kind === 'customers'
              ? '按下单手机号归并客户，包含待付款及历史订单。最近收件人仅为收货称呼；点击详情查看完整联系方式和关联记录。'
              : '搜索手机号、认领码、订单号或树牌昵称。查看权益与 PIN 状态，核对身份后可重置 PIN；原 PIN 不保存明文。'}
          </p>
          <form
            className="admin-people-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
              setPage(1);
              setRefresh((n) => n + 1);
            }}
          >
            <Field label={kind === 'customers' ? '搜索客户' : '搜索认领'}>
              <input
                value={search}
                maxLength={80}
                onChange={(e) => setSearch(e.currentTarget.value)}
                placeholder={
                  kind === 'customers'
                    ? '手机号 / 收件人 / 订单号 / 认领码'
                    : '手机号 / 认领码 / 树牌昵称 / 订单号'
                }
              />
            </Field>
            <Field label="筛选范围">
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.currentTarget.value);
                  setPage(1);
                }}
              >
                <option value="all">全部</option>
                {kind === 'customers' ? (
                  <>
                    <option value="paid">有已付款订单</option>
                    <option value="adopters">有有效认领</option>
                  </>
                ) : (
                  <>
                    <option value="active">有效认领</option>
                    <option value="inactive">已退款 / 失效</option>
                  </>
                )}
              </select>
            </Field>
            <Button type="submit" busy={busy}>
              <Search size={16} />
              查询
            </Button>
            <button
              type="button"
              className="small-button"
              disabled={busy}
              onClick={() => setRefresh((n) => n + 1)}
            >
              刷新
            </button>
          </form>
          <p className="fine-print" role="status">
            {busy
              ? '正在查询…'
              : `共 ${result?.total || 0} 位${kind === 'customers' ? '客户' : '认领'}`}
          </p>
          {result?.rows.map((row) =>
            kind === 'customers'
              ? (() => {
                  const c = row as CustomerRow;
                  return (
                    <article className="admin-record" key={c.id}>
                      <div className="record-main">
                        <strong>{c.phone}</strong>
                        <p>
                          最近收件人：{c.recipient || '未填写'} · 已付款 {c.paid_orders} 单 · 货款 ¥
                          {money(c.paid_amount)}
                        </p>
                        <small>
                          关联 {c.total_orders} 单 · 有效认领 {c.adoption_count} 棵 · 最近下单{' '}
                          {adminTime(c.last_order_at)}
                        </small>
                      </div>
                      <button
                        className="small-button"
                        disabled={detailBusy}
                        onClick={() => customer(c.id)}
                      >
                        查看客户详情
                      </button>
                    </article>
                  );
                })()
              : (() => {
                  const a = row as AdoptionRow;
                  return (
                    <article className="admin-record" key={a.id}>
                      <div className="record-main">
                        <strong>
                          {a.adopt_code} · {a.plate_name}
                        </strong>
                        <p>
                          {a.phone} · {statusNames[a.status] || a.status} · 剩余{' '}
                          {a.total_boxes - a.used_boxes} / {a.total_boxes} 箱
                        </p>
                        <small>
                          {a.has_pin ? 'PIN 已设置' : 'PIN 未设置'} · 已上传 {a.photo_count} 张照片
                        </small>
                      </div>
                      <div className="record-actions">
                        <button className="small-button" onClick={() => onAdoption(a.id)}>
                          详情 / PIN 管理
                        </button>
                        <button className="small-button" onClick={() => onPhotos(a)}>
                          上传树照
                        </button>
                      </div>
                    </article>
                  );
                })(),
          )}
          {!busy && result && !result.rows.length && (
            <p className="empty-state">没有匹配的记录，请调整搜索条件。</p>
          )}
          <div className="admin-pagination">
            <button
              className="small-button"
              disabled={busy || page <= 1}
              onClick={() => setPage((n) => n - 1)}
            >
              上一页
            </button>
            <span>
              第 {page} / {pages} 页
            </span>
            <button
              className="small-button"
              disabled={busy || page >= pages}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  );
}
