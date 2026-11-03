import { useEffect, useState } from 'react';
import { Field, ErrorBox, request } from './ui';
export default function AdminShipmentPicker() {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState('');
  const [data, setData] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      void request('/admin/list', {
        kind: 'shipments',
        status: 'shipped',
        search,
        page,
        page_size: 20,
      })
        .then((result) => {
          if (current) setData(result);
        })
        .catch((e) => {
          if (current) setError(e.message);
        })
        .finally(() => {
          if (current) setBusy(false);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [search, page]);
  return (
    <>
      <Field label="查找已发货记录">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            setSelected('');
          }}
          placeholder="收件人 / 运单号 / 发货编号"
        />
      </Field>
      <Field label="已发货记录">
        <select
          name="shipment_id"
          required
          value={selected}
          disabled={busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{busy ? '正在读取…' : '请选择'}</option>
          {data.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.box_type} · {s.recipient} · {s.qty} 箱 · {s.tracking_no || s.id}
            </option>
          ))}
        </select>
      </Field>
      <div className="admin-pagination">
        <span>
          共 {data.total} 条 · 第 {page} 页
        </span>
        <button
          type="button"
          className="small-button"
          disabled={busy || page <= 1}
          onClick={() => {
            setPage(page - 1);
            setSelected('');
          }}
        >
          上一页
        </button>
        <button
          type="button"
          className="small-button"
          disabled={busy || page * 20 >= data.total}
          onClick={() => {
            setPage(page + 1);
            setSelected('');
          }}
        >
          下一页
        </button>
      </div>
      <ErrorBox text={error} />
    </>
  );
}
