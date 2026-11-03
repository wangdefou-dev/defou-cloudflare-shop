import site from '../../config/site.json';
import { useEffect, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { Button, ErrorBox, Field, request } from './ui';
import { couponLabel } from '../lib/coupon-format';
import {
  couponListText,
  prepareAdminCoupons,
  readCouponBackup,
  type CouponDraft,
  type CreatedCouponBatch,
} from '../lib/coupon-issuance';
import { adminTime } from './AdminOrderDetail';

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function AdminCouponCreator({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [discount, setDiscount] = useState('8.8'),
    [count, setCount] = useState('20'),
    [days, setDays] = useState('7');
  const [draft, setDraft] = useState<CouponDraft | null>(null),
    [batch, setBatch] = useState<CreatedCouponBatch | null>(null),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const saving = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!draft || batch) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, batch]);
  function prepare(event: React.SyntheticEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      setDraft(
        prepareAdminCoupons(name, Math.round(Number(discount) * 10), Number(count), Number(days)),
      );
      setSaved(false);
      setBatch(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function create() {
    if (!draft || !saved || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request('/admin/coupons/create', { ...draft, saved: true });
      if (active.current) {
        setBatch(result.batch);
        setNotice(
          '已确认创建成功，可下载带准确有效期的清单。重复确认不会重新发券或延长有效期，当前使用状态以列表为准。',
        );
        onCreated();
      }
    } catch (e) {
      if (active.current)
        setError(
          '尚未确认创建结果：' +
            (e as Error).message +
            '。请保留清单，点击原按钮重试，不要另建一批。',
        );
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function restore(file?: File) {
    if (!file || draft) return;
    setError('');
    try {
      if (file.size > 32768) throw Error('备份文件过大');
      setDraft(readCouponBackup(await file.text()));
      setBatch(null);
      setSaved(false);
      setOpen(true);
      setNotice('已恢复原创建请求。核对并重试时不会重复发行。');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="admin-coupon-creator">
      <button className="small-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={17} /> 自主创建优惠券
      </button>
      {open && (
        <div className="admin-coupon-create-body">
          <ErrorBox text={error} />
          {notice && (
            <p className="alert success" role="status">
              {notice}
            </p>
          )}
          {!draft ? (
            <>
              <form onSubmit={prepare}>
                <div className="form-grid">
                  <Field label="批次名称">
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={name}
                      placeholder="例如：读书会社群"
                      onChange={(e) => setName(e.currentTarget.value)}
                    />
                  </Field>
                  <Field label="折扣（折）" hint="8.8 折表示付原价的 88%，每码只优惠一箱">
                    <input
                      type="number"
                      required
                      min="1"
                      max="9.9"
                      step="0.1"
                      value={discount}
                      onChange={(e) => setDiscount(e.currentTarget.value)}
                    />
                  </Field>
                  <Field label="创建张数" hint="每张券码只能使用一次，每批 1–200 张">
                    <input
                      type="number"
                      required
                      min="1"
                      max="200"
                      step="1"
                      value={count}
                      onChange={(e) => setCount(e.currentTarget.value)}
                    />
                  </Field>
                  <Field label="有效天数" hint="确认创建成功后起算，1–365 天">
                    <input
                      type="number"
                      required
                      min="1"
                      max="365"
                      step="1"
                      value={days}
                      onChange={(e) => setDays(e.currentTarget.value)}
                    />
                  </Field>
                </div>
                <Button type="submit">生成券码清单</Button>
              </form>
              <details className="admin-coupon-restore">
                <summary>恢复之前未确认的创建</summary>
                <p className="fine-print">选择本页下载的 JSON 备份，继续原请求，避免重复创建。</p>
                <input
                  aria-label="导入优惠券备份"
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void restore(e.currentTarget.files?.[0])}
                />
              </details>
            </>
          ) : (
            <>
              <h3>
                {draft.name} · {couponLabel(100 - draft.pay_percent)} · {draft.codes.length} 张
              </h3>
              <p className="fine-print">
                {batch
                  ? `已创建：北京时间 ${adminTime(batch.starts_at)} 至 ${adminTime(batch.expires_at)}`
                  : `清单已准备，尚未确认启用；创建成功后有效 ${draft.valid_days} 天。`}
              </p>
              <p className="fine-print">
                完整券码只在当前清单中显示，数据库仅存哈希，之后不能从列表查回。请先保存；备份文件可用于恢复原创建请求。
              </p>
              <div className="admin-coupon-actions">
                <button
                  className="small-button"
                  onClick={() =>
                    download(
                      couponListText(draft, batch),
                      `${site.name}-优惠券-${draft.request_id.slice(0, 8)}.txt`,
                      'text/plain;charset=utf-8',
                    )
                  }
                >
                  <Download size={16} /> 下载券码清单
                </button>
                <button
                  className="small-button"
                  onClick={() =>
                    download(
                      JSON.stringify(
                        {
                          format: 'orchard-coupons-v1',
                          draft,
                          batch,
                        },
                        null,
                        2,
                      ),
                      `${site.name}-优惠券备份-${draft.request_id.slice(0, 8)}.json`,
                      'application/json',
                    )
                  }
                >
                  下载恢复备份
                </button>
                <button
                  className="small-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(couponListText(draft, batch));
                      setNotice('完整清单已复制');
                    } catch {
                      setError('复制未成功，请下载清单');
                    }
                  }}
                >
                  复制完整清单
                </button>
              </div>
              <details className="admin-coupon-code-preview">
                <summary>查看本批完整券码</summary>
                <textarea
                  aria-label="本批完整券码"
                  readOnly
                  rows={6}
                  value={draft.codes.join('\n')}
                />
              </details>
              {!batch ? (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={saved}
                      onChange={(e) => setSaved(e.currentTarget.checked)}
                    />
                    我已保存完整券码清单，确认按以上规则创建
                  </label>
                  <Button disabled={!saved} busy={busy} onClick={create}>
                    确认创建并生效
                  </Button>
                </>
              ) : (
                <button
                  className="small-button"
                  onClick={() => {
                    setDraft(null);
                    setBatch(null);
                    setNotice('');
                    setSaved(false);
                  }}
                >
                  清单已保存，创建下一批
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
