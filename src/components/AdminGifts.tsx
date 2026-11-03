import { useEffect, useState } from 'react';
import { Gift, RefreshCw } from 'lucide-react';
import { ErrorBox, request } from './ui';
import { adminTime } from './AdminOrderDetail';
import '../styles/admin-gifts.css';

type GiftCity = {
  province_code: string;
  city_code: string;
  region_label: string;
  qty: number;
};
type GiftBatch = {
  id: string;
  name: string;
  status: 'active' | 'draft' | 'void';
  row_count: number;
  box_count: number;
  created_at: string;
  shipped_date: string | null;
  cities: GiftCity[];
};
type GiftData = {
  batches: GiftBatch[];
  totals: { batches: number; records: number; boxes: number; cities: number; provinces: number };
};
const statusLabels: Record<GiftBatch['status'], string> = {
  active: '已确认寄出',
  draft: '草稿 · 未计入',
  void: '已作废 · 未计入',
};
const number = (value: number) => value.toLocaleString('zh-CN');

export default function AdminGifts() {
  const [data, setData] = useState<GiftData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    request('/admin/gifts')
      .then((next: GiftData) => {
        if (active) setData(next);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const metrics = [
    ['有效批次', data?.totals.batches, '批'],
    ['赠送记录', data?.totals.records, '份'],
    ['赠送苹果', data?.totals.boxes, '箱'],
    ['收货城市', data?.totals.cities, '座'],
    ['省级地区', data?.totals.provinces, '个'],
  ] as const;
  return (
    <div className="admin-gifts" aria-busy={loading}>
      <div className="admin-gift-intro">
        <p>
          仅统计赠送数量与苹果足迹，不计入付费订单或营业额，不调整库存。
          已确认寄出的有效批次才计入下方统计与地图，草稿和作废批次不计入。
        </p>
        <button
          className="small-button"
          type="button"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {loading ? '正在读取' : '刷新赠送记录'}
        </button>
      </div>
      <ErrorBox text={error} />
      <dl className="admin-gift-metrics" aria-live="polite">
        {metrics.map(([label, value, unit]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value === undefined ? '—' : number(value)}
              <small>{unit}</small>
            </dd>
          </div>
        ))}
      </dl>
      {loading && !data && <p role="status">正在读取赠送批次与城市汇总…</p>}
      {data && !data.batches.length && (
        <div className="admin-gift-empty">
          <Gift size={32} strokeWidth={1.4} aria-hidden="true" />
          <h3>暂无赠送记录</h3>
          <p>确认寄出的赠送批次录入后，会在这里显示城市与箱数。</p>
        </div>
      )}
      {data?.batches.map((batch) => (
        <article className="admin-gift-batch" key={batch.id}>
          <header>
            <h3>{batch.name}</h3>
            <span className={'admin-gift-status ' + batch.status}>
              {statusLabels[batch.status]}
            </span>
          </header>
          <p className="admin-gift-batch-counts">
            {number(batch.row_count)} 份记录 · {number(batch.box_count)} 箱苹果 ·{' '}
            {number(batch.cities.length)} 座城市
          </p>
          <dl className="admin-gift-dates">
            <div>
              <dt>实际发货日期</dt>
              <dd>{batch.shipped_date || '未记录'}</dd>
            </div>
            <div>
              <dt>录入时间（北京时间）</dt>
              <dd>{adminTime(batch.created_at)}</dd>
            </div>
          </dl>
          {batch.status !== 'active' && (
            <p className="admin-gift-excluded">
              {batch.status === 'draft' ? '这批赠送尚待确认' : '这批赠送已作废'}
              ，不计入赠送统计或苹果足迹。
            </p>
          )}
          <details className="admin-gift-cities" open={batch.status === 'active'}>
            <summary>城市与箱数（{number(batch.cities.length)} 座）</summary>
            {batch.cities.length ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col">收货城市</th>
                    <th scope="col">赠送数量</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.cities.map((city) => (
                    <tr key={city.city_code}>
                      <td>{city.region_label.split(' / ').join(' · ')}</td>
                      <td>{number(city.qty)} 箱</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="fine-print">暂无城市汇总</p>
            )}
          </details>
        </article>
      ))}
      <p className="fine-print admin-gift-privacy">
        此页仅展示批次、城市与数量，不展示收件人、电话、区县或详细地址。未提供的实际发货日期显示为“未记录”。
      </p>
    </div>
  );
}
