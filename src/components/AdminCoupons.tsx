import { useEffect, useState } from 'react';
import { couponLabel } from '../lib/coupon-format';
import { request, ErrorBox } from './ui';
import { adminTime } from './AdminOrderDetail';
import AdminCouponCreator from './AdminCouponCreator';
import type { AdminCouponCode, AdminCouponData } from '../lib/coupons';
import '../styles/admin-coupons.css';

const statusLabels: Record<string, string> = {
  available: '可使用',
  reserved: '付款中',
  redeemed: '已核销',
  disabled: '已停用',
  expired: '已过期',
  scheduled: '未开始',
};
export default function AdminCoupons() {
  const [data, setData] = useState<AdminCouponData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [toggling, setToggling] = useState(false);
  const [filter, setFilter] = useState(''),
    [discount, setDiscount] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    request('/admin/coupons/search', {
      status: filter,
      percent_off: discount ? Number(discount) : null,
      search: query,
      page,
    })
      .then((result) => {
        if (active) setData(result);
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
  }, [filter, discount, query, page, refresh]);
  async function toggle(code: AdminCouponCode) {
    setToggling(true);
    setError('');
    try {
      await request('/admin/coupons/disable', { id: code.id, disabled: !code.disabled });
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setToggling(false);
    }
  }
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.page_size || 20)));
  return (
    <div className="admin-coupons">
      <p className="fine-print">
        每单仅优惠一箱零售苹果；运费、果树认领不参与。一次性券可用一次，共用券按总次数限制。付款中订单占用名额并保留原优惠，停用只阻止新订单。列表只显示脱敏标记。
      </p>
      <AdminCouponCreator
        onCreated={() => {
          setPage(1);
          setRefresh((n) => n + 1);
        }}
      />
      <ErrorBox text={error} />
      {data && !!data.batches.length && (
        <details className="admin-coupon-batches">
          <summary>批次概览（最近 {data.batches.length} 批）</summary>
          {data.batches.map((batch) => (
            <article className="admin-record" key={batch.id}>
              <div className="record-main">
                <strong>{batch.name}</strong>
                <p>
                  共 {batch.total} 个券码 · 总额度 {batch.usage_limit} 次 · 可用 {batch.available}{' '}
                  次 · 付款中 {batch.reserved} 次 · 已核销 {batch.redeemed} 次
                </p>
                <small>
                  北京时间 {adminTime(batch.starts_at)} 至 {adminTime(batch.expires_at)}
                </small>
              </div>
            </article>
          ))}
        </details>
      )}
      <form
        className="admin-coupon-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
          setPage(1);
          setRefresh((n) => n + 1);
        }}
      >
        <label className="field">
          <span>搜索优惠券</span>
          <input
            aria-label="搜索优惠码标记"
            maxLength={80}
            placeholder="搜索标记或批次名称"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>折扣</span>
          <select
            aria-label="优惠券折扣"
            value={discount}
            onChange={(e) => {
              setDiscount(e.currentTarget.value);
              setPage(1);
            }}
          >
            <option value="">全部折扣</option>
            {data?.discounts.map((d) => (
              <option key={d.percent_off} value={d.percent_off}>
                {couponLabel(d.percent_off)}（{d.total} 张）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>状态</span>
          <select
            aria-label="优惠券状态"
            value={filter}
            onChange={(e) => {
              setFilter(e.currentTarget.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="small-button" type="submit" disabled={busy}>
          查询
        </button>
        <button
          className="small-button"
          type="button"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          刷新优惠券
        </button>
      </form>
      <p className="fine-print" role="status">
        {busy ? '正在查询…' : `符合条件的优惠券共 ${data?.total || 0} 张`}
      </p>
      {data?.codes.map((code) => (
        <article className="admin-record" key={code.id}>
          <div className="record-main">
            <strong>
              {couponLabel(code.percent_off)}券 · {code.code_hint}
            </strong>
            <p>
              {statusLabels[code.status]}
              {code.redeemed_at ? ` · 最近核销 ${adminTime(code.redeemed_at)}` : ''}
            </p>
            <p>
              总额度 {code.redemption_limit} 次 · 已使用 {code.used_count} 次 · 付款中{' '}
              {code.reserved_count} 次 · 可用 {code.remaining_uses} 次
            </p>
            <small>
              {code.batch_name} · 到期 {adminTime(code.expires_at)}
            </small>
          </div>
          {code.used_count < code.redemption_limit && code.status !== 'expired' && (
            <div className="record-actions">
              <button disabled={busy || toggling} onClick={() => toggle(code)}>
                {code.disabled ? '恢复使用' : '停用此券'}
              </button>
            </div>
          )}
        </article>
      ))}
      {data && !busy && !data.codes.length && <p>没有符合条件的优惠券</p>}
      <div className="admin-pagination">
        <button
          className="small-button"
          disabled={busy || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页优惠券
        </button>
        <span>
          第 {page} / {pages} 页
        </span>
        <button
          className="small-button"
          disabled={busy || page >= pages}
          onClick={() => setPage(page + 1)}
        >
          下一页优惠券
        </button>
      </div>
    </div>
  );
}
